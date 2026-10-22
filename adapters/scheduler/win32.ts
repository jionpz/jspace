// adapters/scheduler/win32.ts — schtasks adapter (tag-scoped).
// Task name carries the workbench tag: JSpaceCron_<tag>_<id>. inspect()
// filters by the tag so two workbenches never collide on scheduled tasks.
import { fail } from "../../core/shared/errors.ts";
import { isWindowsInstallable, parseSchedule } from "../../core/shared/schedule.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { schedulerSpawn } from "./spawn.ts";
import { taskIdFor, workbenchTag, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerIdentity, type SchedulerOp } from "./types.ts";

function queryTasks(tag: string): string[] {
  const res = schedulerSpawn("schtasks", ["/query", "/fo", "csv", "/nh"]);
  const out = res.status === 0 ? (res.stdout ?? "") : "";
  return queryTasksFromOutput(out, tag);
}

/** Normalize a schtasks CSV task-name cell: strip the CSV quotes AND the leading
 *  `\` schtasks renders for every task (task-path form `\JSpaceCron_<tag>_<id>`).
 *  Every downstream handle — inspect() taskId, `/query /tn` and `/delete /tn`
 *  spawns, uninstallAll — uses the normalized bare form, which is exactly the
 *  identity()/`/create /tn` handle, so planReconciliation sees installed==desired
 *  and a second install is a true no-op. (A bare `JSpaceCron_…` prefix match on
 *  the raw `\`-prefixed rows silently returns nothing, which read back as an
 *  empty set and reds doctor as cron.not_installed.) */
export function csvTaskName(raw: string): string {
  return raw.split(",")[0].replace(/^"|"$/g, "").replace(/^\\/, "");
}

/** cronId embedded in a schtasks task-name handle (accepts the `\`-prefixed
 *  task-path form or the bare logical form). */
export function cronIdFromTaskName(taskName: string, tag: string): string {
  return csvTaskName(taskName).slice(win32TaskName(tag, "").length);
}

/** Parse `schtasks /query /fo csv /nh` stdout into normalized task-name handles
 *  matching this workbench tag. Pure (no spawn) so the CSV format contract is
 *  unit-tested. */
export function queryTasksFromOutput(out: string, tag: string): string[] {
  const prefix = win32TaskName(tag, ""); // JSpaceCron_<tag>_
  return out
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => csvTaskName(l))
    .filter((n) => n.startsWith(prefix));
}

/** Win32 schtasks real task-name handle — single source used by identity()
 *  (desired side), buildContent() (/tn of the /create args), queryTasks()
 *  prefix and inspect() cronId split. The POSIX dotted taskIdFor stays the
 *  logical cross-platform id; the underscore form survives the cmd metadata
 *  the schtasks task-name field mangles dots into. */
function win32TaskName(tag: string, cronId: string): string {
  return `JSpaceCron_${tag}_${cronId}`;
}

/** schtasks XML <DaysOfWeek> child element names -> cron weekday (0=Sunday). */
const SCHTASKS_DAYS: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Parse `schtasks /query /tn <task> /xml` output into the canonical schedule
 *  string + argv used by planReconciliation change detection. Returns null when
 *  unparseable — the caller then falls back to empty schedule/argv (→ update op),
 *  which is safe: it never produces a false "no-op". */
