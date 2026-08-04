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
import { fail } from "../errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { loadCrons } from "./definitions.ts";
import { writeRun } from "./runs.ts";
import { openOrUpdate, resolveIncidents } from "./incidents.ts";
import { harnessArgv } from "../../adapters/harness/argv.ts";
import { isFile } from "../fs.ts";

export interface ExecuteDeps {
  platform: string;
  /** filehub root via the shared effective registry, or null when unbound. */
  filehubRoot: (root: string) => string | null;
  /** per-cron prose log dir (human payload). */
  logDir: (root: string, cronId: string) => string;
  /** clock in ms since epoch (injectable for deterministic timeouts). */
  now: () => number;
}

export interface CronRunOptions {
  cronId: string;
  dryRun: boolean;
  timeoutSec: number;
  force: boolean;
}

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localStamp(): string {
  const d = new Date();
  return `${localDate()}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
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
  const argv = harnessArgv(cron.harness, cron.prompt, deps.platform);
  if (opts.dryRun) {
    return { lines: [`jspace: dry-run: would run in ${root}:`, `  $ ${argv.join(" ")}`] };
  }

  // Same-day success skip (launchd catch-up + manual rerun); --force bypasses.
  if (!opts.force && todaySuccess(root, opts.cronId, deps.logDir)) {
    return { lines: [`jspace: ok: cron ${opts.cronId} already succeeded today, skipping`] };
  }

  // Best-effort single-instance lock (stale after timeout*2).
  const lock = join(root, ".jspace", "logs", "cron", `${opts.cronId}.lock`);
  mkdirSync(join(lock, ".."), { recursive: true });
  if (existsSync(lock)) {
    const age = deps.now() - statSync(lock).mtimeMs;
    if (age < opts.timeoutSec * 2000) {
      return { lines: [`jspace: skip: cron ${opts.cronId} already running (lock ${lock})`] };
    }
    unlinkSync(lock);
  }
  writeFileSync(lock, String(process.pid), "utf-8");

  // inbox-tidy guard: skills/asset-ingest must exist; batch log must change.
  // F3: the batch log lives at <filehub>/.jspace-logs/inbox-batch.md — the same
  // path the asset-ingest skill writes — not the workbench .jspace/logs/.
  const isInboxTask = cron.prompt.includes("inbox");
  const fhRoot = deps.filehubRoot(root);
  const batchLog = fhRoot !== null ? join(fhRoot, ".jspace-logs", "inbox-batch.md") : null;
  let batchBefore = { mtime: 0, size: -1 };
  if (isInboxTask) {
    if (!existsSync(join(root, "skills", "asset-ingest"))) {
      unlinkSync(lock);
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
  const started = deps.now();
  const needsShell = deps.platform === "win32" && /\.(cmd|exe|bat)$/i.test(argv[0]);
  const child = spawn(argv[0], argv.slice(1), {
    cwd: root,
    env,
    detached: deps.platform !== "win32",
    shell: needsShell,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
  child.stderr?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
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
  const logPath = join(logDir, `${localStamp()}.md`);
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

  const runId = crypto.randomUUID();
  writeRun(root, opts.cronId, {
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
    unlinkSync(lock);
    return { exitCode: status === "failed" ? 1 : 0, lines: [`jspace: ${status}: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
  }
  resolveIncidents(root, opts.cronId);
  unlinkSync(lock);
  return { lines: [`jspace: ok: cron ${opts.cronId} (exit ${exited}); log ${logPath}`] };
}
