// application/automation/execute.ts — headless cron execution (moved from
// cli/cron.ts cmdCronRun). Runs a cron's harness argv, records a structured
// RunRecord, opens/resolves incidents, and applies the inbox batch guard.
// Platform/filehub/log-dir/clock are injected so statuses are testable without
// spawning a real harness.
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
import { spawnProcess, cronSpawnEnv } from "../../adapters/process/spawn.ts";
import { loadCrons, resolveCronPrompt, type SkillTargetContext } from "./definitions.ts";
import { skillRel, skillRoot } from "../fs.ts";
import { lastRun, writeRun } from "./runs.ts";
import { openOrUpdate, resolveIncidents } from "./incidents.ts";
import { acquireLockWithClock } from "./lock.ts";
import { harnessArgv } from "../../adapters/harness/argv.ts";
import { isFile } from "../fs.ts";
import { localDate, localStamp } from "../time.ts";

/** Prose log body truncation (bytes) — the RunRecord is machine truth; the log
 *  only needs enough to debug. */
const LOG_TRUNCATE_BYTES = 64_000;
/** Number of prose logs kept per cron (oldest pruned). */
const LOG_KEEP = 30;
/** Lock stale tolerance (ms) per second of timeoutSec. A live run holds the
 *  lock for at most timeoutSec seconds, so 2x (2000ms per second of timeoutSec)
 *  is a safe margin for clock skew / slow spawn before another process may take
 *  over. Units matter: acquireLock's staleMs is ms, so timeoutSec × 2000 = 1h
 *  stale at the default timeoutSec=1800 (NOT timeoutSec × 2ms = 3.6s, which
 *  would let a second process steal the lock a few seconds after the run
 *  starts). */
const LOCK_STALE_MS_PER_TIMEOUT_SEC = 2000;

export interface ExecuteDeps {
  platform: string;
  /** filehub root via the shared effective registry, or null when unbound. */
  filehubRoot: (root: string) => string | null;
  /** per-cron prose log dir (human payload). */
  logDir: (root: string, cronId: string) => string;
  /** clock in ms since epoch (injectable for deterministic timeouts). */
  now: () => number;
  /** skill-target validation/compile context; injected so application
   *  never imports the generated cli/*.generated.ts. */
  skillsManifest: SkillsManifestV1;
  bundleManifest: DistributionManifestV1;
  readFile: (p: string) => string | null;
  /** Freshness diff (materialized workbench vs bundle) + materialization journal.
   *  Injected so automation never imports workspace/* (breaks the
   *  workspace↔automation ring). */
  diffBundle: (
    root: string,
    manifest: DistributionManifestV1,
    deps: { readFile: (p: string) => string | null; recorded: Record<string, { sha256: string }> },
  ) => { rel: string; action: string }[];
  readMaterializedJournal: (root: string) => { files: Record<string, { sha256: string }> } | null;
  /** optional harness binary override (tests: fake harness; prod: undefined → PATH resolve). */
  harnessBin?: string;
}

export interface CronRunOptions {
  cronId: string;
  dryRun: boolean;
  timeoutSec: number;
  force: boolean;
  /** Override the cron definition's harness (e.g. `jspace cron run --harness grok`
   *  to probe a new harness argv without editing cron.json). Falls back to the
   *  cron's own harness when absent. */
  harnessOverride?: string;
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
 *  change during the run. The batch log lives at
 *  <filehub>/.jspace-logs/inbox-batch.md — the same path the asset-ingest skill
 *  writes — not the workbench .jspace/logs/. inbox-tidy detection no longer reads
 *  prose prompt text (prompt is optional for skill-target crons): key off the
 *  cron id or the asset-ingest target so the guard survives the prompt→target
 *  migration (batch-log format not regressed). */
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
 *  win32 .cmd/.bat routing and the timeout kill live in adapters/process/spawn.ts;
 *  the executor only passes argv + config. */

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
    schema_version: 1,
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
    recorded: deps.readMaterializedJournal(root)?.files ?? {},
    diffBundle: deps.diffBundle,
  };
  // Skill-target crons validate + compile HERE, before the dry-run return: a
  // missing/stale skill fails with a fix action and never reaches execution.
  const harness = opts.harnessOverride ?? cron.harness;
  const argv = harnessArgv(harness, resolveCronPrompt(cron, root, skillCtx), deps.platform, deps.harnessBin);
  if (opts.dryRun) {
    return { lines: [`jspace: dry-run: would run in ${root}:`, `  $ ${argv.join(" ")}`] };
  }

  // Same-day success skip (launchd catch-up + manual rerun); --force bypasses.
  if (!opts.force && todaySuccess(root, opts.cronId)) {
    return { lines: [`jspace: ok: cron ${opts.cronId} already succeeded today, skipping`] };
  }

  // Exclusive single-instance lock (stale after timeoutSec × 2000ms). The whole
  // run body sits in one try/finally so every exit path (incl. thrown guards)
  // releases the lock, and release() only removes OUR ownership token. The lock
  // uses the injected deps.now clock so staleness is deterministic in tests.
  const lockPath = join(root, ".jspace", "logs", "cron", `${opts.cronId}.lock`);
  mkdirSync(join(lockPath, ".."), { recursive: true });
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const lock = acquireLockWithClock(lockPath, token, opts.timeoutSec * LOCK_STALE_MS_PER_TIMEOUT_SEC, deps.now);
  if (lock === null) {
    return { lines: [`jspace: skip: cron ${opts.cronId} already running (lock ${lockPath})`] };
  }
  try {
    const fhRoot = deps.filehubRoot(root);
    const { isInboxTask, batchLog, batchBefore } = validateInboxGuard(cron, root, fhRoot);

    const spawned = await spawnProcess(argv, { cwd: root, platform: deps.platform, timeoutMs: opts.timeoutSec * 1000, env: cronSpawnEnv(deps.platform) });
    const exited = spawned.exit;
    const output = spawned.output;
    const timedOut = spawned.timedOut;
    const exitOk = exited === 0 && !timedOut;
    const hasOutput = output.trim().length > 0;
    const suspect = exited === 0 && !timedOut && !hasOutput;
    const status: "ok" | "suspect" | "failed" = exitOk ? (suspect ? "suspect" : "ok") : "failed";

    let batchChanged = true;
    if (isInboxTask) {
      if (batchLog !== null && isFile(batchLog)) {
        const st = statSync(batchLog);
        batchChanged = st.mtimeMs !== batchBefore.mtime || st.size !== batchBefore.size;
      } else {
        // 无 filehub 或 batch 日志从未出现 → 无法验证批次变化，强制 stale，
        // 否则假成功记 ok（issue #8 #6）。
        batchChanged = false;
      }
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
