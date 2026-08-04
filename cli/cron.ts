// cli/cron.ts — declarative cron definitions (.jspace/cron.json) + macOS launchd
// install + headless harness execution. Follows the registry.ts / cmds.ts idioms.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fail } from "../application/errors.ts";
import { devRoot, expandTilde, isCompiled } from "./embed.ts";
import { isFile, resolvePath } from "./paths.ts";
import { CONFIG_DIR } from "../core/contracts/files.ts";
import { readWorkbenchState, workbenchRoot } from "./registry.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../core/registry/effective.ts";
import { loadCrons, parseSchedule, type ScheduleDict } from "../application/automation/definitions.ts";
import { lastRun, writeRun } from "../application/automation/runs.ts";
import { openIncidents, openOrUpdate, readIncidents, resolveIncidents } from "../application/automation/incidents.ts";
import type { CronDefinition } from "../core/contracts/cron.ts";
export { parseSchedule };
export type { ScheduleDict };

export const CRON_FILE = join(CONFIG_DIR, "cron.json");

type Platform = "darwin" | "linux" | "win32";
const platform: Platform = process.platform as Platform;

/** POSIX single-quote quoting for crontab lines (paths may contain spaces/quotes). */
function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Stable short identity for a workbench root (used in Windows task names). */
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Local calendar date YYYY-MM-DD (no UTC shift). */
function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localStamp(): string {
  return `${localDate()}T${String(new Date().getHours()).padStart(2, "0")}${String(new Date().getMinutes()).padStart(2, "0")}${String(new Date().getSeconds()).padStart(2, "0")}`;
}

// ---- launchd install / uninstall ----
function plistPath(id: string): string {
  return join(homedir(), "Library", "LaunchAgents", `com.jspace.cron.${id}.plist`);
}
export function plistExists(id: string): boolean {
  return isFile(plistPath(id));
}
export function installedPlists(): string[] {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("com.jspace.cron.") && n.endsWith(".plist"));
}

/** Absolute jspace binary for scheduling. Compiled: process.execPath; source
 *  checkout: repo bin/jspace[.exe] (win32 probes for the .exe, H4). */
