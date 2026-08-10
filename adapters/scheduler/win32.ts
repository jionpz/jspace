// adapters/scheduler/win32.ts — schtasks adapter (tag-scoped).
// Task name carries the workbench tag: JSpaceCron_<tag>_<id>. inspect()
// filters by the tag so two workbenches never collide on scheduled tasks.
import { spawnSync } from "node:child_process";
import { fail } from "../../core/shared/errors.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { taskIdFor, workbenchTag, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerIdentity, type SchedulerOp } from "./types.ts";

function queryTasks(tag: string): string[] {
  const res = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf-8" });
  const out = res.status === 0 ? (res.stdout ?? "") : "";
  const prefix = win32TaskName(tag, ""); // JSpaceCron_<tag>_ — inspect/uninstall prefix
  return out
    .split(/\r?\n/)
    .map((l) => l.split(",")[0].replace(/^"|"$/g, ""))
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
  const id = args.match(/--id\s+(\S+)/);
  if (!root || !id) return null;
  const schedule = dow === null ? `${minute} ${hour} * * *` : `${minute} ${hour} * * ${dow}`;
  return { schedule, argv: `cron run --id ${id[1]} --dir ${root[1]}` };
}

/** Windows-only installable: DAILY (dom=* dow=*) or WEEKLY (dom=*, dow fixed); month=* and dom=*. */
export function isWindowsInstallable(schedule: string): boolean {
  const d = parseSchedule(schedule);
  return d.Month === undefined && d.Day === undefined;
}

/** Build schtasks args for a cron (DAILY/WEEKLY subset). Null when not expressible. */
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
    const res = spawnSync("schtasks", ["/delete", "/tn", op.taskId, "/f"], { encoding: "utf-8" });
    if (res.status !== 0) fail(`schtasks delete failed for ${op.taskId}: ${(res.stderr ?? "").trim()}`);
    return [`jspace: ok: removed ${op.taskId}`];
  }
  // create/update: op.content is the JSON-encoded argv array built by the caller
  const args = parseOpContent(op.content);
  const res = spawnSync("schtasks", args, { encoding: "utf-8" });
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
      const res = spawnSync("schtasks", ["/query", "/tn", n, "/xml"], { encoding: "utf-8" });
      const parsed = res.status === 0 ? parseSchtasksXml(res.stdout ?? "") : null;
      return {
        taskId: n,
        cronId: n.slice(win32TaskName(tag, "").length),
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
      const res = spawnSync("schtasks", ["/delete", "/tn", t, "/f"], { encoding: "utf-8" });
      if (res.status !== 0) fail(`schtasks delete failed for ${t}: ${(res.stderr ?? "").trim()}`);
      lines.push(`jspace: ok: removed ${t}`);
    }
    if (tasks.length === 0) lines.push("jspace: ok: no jspace scheduled tasks to remove");
    return lines;
  },
};

export { workbenchTag };