export function parseSchtasksXml(xml: string): { schedule: string; argv: string } | null {
  const boundary = xml.match(/<StartBoundary>([^<]+)<\/StartBoundary>/);
  if (!boundary) return null;
  const time = boundary[1].match(/T(\d{2}):(\d{2})/);
  if (!time) return null;
  const minute = String(Number(time[2])); // "00" -> "0" (canonical cron format)
  const hour = String(Number(time[1])); // "09" -> "9"
  let dow: number | null = null;
  if (/<ScheduleByDay>/.test(xml)) {
    // DAILY — schedule `min hour * * *`
  } else if (/<ScheduleByWeek>/.test(xml)) {
    const day = xml.match(/<DaysOfWeek>\s*<(\w+)\/>/);
    if (!day || !(day[1] in SCHTASKS_DAYS)) return null;
    dow = SCHTASKS_DAYS[day[1]];
  } else {
    return null; // not a calendar trigger we installed
  }
  const argsEl = xml.match(/<Arguments[^>]*>([^<]*)<\/Arguments>/);
  if (!argsEl) return null;
  const args = argsEl[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const root = args.match(/--dir\s+"([^"]+)"/);
  // quoted (current writer) or unquoted (tasks installed before the quote guard)
  const id = args.match(/--id\s+"([^"]+)"/) ?? args.match(/--id\s+(\S+)/);
  if (!root || !id) return null;
  const schedule = dow === null ? `${minute} ${hour} * * *` : `${minute} ${hour} * * ${dow}`;
  // argv[0] lives in <Command>, NOT in <Arguments>. schtasks does not store /tr
  // verbatim: it splits the run string on the first unquoted space and routes the
  // program to <Command> and the remainder to <Arguments>. So a written
  // `"<bin>" cron run --dir "<root>" --id "<id>"` reads back as
  // <Command><bin></Command><Arguments>cron run --dir … --id …</Arguments> — the
  // binary is simply not in <Arguments>, and a regex over <Arguments> alone
  // always fell back to the unprefixed form, which mismatched desired on every
  // install (CI red, both Windows legs, 2026-10-16). Absent <Command> (hand-
  // edited task) falls back to no prefix → mismatches desired → update, the safe
  // direction.
  const cmdEl = xml.match(/<Command[^>]*>([^<]*)<\/Command>/);
  // Trailing/leading whitespace and ONE optional layer of surrounding quotes are
  // stripped: the writer quotes the binary (`"<bin>" cron run …`) so a path with
  // spaces survives schtasks' first-space split, and whether <Command> echoes
  // that token quoted or unquoted is not pinned by any local observation.
  // Stripping both makes the compare converge either way; a quoted-vs-unquoted
  // mismatch here would re-update on every install — the exact bug this fixes.
  const rawCmd = cmdEl?.[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const bin = rawCmd?.replace(/^"(.*)"$/, "$1");
  // `--timeout "<n>"` is written quoted (schtasksArgs); accept the unquoted
  // form too so a hand-edited task still reads its real budget. Absent = no
  // budget, the same shape a pre-field task has.
  const timeout = args.match(/--timeout\s+"?(\d+)"?/)?.[1];
  const tailArgv = `cron run --id ${id[1]} --dir ${root[1]}${timeout === undefined ? "" : ` --timeout ${timeout}`}`;
  return { schedule, argv: bin ? `${bin} ${tailArgv}` : tailArgv };
}

/** Refuse characters that would break schtasks `/tr` quoting or inject a new
 *  command (quote-break + newline). Symmetric with linux/darwin rejectControlChars. */