export function jspaceBinary(plat: Platform = platform): string {
  if (isCompiled()) return process.execPath;
  if (plat === "win32") {
    const exe = join(devRoot(), "bin", "jspace.exe");
    return existsSync(exe) ? exe : join(devRoot(), "bin", "jspace");
  }
  return join(devRoot(), "bin", "jspace");
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

export const CRON_BLOCK_START = "# jspace crons (managed) DO NOT EDIT";
export const CRON_BLOCK_END = "# end jspace";

/** Build the managed crontab block for the enabled crons. Every path is POSIX
 *  single-quoted (no space/quote/`$()`/backtick breakage) and `%` is escaped
 *  (cronie treats it as a newline). Lines over 1000 chars are rejected. */
export function crontabBlock(crons: CronDefinition[], root: string, jspaceBin: string, path: string, home: string): string {
  const lines = crons
    .filter((c) => c.enabled)
    .map((c) => {
      const d = parseSchedule(c.schedule);
      const dom = d.Day ?? "*";
      const mon = d.Month ?? "*";
      const dow = d.Weekday ?? "*";
      const log = join(root, ".jspace", "logs", "cron", `crontab-${c.id}.log`);
      const line =
        `${d.Minute} ${d.Hour} ${dom} ${mon} ${dow}  ` +
        `cd ${shq(root)} && PATH=${shq(path)} HOME=${shq(home)} ${shq(jspaceBin)} cron run --dir ${shq(root)} --id ${shq(c.id)} ` +
        `>> ${shq(log)} 2>&1`;
      if (line.length > 1000) fail(`crontab line for ${c.id} exceeds 1000 characters`);
      return line.replace(/%/g, "\\%");
    });
  return `${CRON_BLOCK_START}\n${lines.join("\n")}\n${CRON_BLOCK_END}\n`;
}

/** Replace the managed block in an existing crontab, preserving user lines.
 *  Handles: empty input, no existing block, empty block (removal), unterminated/
 *  stray/multiple markers. */
export function replaceManagedBlock(existing: string, block: string): string {
  const lines = existing.split("\n");
  const starts = lines.map((l, i) => (l.trim() === CRON_BLOCK_START ? i : -1)).filter((i) => i !== -1);
  const ends = lines.map((l, i) => (l.trim() === CRON_BLOCK_END ? i : -1)).filter((i) => i !== -1);
  if (starts.length > 1 || ends.length > 1) fail("crontab has multiple jspace blocks; clean manually");
  if (starts.length === 1 && ends.length === 0) fail("crontab has unterminated jspace block");
  if (starts.length === 0 && ends.length === 1) fail("crontab has a stray jspace end marker");
  if (starts.length === 1 && ends.length === 1 && ends[0] < starts[0]) fail("crontab jspace markers out of order");
  const removing = block.trim() === "";
  if (starts.length === 0) {
    if (removing) return existing; // nothing to remove
    const base = existing.replace(/\s+$/, "");
    return base ? `${base}\n${block}` : block;
  }
  const before = lines.slice(0, starts[0]);
  const after = lines.slice(ends[0] + 1);
  const blockLines = removing ? [] : block.replace(/\n$/, "").split("\n");
  let result = [...before, ...blockLines, ...after].join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}

/** Windows-only installability: DAILY (dom=* dow=*) or WEEKLY (dom=*, dow fixed); month=* and dom=*. */
export function isWindowsInstallable(schedule: string): boolean {
  const d = parseSchedule(schedule);
  return d.Month === undefined && d.Day === undefined;
}

/** Build schtasks args for a cron (DAILY/WEEKLY subset). Returns null when the
 *  schedule can't be expressed (reject with a clear error). */
export function schtasksArgs(cron: CronDefinition, jspaceBin: string, root: string, taskName: string): string[] | null {
  const d = parseSchedule(cron.schedule);
  if (!isWindowsInstallable(cron.schedule)) return null;
  const st = `${String(d.Hour).padStart(2, "0")}:${String(d.Minute).padStart(2, "0")}`;
  const tr = `"${jspaceBin}" cron run --dir "${root}" --id ${cron.id}`;
  const base = ["/create", "/tn", taskName, "/tr", tr, "/st", st, "/f", "/it"];
  if (d.Weekday === undefined) {
    return [...base, "/sc", "DAILY"];
  }
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return [...base, "/sc", "WEEKLY", "/d", days[d.Weekday % 7]]; // 0/7 -> SUN
}

/** IDs currently installed in the platform scheduler for this workbench. */
export function installedCronIds(root: string): string[] {
  if (platform === "darwin") {
    return installedPlists().map((n) => n.replace(/^com\.jspace\.cron\./, "").replace(/\.plist$/, ""));
  }
  if (platform === "linux") {
    const res = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
    const out = res.status === 0 ? (res.stdout ?? "") : "";
    const ids: string[] = [];
    for (const m of out.matchAll(/cron run --dir '([^']*)' --id '([^']+)'/g)) {
      const dir = m[1];
      if (resolvePath(dir) === root) ids.push(m[2]);
    }
    return ids;
  }
  if (platform === "win32") {
    const wbId = shortHash(root);
    const res = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf-8" });
    const out = res.status === 0 ? (res.stdout ?? "") : "";
    const prefix = `JSpaceCron_${wbId}_`;
    return out.split(/\r?\n/).map((l) => l.split(",")[0].replace(/^"|"$/g, ""))
      .filter((n) => n.startsWith(prefix))
      .map((n) => n.slice(prefix.length));
  }
  return [];
}

/** Linux cron health for doctor: crontab command present + cron daemon running. */
export function linuxCronHealth(): { crontab: boolean; service: boolean } {
  const c = spawnSync("sh", ["-c", "command -v crontab"], { encoding: "utf-8" });
  const s = spawnSync("sh", ["-c", "pgrep -x crond >/dev/null 2>&1 || pgrep -x cron >/dev/null 2>&1"], { encoding: "utf-8" });
  return { crontab: (c.stdout ?? "").trim() !== "", service: s.status === 0 };
}

function installLinuxCrons(root: string, enabled: CronDefinition[]): void {
  mkdirSync(join(root, ".jspace", "logs", "cron"), { recursive: true });
  const res = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
  let existing = "";
  if (res.status === 0) {
    existing = (res.stdout ?? "").replace(/\s+$/, "") + "\n";
  } else if (res.status !== 1) {
    fail(`crontab -l failed (status ${res.status}): ${(res.stderr ?? "").trim()}`);
  }
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const home = homedir();
  const block = crontabBlock(enabled, root, jspaceBinary(), path, home);
  const merged = replaceManagedBlock(existing, block);
  const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, existing, "utf-8");
  const write = spawnSync("crontab", ["-"], { input: merged, encoding: "utf-8" });
  if (write.status !== 0) {
    fail(`crontab write failed: ${(write.stderr ?? "").trim()} (backup: ${backup})`);
  }
  console.log(`jspace: ok: installed ${enabled.length} cron(s) into crontab`);
}

