// application/automation/use-cases.test.ts — cron definition use cases.
// Covers the cron-convergence change: all-disabled no longer early-returns but
// reconciles to delete ops; enabled-but-uninstalled creates; matching is a no-op.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronInstall } from "./use-cases.ts";
import { taskIdFor } from "../../adapters/scheduler/types.ts";
import type { DesiredTask, SchedulerOp } from "./scheduler.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";

function makeWorkbench(crons: { id: string; enabled: boolean }[]): string {
  const wb = mkdtempSync(join(tmpdir(), "jspace-cron-"));
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "cron.json"),
    JSON.stringify({
      version: 1,
      crons: crons.map((c) => ({ id: c.id, schedule: "0 21 * * *", harness: "claude", prompt: "p", enabled: c.enabled })),
    }, null, 2) + "\n",
  );
  return wb;
}

const buildDesired = (tag: string) => (enabled: CronDefinition[]): DesiredTask[] =>
  enabled.map((c) => ({
    taskId: taskIdFor(tag, c.id),
    cronId: c.id,
    schedule: "0 21 * * *",
    argv: `cron run --id ${c.id} --dir /wb`,
    content: "plist",
  }));

test("cronInstall: all-disabled -> reconciles to delete ops (no early return)", () => {
  const wb = makeWorkbench([{ id: "a", enabled: false }]);
  const tag = "abc123";
  const installed = [{ taskId: taskIdFor(tag, "old"), cronId: "old", schedule: "0 21 * * *", argv: "cron run --id old --dir /wb" }];
  let applied: SchedulerOp[] | null = null;
  const res = cronInstall(wb, false, {
    tag,
    buildDesired: buildDesired(tag),
    inspect: () => installed,
    apply: (ops) => {
      applied = ops;
      return [];
    },
  });
  expect(applied).toEqual([{ action: "delete", taskId: taskIdFor(tag, "old") }]);
  expect(res.lines.some((l) => l.includes("applied 1 change"))).toBe(true);
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: enabled cron not installed -> create op", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp[] | null = null;
  const res = cronInstall(wb, false, {
    tag,
    buildDesired: buildDesired(tag),
    inspect: () => [],
    apply: (ops) => {
      applied = ops;
      return [];
    },
  });
  expect(applied).toEqual([{ action: "create", taskId: taskIdFor(tag, "a"), content: "plist" }]);
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: identical installed state -> up to date, no apply", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp[] | null = null;
  const res = cronInstall(wb, false, {
    tag,
    buildDesired: buildDesired(tag),
    inspect: () => [{ taskId: taskIdFor(tag, "a"), cronId: "a", schedule: "0 21 * * *", argv: "cron run --id a --dir /wb" }],
    apply: (ops) => {
      applied = ops;
      return [];
    },
  });
  expect(res.lines.some((l) => l.includes("up to date"))).toBe(true);
  expect(applied).toBeNull();
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: dry-run reports pending changes without applying", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp[] | null = null;
  const res = cronInstall(wb, true, {
    tag,
    buildDesired: buildDesired(tag),
    inspect: () => [],
    apply: (ops) => {
      applied = ops;
      return [];
    },
  });
  expect(res.lines.some((l) => l.includes("would apply 1 change"))).toBe(true);
  expect(applied).toBeNull();
  rmSync(wb, { recursive: true, force: true });
});