function rejectUnsafeSchtasksValues(...vals: string[]): void {
  for (const v of vals) {
    if (/[\n\r\u0000"]/.test(v)) {
      fail(`schtasks values must not contain newline/CR/NUL/quote: ${JSON.stringify(v)}`);
    }
  }
}

/** Build schtasks args for a cron (DAILY/WEEKLY subset). Null when not expressible. */
export const SCHTASKS_TR_MAX_LEN = 260;

export function schtasksArgs(cron: CronDefinition, jspaceBin: string, root: string, taskName: string): string[] | null {
  const d = parseSchedule(cron.schedule);
  if (!isWindowsInstallable(cron.schedule)) return null;
  // Quote-break + control chars: /tr is a double-quoted cmd line. A `"` in
  // root/jspaceBin/id splits the quoted string and lets the rest run as cmd
  // (linux crontab / darwin plist already reject newline/CR/NUL).
  rejectUnsafeSchtasksValues(jspaceBin, root, cron.id, taskName);
  const st = `${String(d.Hour).padStart(2, "0")}:${String(d.Minute).padStart(2, "0")}`;
  // Per-cron budget rides /tr: schtasks stores the run string, so it is the only
  // channel from cron.json to the scheduled run. parseSchtasksXml reads it back
  // so a changed budget reconciles as an update rather than "up to date".
  const timeout = cron.timeoutSec === undefined ? "" : ` --timeout "${cron.timeoutSec}"`;
  const tr = `"${jspaceBin}" cron run --dir "${root}" --id "${cron.id}"${timeout}`;
  if (tr.length > SCHTASKS_TR_MAX_LEN) {
    fail(`cron ${cron.id}: schtasks /tr exceeds ${SCHTASKS_TR_MAX_LEN} characters (${tr.length}); shorten the workbench or jspace binary path`);
  }
  const base = ["/create", "/tn", taskName, "/tr", tr, "/st", st, "/f", "/it"];
  if (d.Weekday === undefined) {
    return [...base, "/sc", "DAILY"];
  }
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return [...base, "/sc", "WEEKLY", "/d", days[d.Weekday % 7]]; // 0/7 -> SUN
}

/** Content channel for create/update ops is a JSON-encoded argv array (the
 *  caller serializes it — never space-joined, which destroys args containing
 *  spaces like the /tr task-run command). Parsed back here without loss. */
export function parseOpContent(content: string): string[] {
  try {
    const v: unknown = JSON.parse(content);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    fail(`invalid schtasks args payload: ${content}`);
  } catch {
    fail(`invalid schtasks args payload: ${content}`);
  }
  return [];
}

/** Install one op (one schtasks task per cron). Private helper — the public
 *  write port is applyBatch (win32 applies ops one at a time, no reshape). */
function applyOne(op: SchedulerOp, _tag: string, _root: string, _env: SchedulerEnv): string[] {
  if (op.action === "delete") {
    const res = schedulerSpawn("schtasks", ["/delete", "/tn", op.taskId, "/f"]);
    if (res.status !== 0) fail(`schtasks delete failed for ${op.taskId}: ${(res.stderr ?? "").trim()}`);
    return [`jspace: ok: removed ${op.taskId}`];
  }
  // create/update: op.content is the JSON-encoded argv array built by the caller
  const args = parseOpContent(op.content);
  const res = schedulerSpawn("schtasks", args);
  if (res.status !== 0) fail(`schtasks create failed for ${op.taskId}: ${(res.stderr ?? "").trim()}`);
  return [`jspace: ok: installed cron ${op.taskId.split("_").pop()} -> ${op.taskId}`];
}

export const win32Adapter: SchedulerAdapter = {
  platform: "win32",

  identity(tag: string, cronId: string): SchedulerIdentity {
    // schtasks real task-name handle (matches inspect() / queryTasks()); the
    // logical id keeps the POSIX dotted form for stable cross-platform identity.
    return { logicalId: taskIdFor(tag, cronId), taskId: win32TaskName(tag, cronId) };
  },

  buildContent(cron: CronDefinition, tag: string, root: string, env: SchedulerEnv): string {
    const tn = win32TaskName(tag, cron.id);
    const args = schtasksArgs(cron, env.jspaceBinary, root, tn);
    if (!args) fail(`cron ${cron.id}: schedule "${cron.schedule}" not supported on Windows (MVP: DAILY/WEEKLY with month=*)`);
    return JSON.stringify(args);
  },

  inspect(tag: string): InstalledTask[] {
    return queryTasks(tag).map((n) => {
      const res = schedulerSpawn("schtasks", ["/query", "/tn", n, "/xml"]);
      const parsed = res.status === 0 ? parseSchtasksXml(res.stdout ?? "") : null;
      return {
        taskId: n,
        cronId: cronIdFromTaskName(n, tag),
        schedule: parsed?.schedule ?? "",
        argv: parsed?.argv ?? "",
      };
    });
  },

  // win32 installs one schtasks task per cron — one op at a time, no whole-block reshape.
  applyBatch(ops: SchedulerOp[], _enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv): string[] {
    return ops.flatMap((o) => applyOne(o, tag, root, env));
  },

  uninstallAll(tag: string): string[] {
    const tasks = queryTasks(tag);
    const lines: string[] = [];
    for (const t of tasks) {
      const res = schedulerSpawn("schtasks", ["/delete", "/tn", t, "/f"]);
      if (res.status !== 0) fail(`schtasks delete failed for ${t}: ${(res.stderr ?? "").trim()}`);
      lines.push(`jspace: ok: removed ${t}`);
    }
    if (tasks.length === 0) lines.push("jspace: ok: no jspace scheduled tasks to remove");
    return lines;
  },
};

export { workbenchTag };
