// application/automation/scheduler.ts — scheduler reconciliation (pure).
// planReconciliation compares desired tasks against what's installed for this
// workbench and returns create/update/delete ops. Adapters own platform details;
// this module owns the decision table. The scheduler task model (DesiredTask /
// InstalledTask / SchedulerOp) + workbenchTag live in adapters/scheduler/types.ts
// (single source — no duplicate definitions across layers); re-exported here for
// existing application consumers.
import {
  workbenchTag,
  type DesiredTask,
  type InstalledTask,
  type SchedulerOp,
} from "../../adapters/scheduler/types.ts";

export { workbenchTag, type DesiredTask, type InstalledTask, type SchedulerOp };

/** cron treats 0 and 7 both as Sunday; the win32 schtasks XML round-trip always
 *  emits 0, so a cron written `* * * 7` would otherwise re-update on every
 *  install. Normalize Sunday to 0 before comparing (issue #8 #11). */
function canonicalSchedule(s: string): string {
  return s.split(" ").map((f, i) => (i === 4 && f === "7" ? "0" : f)).join(" ");
}

/** Pure: desired vs installed → ops. Match by taskId (already workbench-tagged);
 *  identical schedule+argv+env is a no-op; changed → update; desired-only →
 *  create; installed-only (disabled/deleted/stale) → delete.
 *
 *  envPath joins the key so a widened PATH closure reaches entries that were
 *  installed before it — without this, an entry baked months ago compares equal
 *  forever and `cron install` reports "up to date" while its PATH stays
 *  unclosed (2026-10-16: 4 of 5 local plists).
 *
 *  The dimension is compared only when BOTH sides define it: `undefined` means
 *  "this platform does not store a PATH (win32), or it could not be read" — a
 *  state where absence carries no information, so it must never read as drift.
 *  Both-undefined (win32) and installed-undefined (an unreadable dump) keep the
 *  previous no-op behaviour instead of re-updating on every install. */
export function planReconciliation(desired: DesiredTask[], installed: InstalledTask[]): SchedulerOp[] {
  const byId = new Map(installed.map((t) => [t.taskId, t]));
  const ops: SchedulerOp[] = [];
  for (const d of desired) {
    const inst = byId.get(d.taskId);
    if (!inst) {
      ops.push({ action: "create", taskId: d.taskId, content: d.content });
    } else if (
      canonicalSchedule(inst.schedule) !== canonicalSchedule(d.schedule) ||
      inst.argv !== d.argv ||
      (inst.envPath !== undefined && d.envPath !== undefined && inst.envPath !== d.envPath)
    ) {
      ops.push({ action: "update", taskId: d.taskId, content: d.content });
    }
    // else no-op
  }
  const desiredIds = new Set(desired.map((d) => d.taskId));
  for (const t of installed) {
    if (!desiredIds.has(t.taskId)) {
      ops.push({ action: "delete", taskId: t.taskId });
    }
  }
  return ops;
}
