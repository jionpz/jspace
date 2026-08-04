// application/automation/scheduler.ts — scheduler reconciliation (pure).
// planReconciliation compares desired tasks against what's installed for this
// workbench and returns create/update/delete ops. Adapters own platform details;
// this module owns the decision table. workbenchTag lives in adapters/scheduler
// (single source); this re-exports for existing application tests.
export { workbenchTag } from "../../adapters/scheduler/types.ts";
export interface DesiredTask {
  /** platform identity including the workbench tag (e.g. com.jspace.cron.<tag>.<id>) */
  taskId: string;
  cronId: string;
  schedule: string;
  /** installed command line; used for change detection */
  argv: string;
  /** adapter-specific install content (plist / crontab line / schtasks args) */
  content: string;
}

export interface InstalledTask {
  taskId: string;
  cronId: string;
  schedule: string;
  argv: string;
}

export type SchedulerOp =
  | { action: "create"; taskId: string; content: string }
  | { action: "update"; taskId: string; content: string }
  | { action: "delete"; taskId: string };

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
