// adapters/scheduler/linux.ts — crontab adapter (managed block, tag-scoped).
// Crontab is whole-file: the managed block's only safe write path is applyBatch
// (a single-op apply was removed because it wrote a per-cron line as if it were
// the whole block).
// Task identity: com.jspace.cron.<tag>.<id> appears inside the managed-block
// comment lines; inspect() only matches lines whose task identity carries THIS
// workbench tag (parseManagedLine), so another workbench's crons are never
// touched. Crontab is machine-global and tag-filtered per line — no root/path
// matching is needed (an old build claimed env.resolvePath did that; it never did).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { schedulerSpawn, type SchedulerSpawn } from "./spawn.ts";
import { taskIdFor, posixIdentity, type InstalledTask, type LinuxCronHealth, type SchedulerAdapter, type SchedulerEnv, type SchedulerIdentity, type SchedulerOp } from "./types.ts";

/** Tag-scoped managed-block markers: two workbenches never share one block. */
export const CRON_BLOCK_START = (tag: string): string => `# jspace crons ${tag} (managed) DO NOT EDIT`;
export const CRON_BLOCK_END = (tag: string): string => `# end jspace ${tag}`;
/** Pre-tag markers from unreleased builds — never silently claimed; fail loud. */
const LEGACY_BLOCK_START = "# jspace crons (managed) DO NOT EDIT";
const LEGACY_BLOCK_END = "# end jspace";

function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** POSIX single-quote unquote of a `shq`-produced token: `'a'\''b'` -> a'b.
 *  Also restores crontab's `\%` -> `%` (crontabLine escapes % at line level). */
