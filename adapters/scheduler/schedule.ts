// adapters/scheduler/schedule.ts — restricted 5-field cron expression parser.
// Shared by the scheduler adapters (linux/win32/types) and the automation layer
// (application/automation/definitions.ts re-exports it). Pure — no fs/env.
// Lives in adapters so the adapters never import application business logic
// (the former definitions.ts location created an application<->adapters cycle).
import { fail } from "../../application/errors.ts";

/** launchd-dict-shaped schedule (restricted subset): Minute/Hour required;
 *  Day/Month/Weekday optional (*). Keys match the plist StartCalendarInterval. */
export interface ScheduleDict {
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
