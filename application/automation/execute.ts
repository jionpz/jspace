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
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";
import { loadCrons, resolveCronPrompt, type SkillTargetContext } from "./definitions.ts";
import { readMaterializedJournal } from "../workspace/journal.ts";
import { writeRun } from "./runs.ts";
import { openOrUpdate, resolveIncidents } from "./incidents.ts";
import { acquireLock } from "./lock.ts";
import { win32SpawnTarget } from "./win32-spawn.ts";
import { harnessArgv } from "../../adapters/harness/argv.ts";
import { isFile } from "../fs.ts";
import { localDate, localStamp } from "../time.ts";

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

function todaySuccess(root: string, cronId: string, logDir: (r: string, c: string) => string): boolean {
  const dir = logDir(root, cronId);
  if (!existsSync(dir)) return false;
  const today = localDate();
  for (const n of readdirSync(dir)) {
    if (n.startsWith(today) && n.endsWith(".md")) {
      const s = readFileSync(join(dir, n), "utf-8");
      if (s.includes("status: ok")) return true;
    }
  }
  return false;
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
  if (!opts.force && todaySuccess(root, opts.cronId, deps.logDir)) {
    return { lines: [`jspace: ok: cron ${opts.cronId} already succeeded today, skipping`] };
  }

  // Exclusive single-instance lock (stale after timeout*2). The whole run body
  // sits in one try/finally so every exit path (incl. thrown guards) releases
  // the lock, and release() only removes OUR ownership token.
  const lockPath = join(root, ".jspace", "logs", "cron", `${opts.cronId}.lock`);
  mkdirSync(join(lockPath, ".."), { recursive: true });
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const lock = acquireLock(lockPath, token, opts.timeoutSec * 2000);
  if (lock === null) {
    return { lines: [`jspace: skip: cron ${opts.cronId} already running (lock ${lockPath})`] };
  }
  try {
    return await (async () => {

  // inbox-tidy guard: skills/asset-ingest must exist; batch log must change.
  // F3: the batch log lives at <filehub>/.jspace-logs/inbox-batch.md — the same
  // path the asset-ingest skill writes — not the workbench .jspace/logs/.
  // inbox-tidy detection no longer reads prose prompt text (prompt is optional
  // for skill-target crons): key off the cron id or the asset-ingest target so
  // the batch guard survives the prompt→target migration (F3 not regressed).
  const isInboxTask = cron.id === "inbox-tidy" || cron.target?.skill === "asset-ingest";
  const fhRoot = deps.filehubRoot(root);
  const batchLog = fhRoot !== null ? join(fhRoot, ".jspace-logs", "inbox-batch.md") : null;
  let batchBefore = { mtime: 0, size: -1 };
  if (isInboxTask) {
    if (!existsSync(join(root, "skills", "asset-ingest"))) {
      openOrUpdate(root, opts.cronId, "batch-stale", crypto.randomUUID());
      fail(`cron ${opts.cronId}: skills/asset-ingest not found in ${root}; refusing to run`);
    }
    if (batchLog !== null && isFile(batchLog)) {
      const st = statSync(batchLog);
      batchBefore = { mtime: st.mtimeMs, size: st.size };
    }
  }

  const defaultPath = deps.platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const out: Buffer[] = [];
  let outBytes = 0;
  const MAX_OUT = 1_000_000;
  const pushOutput = (d: Buffer): void => {
    if (outBytes >= MAX_OUT) return;
    const take = Math.min(d.length, MAX_OUT - outBytes);
    out.push(d.subarray(0, take));
    outBytes += take;
  };
  const started = deps.now();
  // win32: .cmd/.bat can't spawn directly -> route through cmd.exe via the
  // testable builder; .exe/.com (and every non-win32 binary) spawn directly,
  // so no shell:true is ever needed (shell quoting would mangle spaced args).
  const spawnTarget = deps.platform === "win32"
    ? win32SpawnTarget(argv)
    : { command: argv[0], args: argv.slice(1), verbatim: false };
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: root,
    env,
    detached: deps.platform !== "win32",
    windowsVerbatimArguments: spawnTarget.verbatim,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", pushOutput);
  child.stderr?.on("data", pushOutput);
  const timer = setTimeout(() => {
    if (deps.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } catch { /* ignore */ }
    } else {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    }
  }, opts.timeoutSec * 1000);

  const exited = await new Promise<number>((resolveExit) => {
    child.on("error", (e) => { console.error(`jspace: spawn error: ${e.message}`); resolveExit(1); });
    child.on("exit", (code) => resolveExit(code ?? 1));
  }).then((code) => {
    clearTimeout(timer);
    return code;
  });
  const output = Buffer.concat(out).toString("utf-8");
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
    output.slice(0, 64_000),
  ].join("\n"), "utf-8");
  pruneLogs(root, opts.cronId, 30, deps.logDir);

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

  const failed = status === "failed" || suspect || (isInboxTask && !batchChanged);
  if (failed) {
    const failureClass = status === "failed" ? "failed" : isInboxTask && !batchChanged ? "batch-stale" : "suspect";
    openOrUpdate(root, opts.cronId, failureClass, runId);
    return { exitCode: status === "failed" ? 1 : 0, lines: [`jspace: ${status}: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
  }
  resolveIncidents(root, opts.cronId);
  return { lines: [`jspace: ok: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
  })();
  } finally {
    lock.release();
  }
}