function unshq(v: string): string {
  const inner = v.slice(1, -1);
  return inner.replace(/'\\''/g, "'").replace(/\\%/g, "%");
}

/** Length of the leading single-quoted token at s (POSIX: `'\''` is a literal
 *  quote), or -1 when malformed. Lets the parser find `--dir '...'` / `--id '...'`
 *  values even when the value itself contains `'` (shq escapes it). */
function quotedTokenLen(s: string): number {
  if (s[0] !== "'") return -1;
  let i = 1;
  while (i < s.length) {
    if (s[i] === "'" && s[i + 1] === "\\" && s[i + 2] === "'" && s[i + 3] === "'") { i += 4; continue; }
    if (s[i] === "'") return i + 1; // closing quote
    i += 1;
  }
  return -1;
}

/** Refuse control characters that would let a value split the crontab line into
 *  a new cron entry (newline injection, issue #8 #12). */
function rejectControlChars(...vals: string[]): void {
  for (const v of vals) {
    if (/[\n\r\u0000]/.test(v)) {
      fail(`crontab values must not contain newline/CR/NUL: ${JSON.stringify(v)}`);
    }
  }
}

/** One managed crontab line for a cron (schedule + quoted jspace run). Shared
 *  by buildContent (per-cron install content) and crontabBlock (whole-block). */
export function crontabLine(
  c: CronDefinition,
  tag: string,
  root: string,
  jspaceBin: string,
  path: string,
  home: string,
): string {
  const d = parseSchedule(c.schedule);
  const log = join(root, ".jspace", "logs", "cron", `crontab-${c.id}.log`);
  rejectControlChars(root, path, home, jspaceBin, c.id, log);
  const dom = d.Day ?? "*";
  const mon = d.Month ?? "*";
  const dow = d.Weekday ?? "*";
  const line =
    `${d.Minute} ${d.Hour} ${dom} ${mon} ${dow}  ` +
    `cd ${shq(root)} && PATH=${shq(path)} HOME=${shq(home)} ${shq(jspaceBin)} cron run --dir ${shq(root)} --id ${shq(c.id)} ` +
    `>> ${shq(log)} 2>&1  # ${taskIdFor(tag, c.id)}`;
  if (line.length > 1000) fail(`crontab line for ${c.id} exceeds 1000 characters`);
  return line.replace(/%/g, "\\%");
}

/** Managed crontab block for one workbench; every path is POSIX single-quoted, `%` escaped. */
export function crontabBlock(
  crons: CronDefinition[],
  tag: string,
  root: string,
  jspaceBin: string,
  path: string,
  home: string,
): string {
  const lines = crons
    .filter((c) => c.enabled)
    .map((c) => crontabLine(c, tag, root, jspaceBin, path, home));
  return `${CRON_BLOCK_START(tag)}\n${lines.join("\n")}\n${CRON_BLOCK_END(tag)}\n`;
}

/** Replace only THIS workbench's managed block in an existing crontab, preserving
 *  user lines and every other workbench's block. Fail loud on a legacy untagged
 *  block (never claimed), or on duplicate/stray/unterminated/out-of-order
 *  markers for this tag. */
export function replaceManagedBlock(existing: string, block: string, tag: string): string {
  const lines = existing.split("\n");
  const startMark = CRON_BLOCK_START(tag);
  const endMark = CRON_BLOCK_END(tag);
  const starts = lines.map((l, i) => (l.trim() === startMark ? i : -1)).filter((i) => i !== -1);
  const ends = lines.map((l, i) => (l.trim() === endMark ? i : -1)).filter((i) => i !== -1);
  if (lines.some((l) => l.trim() === LEGACY_BLOCK_START) || lines.some((l) => l.trim() === LEGACY_BLOCK_END)) {
    fail("crontab has a legacy untagged jspace block; remove it manually before reinstalling (old \"# jspace crons (managed)\" markers)");
  }
  if (starts.length > 1) fail(`crontab has multiple jspace blocks for workbench ${tag}; clean manually`);
  if (ends.length > 1) fail(`crontab has multiple jspace end markers for workbench ${tag}; clean manually`);
  if (starts.length === 1 && ends.length === 0) fail(`crontab has an unterminated jspace block for workbench ${tag}`);
  if (starts.length === 0 && ends.length === 1) fail(`crontab has a stray jspace end marker for workbench ${tag}`);
  if (starts.length === 1 && ends.length === 1 && ends[0] < starts[0]) fail(`crontab jspace markers out of order for workbench ${tag}`);
  const removing = block.trim() === "";
  if (starts.length === 0) {
    if (removing) return existing; // nothing to remove for this tag
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

/** Return THIS workbench's managed block (markers included), or "" when absent. */
export function extractTagBlock(existing: string, tag: string): string {
  const lines = existing.split("\n");
  const s = lines.findIndex((l) => l.trim() === CRON_BLOCK_START(tag));
  if (s === -1) return "";
  const e = lines.findIndex((l, i) => i > s && l.trim() === CRON_BLOCK_END(tag));
  if (e === -1) return "";
  return lines.slice(s, e + 1).join("\n");
}

/** crontab read/write IO. Production default shells out to `crontab`; tests
 *  inject this seam so applyBatch/inspect/uninstallAll never touch the real
 *  crontab. */
export interface CrontabIO {
  readCrontab(): string;
  writeCrontab(content: string): void;
}

const defaultIO: CrontabIO = {
  readCrontab(): string {
    const res = schedulerSpawn("crontab", ["-l"]);
    if (res.status === 0) return (res.stdout ?? "").replace(/\s+$/, "") + "\n";
    if (res.status === 1) return ""; // no crontab
    fail(`crontab -l failed (status ${res.status}): ${(res.stderr ?? "").trim()}`);
    return "";
  },
  writeCrontab(content: string): void {
    const r = schedulerSpawn("crontab", ["-"], { input: content });
    if (r.status !== 0) fail(`crontab write failed: ${(r.stderr ?? "").trim()}`);
  },
};

/** Read `/proc/self/status` for the NSpid isolation probe. A missing/unreadable
 *  procfs (non-Linux test host) degrades to empty -> pidNamespaceIsolated=false. */
function readProcStatusFile(): string {
  try {
    return readFileSync("/proc/self/status", "utf-8");
  } catch {
    return "";
  }
}

/** Read the single-quoted value of `--<opt> '...'` in a crontab run segment,
 *  properly unquoting `'\''` and restoring `\%`. Null when absent/malformed. */
function optionQuoted(s: string, opt: string): string | null {
  const at = s.indexOf(opt);
  if (at === -1) return null;
  const rest = s.slice(at + opt.length).trimStart();
  const len = quotedTokenLen(rest);
  if (len === -1) return null;
  return unshq(rest.slice(0, len));
}

/** Whether the current process runs in a nested PID namespace, parsed from
 *  `/proc/self/status`. The `NSpid:` line lists the PID as seen by each
 *  namespace from outermost to innermost; ≥2 values means the process is in a
 *  nested namespace (e.g. `bwrap --unshare-pid`), so host processes are
 *  invisible to `pgrep` and host crontab entries are invisible to `crontab -l`
 *  (the spool lookup keys on the current UID). Missing/malformed field returns
 *  false (conservative: do not assume isolation). Pure + injected-string so
 *  tests cover the parse without a real sandbox (issue #10). */
export function pidNamespaceIsolated(procStatus: string): boolean {
  for (const line of procStatus.split("\n")) {
    if (line.startsWith("NSpid:")) {
      const values = line.slice("NSpid:".length).trim().split(/\s+/).filter((v) => v !== "");
      return values.length >= 2;
    }
  }
  return false;
}

/** Parse one managed-block crontab line into an InstalledTask, or null when it
 *  belongs to another workbench (tag mismatch) or is unparseable. Extracts the
 *  real schedule (first 5 fields) and reconstructs argv in buildDesired's
 *  canonical form (`cron run --id <id> --dir <root>`) so planReconciliation
 *  can no-op on identical state. Single-quoted values are scanned with the
 *  POSIX rule (`'\''` -> literal quote, `\%` -> `%`) so paths containing `'`,
 *  `%` or spaces round-trip instead of forcing an update every install
 *  (issue #8 #12). Tag is parsed correctly from `com.jspace.cron.<tag>.<id>`. */
export function parseManagedLine(line: string, tag: string): InstalledTask | null {
  const scheduleM = line.trimStart().match(/^(\S+ \S+ \S+ \S+ \S+)\s+/);
  if (!scheduleM) return null;
  const schedule = scheduleM[1];
  const runAt = line.indexOf("cron run");
  if (runAt === -1) return null;
  const tail = line.slice(runAt + "cron run".length);
  const taskM = line.match(/# (com\.jspace\.cron\.\S+)\s*$/);
  if (!taskM) return null;
  const taskId = taskM[1];
  const parsedTag = taskId.replace(/^com\.jspace\.cron\./, "").split(".")[0];
  if (parsedTag !== tag) return null; // another workbench's crons — never touch
  const dir = optionQuoted(tail, "--dir");
  const id = optionQuoted(tail, "--id");
  if (dir === null || id === null) return null;
  return { taskId, cronId: id, schedule, argv: `cron run --id ${id} --dir ${dir}` };
}

export const linuxAdapter: SchedulerAdapter & { io?: CrontabIO; spawn?: SchedulerSpawn; readProcStatus?: () => string } = {
  platform: "linux",

  identity(tag: string, cronId: string): SchedulerIdentity {
    return posixIdentity(tag, cronId);
  },

  buildContent(cron: CronDefinition, tag: string, root: string, env: SchedulerEnv): string {
    // real per-cron install content (a managed crontab line). applyBatch
    // re-assembles the whole block from the enabled set at write time, so this
    // also gives dry-run/planning a truthful per-cron view.
    return crontabLine(cron, tag, root, env.jspaceBinary, env.path, env.home);
  },

  inspect(tag: string): InstalledTask[] {
    const io = linuxAdapter.io ?? defaultIO;
    const out: InstalledTask[] = [];
    const existing = io.readCrontab();
    for (const line of existing.split("\n")) {
      const parsed = parseManagedLine(line, tag);
      if (parsed) out.push(parsed);
    }
    return out;
  },

  applyBatch(_ops: SchedulerOp[], enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv): string[] {
    // Whole-block semantic lives here: crontab is whole-file, so the FULL
    // enabled set (not the op list) decides the block. An empty enabled set ->
    // empty block -> the managed block is removed (all-disabled uninstalls);
    // delete/disable of one cron simply drops it from the rebuilt block.
    const io = linuxAdapter.io ?? defaultIO;
    const existing = io.readCrontab();
    // empty enabled set -> empty block -> replaceManagedBlock removes the whole
    // managed block (markers too); a non-empty set rebuilds it from scratch.
    const block = enabled.length === 0 ? "" : crontabBlock(enabled, tag, root, env.jspaceBinary, env.path, env.home);
    const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(backup, existing, "utf-8");
    const merged = replaceManagedBlock(existing, block, tag);
    io.writeCrontab(merged);
    return [`jspace: ok: installed cron block (${enabled.length} cron(s))`];
  },

  uninstallAll(tag: string, root: string, _env: SchedulerEnv): string[] {
    const io = linuxAdapter.io ?? defaultIO;
    const existing = io.readCrontab();
    const merged = replaceManagedBlock(existing, "", tag);
    const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(backup, existing, "utf-8");
    if (merged.trim() === "") {
      const r = schedulerSpawn("crontab", ["-r"]);
      if (r.status !== 0 && r.status !== 1) fail(`crontab -r failed: ${(r.stderr ?? "").trim()}`);
      return ["jspace: ok: removed jspace crons (empty crontab removed)"];
    }
    io.writeCrontab(merged);
    return ["jspace: ok: removed jspace crons from crontab"];
  },

  health(_env: SchedulerEnv): LinuxCronHealth {
    const spawn = linuxAdapter.spawn ?? schedulerSpawn;
    const procStatus = (linuxAdapter.readProcStatus ?? readProcStatusFile)();
    const isolated = pidNamespaceIsolated(procStatus);

    // service: pgrep is the only live check; when it finds nothing the result
    // splits on environmental visibility — a nested PID namespace hides the host
    // daemon, so "no process" is NOT proof of "stopped" (issue #10).
    const s = spawn("sh", ["-c", "pgrep -x crond >/dev/null 2>&1 || pgrep -x cron >/dev/null 2>&1"]);
    const service: LinuxCronHealth["service"] = s.status === 0 ? "ok" : isolated ? "unverifiable" : "stopped";

    // crontab: binary presence + `-l` exit-code grading. A missing crontab
    // command is a confirmed fault (jspace cannot install) -> "missing". status 1
    // is the legit "no crontab for this uid" state — a real finding on the
    // host, but inside a UID-isolated sandbox it usually means the host spool
    // is not visible, so there it degrades to "unverifiable".
    const c = spawn("sh", ["-c", "command -v crontab"]);
    let crontab: LinuxCronHealth["crontab"] = "missing"; // no crontab binary -> confirmed cannot install
    if ((c.stdout ?? "").trim() !== "") {
      const r = spawn("crontab", ["-l"]);
      crontab =
        r.status === 0 ? "ok"
        : r.status === 1 ? (isolated ? "unverifiable" : "missing")
        : "unverifiable"; // other failure (e.g. sandboxed crontab) -> not proof of absence
    }
    return { crontab, service };
  },
};
