// application/automation/scheduler.test.ts — planReconciliation + workbench tag.
// Run: bun test application/automation/scheduler.test.ts
import { expect, test } from "bun:test";
import { planReconciliation, workbenchTag, type DesiredTask, type InstalledTask } from "./scheduler.ts";
import { buildDesired } from "./scheduler-service.ts";
import { win32Adapter } from "../../adapters/scheduler/win32.ts";
import type { SchedulerEnv } from "../../adapters/scheduler/types.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";

const d = (taskId: string, cronId: string, schedule = "0 21 * * *", argv = "jspace cron run --id x"): DesiredTask =>
  ({ taskId, cronId, schedule, argv, content: `content:${taskId}` });

const i = (taskId: string, cronId: string, schedule = "0 21 * * *", argv = "jspace cron run --id x"): InstalledTask =>
  ({ taskId, cronId, schedule, argv });

test("workbenchTag is stable and short", () => {
  expect(workbenchTag("wb-aaa")).toBe(workbenchTag("wb-aaa"));
  expect(workbenchTag("wb-aaa").length).toBeLessThanOrEqual(8);
  expect(workbenchTag("wb-aaa")).not.toBe(workbenchTag("wb-bbb"));
});

test("reconciliation: create enabled, update changed, delete stale", () => {
  const desired = [d("tag.a", "a", "0 21 * * *", "argv-new")];
  const installed = [
    i("tag.a", "a", "0 21 * * *", "argv-old"), // changed -> update
    i("tag.b", "b"), // not desired -> delete
    i("tag.c", "c"), // not desired -> delete
  ];
  const ops = planReconciliation(desired, installed);
  expect(ops).toEqual([
    { action: "update", taskId: "tag.a", content: "content:tag.a" },
    { action: "delete", taskId: "tag.b" },
    { action: "delete", taskId: "tag.c" },
  ]);
});

test("reconciliation: identical is a no-op; new is create", () => {
  const desired = [d("tag.a", "a"), d("tag.new", "new")];
  const installed = [i("tag.a", "a")];
  const ops = planReconciliation(desired, installed);
  expect(ops).toEqual([{ action: "create", taskId: "tag.new", content: "content:tag.new" }]);
});

test("reconciliation: disabled/deleted/stale cron -> delete (empty desired)", () => {
  // disabling or removing a cron means its task disappears from desired
  const installed = [i("tag.a", "a"), i("tag.b", "b")];
  const ops = planReconciliation([], installed);
  expect(ops).toEqual([
    { action: "delete", taskId: "tag.a" },
    { action: "delete", taskId: "tag.b" },
  ]);
});

test("two workbenches with the same cron id never collide", () => {
  // wb1 and wb2 each have cron "a"; taskIds carry distinct tags
  const desired = [d("wb1.a", "a"), d("wb2.a", "a")];
  const installed = [i("wb1.a", "a")]; // only wb1 installed
  const ops = planReconciliation(desired, installed);
  expect(ops.map((o) => o.taskId)).toEqual(["wb2.a"]); // only wb2 needs create
  // uninstalling wb1 never touches wb2's task
  const wb1Only = [i("wb1.a", "a"), i("wb2.a", "a")];
  const wb1Desired = [d("wb2.a", "a")]; // removing wb1's cron, keeping wb2
  const ops2 = planReconciliation(wb1Desired, wb1Only);
  expect(ops2).toEqual([{ action: "delete", taskId: "wb1.a" }]);
});

test("Sunday dow 7 and 0 converge (no re-update, issue #8 #11)", () => {
  // win32 schtasks XML round-trips Sunday as 0 while a user cron may write 7
  const desired = [d("tag.inbox", "inbox", "0 21 * * 7")];
  const installed = [i("tag.inbox", "inbox", "0 21 * * 0")];
  expect(planReconciliation(desired, installed)).toEqual([]); // identical cron, no update
  // a genuinely different schedule still updates
  const changed = [d("tag.inbox", "inbox", "0 22 * * 0")];
  expect(planReconciliation(changed, installed).map((o) => o.action)).toEqual(["update"]);
});

test("P0: win32 buildDesired content /tn === desired.taskId (service↔adapter single handle)", () => {
  // buildDesired takes taskId from adapter.identity() and content from
  // adapter.buildContent() — the /tn the adapter emits must equal the taskId
  // inspect()/uninstallAll() recognize, or install forever re-creates and
  // uninstall orphans the task (issue #8 #1).
  const tag = "tagA";
  const cron: CronDefinition = { id: "inbox", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };
  const env: SchedulerEnv = { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" };
  const desired = buildDesired([cron], tag, "C:\\wb", env, win32Adapter);
  expect(desired).toHaveLength(1);
  const argv = JSON.parse(desired[0].content) as string[];
  expect(argv[argv.indexOf("/tn") + 1]).toBe(desired[0].taskId);
});
