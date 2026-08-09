// application/automation/execute.ts — headless cron execution (moved from
// cli/cron.ts cmdCronRun). Runs a cron's harness argv, records a structured
// RunRecord, opens/resolves incidents, and applies the inbox batch guard.
// Platform/filehub/log-dir/clock are injected so statuses are testable without
// spawning a real harness.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { loadCrons, resolveCronPrompt, type SkillTargetContext } from "./definitions.ts";
import { readMaterializedJournal } from "../workspace/journal.ts";
import { skillRel, skillRoot } from "../workspace/manifest.ts";
import { lastRun, writeRun } from "./runs.ts";
import { openOrUpdate, resolveIncidents } from "./incidents.ts";
import { acquireLock } from "./lock.ts";
import { win32SpawnTarget } from "./win32-spawn.ts";
import { harnessArgv } from "../../adapters/harness/argv.ts";
import { isFile } from "../fs.ts";
import { localDate, localStamp } from "../time.ts";

/** Max harness output bytes kept in memory (1 MiB); beyond that output is
 *  dropped at the tail so a runaway cron can't OOM the CLI. */
const MAX_OUTPUT_BYTES = 1_048_576;
/** Prose log body truncation (bytes) — the RunRecord is machine truth; the log
 *  only needs enough to debug. */
const LOG_TRUNCATE_BYTES = 64_000;
/** Number of prose logs kept per cron (oldest pruned). */
const LOG_KEEP = 30;
/** Lock considered stale after timeout * this (a live run holds the lock for
 *  at most timeoutSec, so 2x is a safe margin for clock skew / slow spawn). */
const LOCK_STALE_MS_MULTIPLE = 2;

export interface ExecuteDeps {
  platform: string;
  /** filehub root via the shared effective registry, or null when unbound. */
  filehubRoot: (root: string) => string | null;
  /** per-cron prose log dir (human payload). */
  logDir: (root: string, cronId: string) => string;
  /** clock in ms since epoch (injectable for deterministic timeouts). */
  now: () => number;
  /** skill-target validation/compile context (Child D); injected so application
   *  never imports the generated cli/*.generated.ts. */
  skillsManifest: SkillsManifestV1;
  bundleManifest: DistributionManifestV1;
  readFile: (p: string) => string | null;
  /** optional harness binary override (tests: fake harness; prod: undefined → PATH resolve). */
  harnessBin?: string;
}

export interface CronRunOptions {
  cronId: string;
  dryRun: boolean;
  timeoutSec: number;
  force: boolean;
}

function todaySuccess(root: string, cronId: string): boolean {
  // Machine truth: same-day success is decided from the structured RunRecord,
  // never the prose log. The prose log is a human payload written *before* the
  // RunRecord (execute.ts), so trusting it opens a crash window: a log saying
  // "status: ok" with a missing RunRecord would silently skip the next trigger.
  const last = lastRun(root, cronId);
  if (!last) return false;
  if (!last.startedAt.startsWith(localDate())) return false;
  return last.status === "ok" && !last.timedOut;
}

function pruneLogs(root: string, cronId: string, keep: number, logDir: (r: string, c: string) => string): void {
  const dir = logDir(root, cronId);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  while (files.length > keep) {
    const rm = files.shift()!;
    unlinkSync(join(dir, rm));
  }
}

/** Inbox-tidy batch guard: skills/asset-ingest must exist and the batch log must
 *  change during the run. F3: the batch log lives at
 *  <filehub>/.jspace-logs/inbox-batch.md — the same path the asset-ingest skill
 *  writes — not the workbench .jspace/logs/. inbox-tidy detection no longer reads
 *  prose prompt text (prompt is optional for skill-target crons): key off the
 *  cron id or the asset-ingest target so the guard survives the prompt→target
 *  migration (F3 not regressed). */
