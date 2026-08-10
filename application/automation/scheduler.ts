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
 *  identical schedule+argv is a no-op; changed → update; desired-only → create;
 *  installed-only (disabled/deleted/stale) → delete. */
export function planReconciliation(desired: DesiredTask[], installed: InstalledTask[]): SchedulerOp[] {
  const byId = new Map(installed.map((t) => [t.taskId, t]));
  const ops: SchedulerOp[] = [];
  for (const d of desired) {
    const inst = byId.get(d.taskId);
    if (!inst) {
      ops.push({ action: "create", taskId: d.taskId, content: d.content });
    } else if (canonicalSchedule(inst.schedule) !== canonicalSchedule(d.schedule) || inst.argv !== d.argv) {
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