function installWindowsCrons(root: string, enabled: CronDefinition[]): void {
  const wbId = shortHash(root);
  for (const c of enabled) {
    if (!isWindowsInstallable(c.schedule)) {
      fail(`cron ${c.id}: schedule "${c.schedule}" not supported on Windows (MVP: DAILY/WEEKLY with month=*)`);
    }
    const taskName = `JSpaceCron_${wbId}_${c.id}`;
    const args = schtasksArgs(c, jspaceBinary("win32"), root, taskName);
    if (!args) fail(`cron ${c.id}: cannot express schedule "${c.schedule}" as a Windows task`);
    const res = spawnSync("schtasks", args, { encoding: "utf-8" });
    if (res.status !== 0) fail(`schtasks create failed for ${c.id}: ${(res.stderr ?? "").trim()}`);
    console.log(`jspace: ok: installed cron ${c.id} -> ${taskName}`);
  }
}


function installDarwinCrons(root: string, enabled: CronDefinition[]): void {
  mkdirSync(join(root, ".jspace", "logs", "cron"), { recursive: true });
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

export function cmdCronInstall(): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  if (data.crons.length === 0) fail(`no crons defined (${join(root, CRON_FILE)} empty/missing)`);
  const enabled = data.crons.filter((c) => c.enabled);
  if (enabled.length === 0) {
    console.log("jspace: ok: no enabled crons to install (all disabled)");
    return;
  }
  if (platform === "darwin") installDarwinCrons(root, enabled);
  else if (platform === "linux") installLinuxCrons(root, enabled);
  else if (platform === "win32") installWindowsCrons(root, enabled);
  else fail(`unsupported platform: ${platform}`);
}

function uninstallDarwin(): void {
  for (const n of installedPlists()) {
    const p = join(homedir(), "Library", "LaunchAgents", n);
    spawnSync("launchctl", ["unload", p]); // tolerate not-loaded
    if (existsSync(p)) unlinkSync(p);
    console.log(`jspace: ok: removed ${n}`);
  }
  const logDir = join(workbenchRoot(), ".jspace", "logs", "cron");
  if (existsSync(logDir)) {
    for (const n of readdirSync(logDir)) {
      if (n.startsWith("launchd-")) unlinkSync(join(logDir, n));
    }
  }
}