function validateInboxGuard(
  cron: CronDefinition,
  root: string,
  fhRoot: string | null,
): { isInboxTask: boolean; batchLog: string | null; batchBefore: { mtime: number; size: number } } {
  const isInboxTask = cron.id === "inbox-tidy" || cron.target?.skill === "asset-ingest";
  const batchLog = fhRoot !== null ? join(fhRoot, ".jspace-logs", "inbox-batch.md") : null;
  let batchBefore = { mtime: 0, size: -1 };
  if (isInboxTask) {
    if (!existsSync(skillRoot(root, "asset-ingest"))) {
      openOrUpdate(root, cron.id, "batch-stale", crypto.randomUUID());
      fail(`cron ${cron.id}: ${skillRel("asset-ingest")} not found in ${root}; refusing to run`);
    }
    if (batchLog !== null && isFile(batchLog)) {
      const st = statSync(batchLog);
      batchBefore = { mtime: st.mtimeMs, size: st.size };
    }
  }
  return { isInboxTask, batchLog, batchBefore };
}

/** Spawn the harness, stream stdout+stderr (capped), and arm the timeout kill.
 *  Returns the live child + timer so the caller can await exit and clear the
 *  timer, plus `collect()` for the final capped output. win32 .cmd/.bat can't
 *  spawn directly -> routed through cmd.exe via the testable builder; .exe/.com
 *  (and every non-win32 binary) spawn directly, so no shell:true is ever needed
 *  (shell quoting would mangle spaced args). */
function spawnHarness(
  argv: string[],
  platform: string,
  cwd: string,
  timeoutSec: number,
): {
  child: ReturnType<typeof spawn>;
  timer: NodeJS.Timeout;
  /** Capped utf-8 output once the child exits. */
  collect: () => string;
} {
  const defaultPath = platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const chunks: Buffer[] = [];
  let bytes = 0;
  const push = (d: Buffer): void => {
    if (bytes >= MAX_OUTPUT_BYTES) return;
    const take = Math.min(d.length, MAX_OUTPUT_BYTES - bytes);
    chunks.push(d.subarray(0, take));
    bytes += take;
  };
  const spawnTarget = platform === "win32"
    ? win32SpawnTarget(argv)
    : { command: argv[0], args: argv.slice(1), verbatim: false };
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd,
    env,
    detached: platform !== "win32",
    windowsVerbatimArguments: spawnTarget.verbatim,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  const timer = setTimeout(() => {
    if (platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } catch { /* ignore */ }
    } else {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    }
  }, timeoutSec * 1000);
  return {
    child,
    timer,
    collect: () => Buffer.concat(chunks).toString("utf-8"),
  };
}

/** Write the prose log (human payload, truncated) + the structured RunRecord
 *  (machine truth), then prune old logs. Returns the paths/ids the caller needs
 *  for its report and incident bookkeeping. */
function recordRun(
  root: string,
  opts: CronRunOptions,
  argv: string[],
  exited: number,
  status: "ok" | "suspect" | "failed",
  timedOut: boolean,
  batchChanged: boolean,
  output: string,
  deps: ExecuteDeps,
): { runId: string; logPath: string } {
  const logDir = deps.logDir(root, opts.cronId);
  mkdirSync(logDir, { recursive: true });
  const runId = crypto.randomUUID();
  // filename carries the run id so two runs in the same second (e.g. launchd
  // catch-up + a manual --force) never overwrite each other's prose log.
  const logPath = join(logDir, `${localStamp()}-${runId.slice(0, 8)}.md`);
  writeFileSync(logPath, [
    `# cron ${opts.cronId}`,
    `time: ${localStamp()}`,
    `command: ${argv.join(" ")}`,
    `exit: ${exited}`,
    `status: ${status}`,
    `timed_out: ${timedOut}`,
    `batch_log_changed: ${batchChanged}`,
    "---",
    output.slice(0, LOG_TRUNCATE_BYTES),
  ].join("\n"), "utf-8");
  pruneLogs(root, opts.cronId, LOG_KEEP, deps.logDir);

  writeRun(root, opts.cronId, {
    version: 1,
    id: runId,
    cronId: opts.cronId,
    startedAt: localStamp(),
    exit: exited,
    status,
    timedOut,
    outputLog: logPath,
    batchChanged,
  });
  return { runId, logPath };
}

