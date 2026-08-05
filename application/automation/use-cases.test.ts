// application/automation/use-cases.test.ts — cron definition use cases.
// Covers the cron-convergence change: all-disabled no longer early-returns but
// reconciles to delete ops; enabled-but-uninstalled creates; matching is a no-op.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronAck, cronAdd, cronInstall, cronRemove, cronSetEnabled } from "./use-cases.ts";
import { loadCrons } from "./definitions.ts";
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
  expect(applied!).toEqual([{ action: "delete", taskId: taskIdFor(tag, "old") }]);
  expect(res.lines.some((l) => l.includes("applied 1 change"))).toBe(true);
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: enabled cron not installed -> create op", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp[] | null = null;
  cronInstall(wb, false, {
    tag,
    buildDesired: buildDesired(tag),
    inspect: () => [],
    apply: (ops) => {
      applied = ops;
      return [];
    },
  });
  expect(applied!).toEqual([{ action: "create", taskId: taskIdFor(tag, "a"), content: "plist" }]);
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

test("cronAdd validates + persists; duplicate/invalid rejected", () => {
  const wb = makeWorkbench([]);
  const deps = { isInstalled: () => false };
  const r = cronAdd(wb, "inbox-tidy", "0 21 * * *", "claude", "tidy", false, deps);
  expect(r.lines[0]).toContain("added cron: inbox-tidy");
  const data = JSON.parse(readFileSync(join(wb, ".jspace", "cron.json"), "utf-8"));
  expect(data.crons).toHaveLength(1);
  expect(() => cronAdd(wb, "inbox-tidy", "0 21 * * *", "claude", "x", false, deps)).toThrow(/duplicate cron id/);
  expect(() => cronAdd(wb, "BAD ID", "0 21 * * *", "claude", "x", false, deps)).toThrow(/invalid cron id/);
  expect(() => cronAdd(wb, "a", "*/5 * * * *", "claude", "x", false, deps)).toThrow(/invalid.*schedule/);
  rmSync(wb, { recursive: true, force: true });
});

test("cronAdd isInstalled hint fires when the cron id is installed", () => {
  const wb = makeWorkbench([]);
  const r = cronAdd(wb, "inbox-tidy", "0 21 * * *", "claude", "tidy", false, { isInstalled: () => true });
  expect(r.lines.some((l) => l.includes("is installed; re-run"))).toBe(true);
  rmSync(wb, { recursive: true, force: true });
});

test("cronRemove deletes + hints; unknown id throws", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const r = cronRemove(wb, "a", { isInstalled: () => true });
  expect(r.lines[0]).toContain("removed cron: a");
  expect(r.lines.some((l) => l.includes("re-run"))).toBe(true);
  expect(() => cronRemove(wb, "nope", { isInstalled: () => false })).toThrow(/no such cron/);
  rmSync(wb, { recursive: true, force: true });
});

test("cronSetEnabled toggles persisted enabled flag", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  cronSetEnabled(wb, "a", false);
  expect(loadCrons(wb).crons[0].enabled).toBe(false);
  cronSetEnabled(wb, "a", true);
  expect(loadCrons(wb).crons[0].enabled).toBe(true);
  rmSync(wb, { recursive: true, force: true });
});

test("cronAck with no incidents -> acknowledged 0", () => {
  const wb = makeWorkbench([]);
  const r = cronAck(wb, undefined);
  expect(r.lines[0]).toContain("acknowledged 0 incident");
  rmSync(wb, { recursive: true, force: true });
});