function uninstallLinux(): void {
  const root = workbenchRoot();
  const res = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
  if (res.status === 1) {
    console.log("jspace: ok: no crontab to clean");
    return;
  }
  if (res.status !== 0) fail(`crontab -l failed: ${(res.stderr ?? "").trim()}`);
  const existing = (res.stdout ?? "").replace(/\s+$/, "") + "\n";
  const merged = replaceManagedBlock(existing, "");
  const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, existing, "utf-8");
  if (merged.trim() === "") {
    const r = spawnSync("crontab", ["-r"], { encoding: "utf-8" });
    if (r.status !== 0 && r.status !== 1) fail(`crontab -r failed: ${(r.stderr ?? "").trim()}`);
    console.log("jspace: ok: removed jspace crons (empty crontab removed)");
    return;
  }
  const w = spawnSync("crontab", ["-"], { input: merged, encoding: "utf-8" });
  if (w.status !== 0) fail(`crontab write failed: ${(w.stderr ?? "").trim()}`);
  console.log("jspace: ok: removed jspace crons from crontab");
}

function uninstallWindows(): void {
  const root = workbenchRoot();
  const wbId = shortHash(root);
  const res = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf-8" });
  const out = res.status === 0 ? (res.stdout ?? "") : "";
  const prefix = `JSpaceCron_${wbId}_`;
  const tasks = out
    .split(/\r?\n/)
    .map((l) => l.split(",")[0].replace(/^"|"$/g, ""))
    .filter((n) => n.startsWith(prefix));
  for (const t of tasks) {
    spawnSync("schtasks", ["/delete", "/tn", t, "/f"], { encoding: "utf-8" });
    console.log(`jspace: ok: removed ${t}`);
  }
  if (tasks.length === 0) console.log("jspace: ok: no jspace scheduled tasks to remove");
}

export function cmdCronUninstall(): void {
  if (platform === "darwin") uninstallDarwin();
  else if (platform === "linux") uninstallLinux();
  else if (platform === "win32") uninstallWindows();
  else fail(`unsupported platform: ${platform}`);
  console.log("jspace: ok: cron uninstalled");
}