export async function cronRun(root: string, opts: CronRunOptions, deps: ExecuteDeps): Promise<CmdResult> {
  const data = loadCrons(root);
  const cron = data.crons.find((c) => c.id === opts.cronId);
  if (!cron) fail(`no such cron: ${opts.cronId}`);
  if (!cron.enabled) {
    return { lines: [`jspace: ok: cron ${opts.cronId} is disabled, skipping`] };
  }
  const skillCtx: SkillTargetContext = {
    skillsManifest: deps.skillsManifest,
    bundleManifest: deps.bundleManifest,
    readFile: deps.readFile,
    recorded: readMaterializedJournal(root)?.files ?? {},
  };
  // Skill-target crons validate + compile HERE, before the dry-run return: a
  // missing/stale skill fails with a fix action and never reaches execution.
  const argv = harnessArgv(cron.harness, resolveCronPrompt(cron, root, skillCtx), deps.platform, deps.harnessBin);
  if (opts.dryRun) {
    return { lines: [`jspace: dry-run: would run in ${root}:`, `  $ ${argv.join(" ")}`] };
  }

  // Same-day success skip (launchd catch-up + manual rerun); --force bypasses.
  if (!opts.force && todaySuccess(root, opts.cronId)) {
    return { lines: [`jspace: ok: cron ${opts.cronId} already succeeded today, skipping`] };
  }

  // Exclusive single-instance lock (stale after timeout*2). The whole run body
  // sits in one try/finally so every exit path (incl. thrown guards) releases
  // the lock, and release() only removes OUR ownership token.
  const lockPath = join(root, ".jspace", "logs", "cron", `${opts.cronId}.lock`);
  mkdirSync(join(lockPath, ".."), { recursive: true });
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const lock = acquireLock(lockPath, token, opts.timeoutSec * LOCK_STALE_MS_MULTIPLE);
  if (lock === null) {
    return { lines: [`jspace: skip: cron ${opts.cronId} already running (lock ${lockPath})`] };
  }
  try {
    const fhRoot = deps.filehubRoot(root);
    const { isInboxTask, batchLog, batchBefore } = validateInboxGuard(cron, root, fhRoot);

    const started = deps.now();
    const { child, timer, collect } = spawnHarness(argv, deps.platform, root, opts.timeoutSec);
    const exited = await new Promise<number>((resolveExit) => {
      child.on("error", (e) => { console.error(`jspace: spawn error: ${e.message}`); resolveExit(1); });
      child.on("exit", (code) => resolveExit(code ?? 1));
    }).then((code) => {
      clearTimeout(timer);
      return code;
    });
    const output = collect();
    const timedOut = deps.now() - started > opts.timeoutSec * 1000;
    const exitOk = exited === 0 && !timedOut;
    const hasOutput = output.trim().length > 0;
    const suspect = exited === 0 && !timedOut && !hasOutput;
    const status: "ok" | "suspect" | "failed" = exitOk ? (suspect ? "suspect" : "ok") : "failed";

    let batchChanged = true;
    if (isInboxTask && batchLog !== null && isFile(batchLog)) {
      const st = statSync(batchLog);
      batchChanged = st.mtimeMs !== batchBefore.mtime || st.size !== batchBefore.size;
    }

    const { runId, logPath } = recordRun(root, opts, argv, exited, status, timedOut, batchChanged, output, deps);

    const failed = status === "failed" || suspect || (isInboxTask && !batchChanged);
    if (failed) {
      const failureClass = status === "failed" ? "failed" : isInboxTask && !batchChanged ? "batch-stale" : "suspect";
      openOrUpdate(root, opts.cronId, failureClass, runId);
      return { exitCode: status === "failed" ? 1 : 0, lines: [`jspace: ${status}: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
    }
    resolveIncidents(root, opts.cronId);
    return { lines: [`jspace: ok: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
  } finally {
    lock.release();
  }
}
