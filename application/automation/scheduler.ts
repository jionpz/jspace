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
    } else if (inst.schedule !== d.schedule || inst.argv !== d.argv) {
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