// ---- cron run / status ----
function cronLogDir(root: string, id: string): string {
  return join(root, ".jspace", "logs", "cron", id);
}
function resolveHarnessBin(harness: string): string {
  const cmd = platform === "win32" ? "where" : "which";
  const w = spawnSync(cmd, [harness], { encoding: "utf-8" });
  return (w.stdout ?? "").trim().split(/\r?\n/)[0] || harness; // win: first line only
}
function harnessArgv(harness: string, prompt: string): string[] {
  const bin = resolveHarnessBin(harness);
  switch (harness) {
    case "claude":
      // Permission whitelist for the batch needs: Bash/Read/Write/Edit + gbrain MCP.
      // NEVER bypassPermissions — cron is unattended.
      // MCP allow-rule syntax: literal `mcp__<server>__` prefix then glob tool name.
      return [bin, "-p", prompt, "--output-format", "text", "--allowedTools", "Bash,Read,Write,Edit,mcp__gbrain__*"];
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

export async function cmdCronRun(id: string, dryRun: boolean, timeoutSec: number, dirArg?: string, force = false): Promise<void> {
  const root = dirArg ? resolvePath(expandTilde(dirArg)) : workbenchRoot();
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

  // Same-day success skip (launchd catch-up + manual rerun both covered);
  // --force bypasses it.
  if (!force && todaySuccess(root, id)) {
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

  const defaultPath = platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const out: Buffer[] = [];
  const started = Date.now();
  const needsShell = platform === "win32" && /\.(cmd|exe|bat)$/i.test(argv[0]);
  const child = spawn(argv[0], argv.slice(1), { cwd: root, env, detached: platform !== "win32", shell: needsShell, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
  child.stderr?.on("data", (d: Buffer) => { if (out.join("").length < 1_000_000) out.push(d); });
  const timer = setTimeout(() => {
    if (platform === "win32") {
      // Windows has no POSIX process groups; kill the whole tree via taskkill.
      try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]); } catch {}
    } else {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGKILL"); } catch {} }
    }
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

  // structured run record (machine truth; prose log above is the human payload)
  const runId = crypto.randomUUID();
  writeRun(root, id, {
    id: runId,
    cronId: id,
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
    openOrUpdate(root, id, failureClass, runId);
    console.log(`jspace: ${status}: cron ${id} (exit ${exited}); log ${logPath}`);
    process.exitCode = status === "failed" ? 1 : 0;
  } else {
    resolveIncidents(root, id);
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
    const last = lastRun(root, cid);
    if (!last) {
      console.log(`${cid}: never run`);
      continue;
    }
    console.log(`${cid}: ${last.status} (exit ${last.exit ?? "?"}, ${last.startedAt}) log ${last.outputLog}`);
  }
}

// ---- cron failures (session-start check surface) ----

/** Resolve the filehub root via the shared effective registry (type:filehub,
 *  primary path), or null when unregistered/unbound — then pending scan is skipped. */
export function filehubRoot(root: string): string | null {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok") return null;
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  return primaryPathForResourceType(effective, "filehub");
}

/** Find pending staged gbrain writes: <filehub>/.jspace-logs/*.APPLY.md. */
export function findPendingApplies(root: string): { root: string | null; paths: string[] } {
  const fh = filehubRoot(root);
  if (!fh) return { root: null, paths: [] };
  const dir = join(fh, ".jspace-logs");
  if (!existsSync(dir)) return { root: fh, paths: [] };
  const paths = readdirSync(dir).filter((n) => n.endsWith(".APPLY.md")).sort().map((n) => join(dir, n));
  return { root: fh, paths };
}

/**
 * `jspace cron failures [--json]` / `jspace cron check [--json]` — one-place
 * session-start surface: recent failures + pending staged gbrain writes +
 * per-cron status. Exit 1 when anything needs attention (for hooks/scripts).
 */
export function cmdCronFailures(json: boolean, root?: string): void {
  const wb = root ?? workbenchRoot();
  const ids = loadCrons(wb).crons.map((c) => c.id);

  const incidents = readIncidents(wb);
  const open = incidents.filter((i) => i.status === "open");
  const acknowledged = incidents.filter((i) => i.status === "acknowledged");
  const pending = findPendingApplies(wb);
  const crons = ids.map((id) => {
    const last = lastRun(wb, id);
    return { id, status: last?.status ?? "never run" };
  });
  const failed = crons.filter((c) => c.status === "failed").length;
  const suspect = crons.filter((c) => c.status === "suspect").length;
  const neverRun = crons.filter((c) => c.status === "never run").length;
  // alert only on open (unacknowledged) incidents or actionable pending writes
  const needsAttention = open.length + pending.paths.length;

  if (json) {
    console.log(JSON.stringify({
      incidents: incidents.map((i) => ({
        cron: i.cronId,
        failure_class: i.failureClass,
        status: i.status,
        opened_at: i.openedAt,
        acknowledged_at: i.acknowledgedAt,
        resolved_at: i.resolvedAt,
        evidence: i.evidence,
      })),
      open_incidents: open.length,
      acknowledged_incidents: acknowledged.length,
      pending_applies: pending.paths,
      crons,
      summary: {
        failures: failed,
        suspect,
        never_run: neverRun,
        pending_applies: pending.paths.length,
        open_incidents: open.length,
        needs_attention: needsAttention,
      },
    }));
  } else {
    console.log("jspace: cron failures");
    console.log(`open incidents: (${open.length})`);
    for (const i of open) console.log(`  ${i.cronId} [${i.failureClass}] ${i.openedAt} evidence: ${i.evidence.join(", ")}`);
    console.log(`pending gbrain writes (APPLY.md): (${pending.paths.length})`);
    for (const p of pending.paths) console.log(`  ${p}`);
    console.log("cron status:");
    for (const c of crons) console.log(`  ${c.id}: ${c.status}`);
    console.log(`needs_attention: ${needsAttention}`);
  }
  process.exitCode = needsAttention > 0 ? 1 : 0;
}
