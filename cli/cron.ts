// cli/cron.ts — declarative cron definitions (.jspace/cron.json) + macOS launchd
// install + headless harness execution. Follows the registry.ts / cmds.ts idioms.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fail, rejectErrors } from "./errors.ts";
import { devRoot, expandTilde, isCompiled } from "./embed.ts";
import { isFile, resolvePath } from "./paths.ts";
import { CONFIG_DIR } from "./init.ts";
import { findIndex, ID_PATTERN, workbenchRoot } from "./registry.ts";

export const CRON_FILE = join(CONFIG_DIR, "cron.json");
const HARNESSES = ["claude", "codex", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

interface CronRecord {
  id: string;
  schedule: string;
  harness: string;
  prompt: string;
  enabled: boolean;
}

/** Local calendar date YYYY-MM-DD (no UTC shift). */
function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localStamp(): string {
  return `${localDate()}T${String(new Date().getHours()).padStart(2, "0")}${String(new Date().getMinutes()).padStart(2, "0")}${String(new Date().getSeconds()).padStart(2, "0")}`;
}

// ---- load/save ----
export function loadCrons(root: string): { version: number; crons: CronRecord[] } {
  const p = join(root, CRON_FILE);
  if (!isFile(p)) return { version: 1, crons: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    fail(`${CRON_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(`${CRON_FILE} root must be an object`);
  }
  const rec = data as Record<string, unknown>;
  if (rec.version !== 1) fail(`${CRON_FILE} version must be 1`);
  const crons = Array.isArray(rec.crons) ? (rec.crons as unknown[]) : [];
  return { version: 1, crons: crons.filter(isCronRecord) };
}

function isCronRecord(r: unknown): r is CronRecord {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.schedule === "string" &&
    typeof o.harness === "string" &&
    typeof o.prompt === "string" &&
    typeof o.enabled === "boolean"
  );
}

function saveCrons(root: string, data: { version: number; crons: CronRecord[] }): void {
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  writeFileSync(join(root, CRON_FILE), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---- schedule validation (restricted subset -> launchd dict) ----
interface ScheduleDict {
  Minute: number;
  Hour: number;
  Day?: number;
  Month?: number;
  Weekday?: number;
}
/** Parse a restricted 5-field cron expression. `*` omits the launchd key (any).
 *  Rejects lists/ranges/steps and day-of-month+day-of-week both set (launchd
 *  AND/OR semantics differ across macOS versions — refuse instead of guessing). */
export function parseSchedule(schedule: string): ScheduleDict {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) fail(`invalid schedule: ${schedule} (expected 5 fields)`);
  const [minute, hour, dom, month, dow] = fields;
  const num = (v: string, lo: number, hi: number, label: string): number | undefined => {
    if (v === "*") return undefined;
    if (!/^\d+$/.test(v)) {
      fail(`invalid ${label} in schedule: ${schedule} (MVP supports single values or *; lists/ranges/steps rejected)`);
    }
    const n = Number(v);
    if (n < lo || n > hi) fail(`invalid ${label} in schedule: ${schedule} (range ${lo}-${hi})`);
    return n;
  };
  const m = num(minute, 0, 59, "minute");
  const h = num(hour, 0, 23, "hour");
  const d = num(dom, 1, 31, "day-of-month");
  const mo = num(month, 1, 12, "month");
  const w = num(dow, 0, 7, "weekday");
  if (m === undefined) fail(`invalid schedule: ${schedule} (minute cannot be * for launchd; use e.g. "0 * * * *")`);
  if (h === undefined) fail(`invalid schedule: ${schedule} (hour cannot be * for launchd; use e.g. "0 21 * * *")`);
  if (d !== undefined && w !== undefined) {
    fail(`invalid schedule: ${schedule} (day-of-month and day-of-week cannot both be set in MVP; launchd semantics differ)`);
  }
  return { Minute: m, Hour: h, ...(d !== undefined && { Day: d }), ...(mo !== undefined && { Month: mo }), ...(w !== undefined && { Weekday: w }) };
}

// ---- cron add / list / remove ----
export function cmdCronAdd(
  id: string,
  schedule: string,
  harness: string,
  prompt: string,
  disabled: boolean,
): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  if (!ID_PATTERN.test(id)) fail(`invalid cron id: ${id} (lowercase letters, digits, hyphens)`);
  if (findIndex(data.crons, id) !== null) fail(`duplicate cron id: ${id}`);
  if (!HARNESSES.includes(harness as Harness)) {
    fail(`invalid harness: ${harness} (choose from ${HARNESSES.join(", ")})`);
  }
  if (!prompt.trim()) fail("prompt must be non-empty");
  parseSchedule(schedule); // validate
  data.crons.push({ id, schedule, harness, prompt, enabled: !disabled });
  saveCrons(root, data);
  console.log(`jspace: ok: added cron: ${id} (${schedule}, ${harness}, ${disabled ? "disabled" : "enabled"})`);
  if (plistExists(id)) {
    console.log(`jspace: hint: cron ${id} is installed; re-run "jspace cron install" to apply changes`);
  }
}

export function cmdCronList(json: boolean): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  if (json) {
    console.log(JSON.stringify({ version: data.version, crons: data.crons }, null, 2));
    return;
  }
  if (data.crons.length === 0) {
    console.log("jspace: ok: no crons defined (add one with: jspace cron add <id> --schedule ... )");
    return;
  }
  for (const c of data.crons) {
    console.log(`${c.enabled ? "" : "[disabled] "}${c.id}  ${c.schedule}  ${c.harness}`);
  }
}

export function cmdCronRemove(id: string): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  const index = findIndex(data.crons, id);
  if (index === null) fail(`no such cron: ${id}`);
  data.crons.splice(index, 1);
  saveCrons(root, data);
  console.log(`jspace: ok: removed cron: ${id}`);
  if (plistExists(id)) {
    console.log(`jspace: hint: cron ${id} is installed; re-run "jspace cron install" (or uninstall) to apply`);
  }
}

// ---- launchd install / uninstall ----
function plistPath(id: string): string {
  return join(homedir(), "Library", "LaunchAgents", `com.jspace.cron.${id}.plist`);
}
function plistExists(id: string): boolean {
  return isFile(plistPath(id));
}
export function installedPlists(): string[] {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("com.jspace.cron.") && n.endsWith(".plist"));
}

/** Absolute jspace binary for launchd (compiled: process.execPath; source: repo bin/jspace). */
function jspaceBinary(): string {
  return isCompiled() ? process.execPath : join(devRoot(), "bin", "jspace");
}
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildPlist(id: string, schedule: ScheduleDict, root: string): string {
  const launchdDir = join(root, ".jspace", "logs", "cron");
  const keys = ["Minute", "Hour", "Day", "Month", "Weekday"] as const;
  const dict = keys.filter((k) => schedule[k] !== undefined)
    .map((k) => `    <key>${k}</key>\n    <integer>${schedule[k]}</integer>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jspace.cron.${id}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(jspaceBinary())}</string>
    <string>cron</string>
    <string>run</string>
    <string>--id</string>
    <string>${xmlEscape(id)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${dict}
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")}</string>
    <key>HOME</key><string>${xmlEscape(homedir())}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xmlEscape(root)}</string>
  <key>StandardOutPath</key><string>${xmlEscape(join(launchdDir, `launchd-${id}.log`))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(launchdDir, `launchd-${id}.log`))}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

export function cmdCronInstall(): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  if (data.crons.length === 0) fail(`no crons defined (${join(root, CRON_FILE)} empty/missing)`);
  mkdirSync(join(root, ".jspace", "logs", "cron"), { recursive: true });
  const enabled = data.crons.filter((c) => c.enabled);
  if (enabled.length === 0) {
    console.log("jspace: ok: no enabled crons to install (all disabled)");
    return;
  }
  for (const c of enabled) {
    const p = plistPath(c.id);
    if (existsSync(p)) unlinkSync(p); // idempotent: replace
    writeFileSync(p, buildPlist(c.id, parseSchedule(c.schedule), root), "utf-8");
    const lint = spawnSync("plutil", ["-lint", p], { encoding: "utf-8" });
    if (lint.status !== 0) {
      fail(`plutil lint failed for ${p}: ${(lint.stderr ?? "").trim()}`);
    }
    // unload may fail (not loaded) — tolerate, then load.
    spawnSync("launchctl", ["unload", p]);
    const load = spawnSync("launchctl", ["load", p], { encoding: "utf-8" });
    if (load.status !== 0) {
      fail(`launchctl load failed for ${p}: ${(load.stderr ?? "").trim()}`);
    }
    console.log(`jspace: ok: installed cron ${c.id} (${c.schedule}) -> ${basename(p)}`);
  }
}

export function cmdCronUninstall(): void {
  for (const n of installedPlists()) {
    const p = join(homedir(), "Library", "LaunchAgents", n);
    spawnSync("launchctl", ["unload", p]); // tolerate not-loaded
    if (existsSync(p)) unlinkSync(p);
    console.log(`jspace: ok: removed ${n}`);
  }
  const root = workbenchRoot();
  const logDir = join(root, ".jspace", "logs", "cron");
  if (existsSync(logDir)) {
    for (const n of readdirSync(logDir)) {
      if (n.startsWith("launchd-")) unlinkSync(join(logDir, n));
    }
  }
  console.log("jspace: ok: cron uninstalled (launchd agents removed)");
}

// ---- cron run / status ----
function cronLogDir(root: string, id: string): string {
  return join(root, ".jspace", "logs", "cron", id);
}
function resolveHarnessBin(harness: string): string {
  const w = spawnSync("which", [harness], { encoding: "utf-8" });
  const out = (w.stdout ?? "").trim();
  return out || harness;
}
function harnessArgv(harness: string, prompt: string): string[] {
  const bin = resolveHarnessBin(harness);
  switch (harness) {
    case "claude":
      // Permission whitelist for the batch needs: Bash/Read/Write/Edit + gbrain MCP.
      // NEVER bypassPermissions — cron is unattended.
      return [bin, "-p", prompt, "--output-format", "text", "--allowedTools", "Bash,Read,Write,Edit,gbrain:*"];
    case "codex":
      return [bin, "exec", prompt];
    case "pi":
      return [bin, "-p", prompt];
    default:
      fail(`unsupported harness: ${harness}`);
  }
}
function todaySuccess(root: string, id: string): boolean {
  const dir = cronLogDir(root, id);
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
function pruneLogs(root: string, id: string, keep: number): void {
  const dir = cronLogDir(root, id);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  while (files.length > keep) {
    const rm = files.shift()!;
    unlinkSync(join(dir, rm));
  }
}
function appendFailed(root: string, id: string, reason: string, logPath: string): void {
  const p = join(root, ".jspace", "logs", "cron-failed.md");
  mkdirSync(dirname(p), { recursive: true });
  const entry = `- ${localStamp()}  ${id}  ${reason}  log: ${logPath}\n`;
  writeFileSync(p, entry, { flag: "a" });
  // keep last 30 lines
  const lines = readFileSync(p, "utf-8").split("\n");
  if (lines.length > 31) {
    writeFileSync(p, lines.slice(lines.length - 31).join("\n"), "utf-8");
  }
}

export async function cmdCronRun(id: string, dryRun: boolean, timeoutSec: number): Promise<void> {
  const root = workbenchRoot();
  const data = loadCrons(root);
  const cron = data.crons.find((c) => c.id === id);
  if (!cron) fail(`no such cron: ${id}`);
  if (!cron.enabled) {
    console.log(`jspace: ok: cron ${id} is disabled, skipping`);
    return;
  }
  const argv = harnessArgv(cron.harness, cron.prompt);
  if (dryRun) {
    console.log(`jspace: dry-run: would run in ${root}:`);
    console.log(`  $ ${argv.join(" ")}`);
    return;
  }

  // Same-day success skip (launchd catch-up + manual rerun both covered).
  if (todaySuccess(root, id)) {
    console.log(`jspace: ok: cron ${id} already succeeded today, skipping`);
    return;
  }
  // Best-effort single-instance lock (stale after timeout*2).
  const lock = join(root, ".jspace", "logs", "cron", `${id}.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  if (existsSync(lock)) {
    const age = Date.now() - statSync(lock).mtimeMs;
    if (age < timeoutSec * 2000) {
      console.log(`jspace: skip: cron ${id} already running (lock ${lock})`);
      return;
    }
    unlinkSync(lock);
  }
  writeFileSync(lock, String(process.pid), "utf-8");

  // inbox-tidy guard: skills/asset-ingest must exist; batch log must change.
  const isInboxTask = cron.prompt.includes("inbox");
  const batchLog = join(root, ".jspace", "logs", "inbox-batch.md");
  let batchBefore = { mtime: 0, size: -1 };
  if (isInboxTask) {
    if (!existsSync(join(root, "skills", "asset-ingest"))) {
      unlinkSync(lock);
      appendFailed(root, id, "missing skills/asset-ingest (batch pipeline)", "");
      fail(`cron ${id}: skills/asset-ingest not found in ${root}; refusing to run`);
    }
    if (isFile(batchLog)) {
      const st = statSync(batchLog);
      batchBefore = { mtime: st.mtimeMs, size: st.size };
    }
  }

  const env = { ...process.env, PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
  const out: Buffer[] = [];
  const started = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
  child.stderr?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
  const timer = setTimeout(() => {
    try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGKILL"); } catch {} }
  }, timeoutSec * 1000);

  const exited = await new Promise<number>((resolveExit) => {
    child.on("error", (e) => { console.error(`jspace: spawn error: ${e.message}`); resolveExit(1); });
    child.on("exit", (code) => resolveExit(code ?? 1));
  }).then((code) => {
    clearTimeout(timer);
    return code;
  });
  const output = Buffer.concat(out).toString("utf-8");
  const timedOut = Date.now() - started > timeoutSec * 1000;
  const exitOk = exited === 0 && !timedOut;
  const hasOutput = output.trim().length > 0;
  const suspect = exited === 0 && !timedOut && !hasOutput;
  const status = exitOk ? (suspect ? "suspect" : "ok") : "failed";

  // batch log change check for inbox tasks
  let batchChanged = true;
  if (isInboxTask && isFile(batchLog)) {
    const st = statSync(batchLog);
    batchChanged = st.mtimeMs !== batchBefore.mtime || st.size !== batchBefore.size;
  }
  if (isInboxTask && !batchChanged) {
    // treat as suspect: batch did not run even though exit 0
    appendFailed(root, id, `exit 0 but batch log unchanged (${batchLog})`, "");
  }

  const logDir = cronLogDir(root, id);
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${localStamp()}.md`);
  writeFileSync(logPath, [
    `# cron ${id}`,
    `time: ${localStamp()}`,
    `command: ${argv.join(" ")}`,
    `exit: ${exited}`,
    `status: ${status}`,
    `timed_out: ${timedOut}`,
    `batch_log_changed: ${batchChanged}`,
    "---",
    output.slice(0, 64_000),
  ].join("\n"), "utf-8");
  pruneLogs(root, id, 30);

  if (status === "failed" || suspect || (isInboxTask && !batchChanged)) {
    appendFailed(root, id, status === "failed" ? `exit ${exited}${timedOut ? " (timeout)" : ""}` : `suspect: no output / batch not run`, logPath);
    console.log(`jspace: ${status}: cron ${id} (exit ${exited}); log ${logPath}`);
    process.exitCode = status === "failed" ? 1 : 0;
  } else {
    console.log(`jspace: ok: cron ${id} (exit ${exited}); log ${logPath}`);
  }
  unlinkSync(lock);
}

export function cmdCronStatus(id?: string): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  const ids = id ? [id] : data.crons.map((c) => c.id);
  if (ids.length === 0) {
    console.log("jspace: ok: no crons defined");
    return;
  }
  for (const cid of ids) {
    const dir = cronLogDir(root, cid);
    const last = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).sort().pop() : undefined;
    if (!last) {
      console.log(`${cid}: never run`);
      continue;
    }
    const content = readFileSync(join(dir, last), "utf-8");
    const st = /^status: (.+)$/m.exec(content);
    const ex = /^exit: (.+)$/m.exec(content);
    const t = /^time: (.+)$/m.exec(content);
    console.log(`${cid}: ${st?.[1] ?? "?"} (exit ${ex?.[1] ?? "?"}, ${t?.[1] ?? "?"}) log ${join(dir, last)}`);
  }
}
