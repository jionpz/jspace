// application/automation/use-cases.test.ts — cron definition use cases.
// Covers the cron-convergence change: all-disabled no longer early-returns but
// reconciles to delete ops; enabled-but-uninstalled creates; matching is a no-op.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronAck, cronAdd, cronRemove, cronSetEnabled } from "./use-cases.ts";
import { cronInstall } from "./scheduler-service.ts";
import { loadCrons } from "./definitions.ts";
import { taskIdFor, posixIdentity, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp } from "../../adapters/scheduler/types.ts";

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

const env: SchedulerEnv = { jspaceBinary: "/bin/jspace", home: "/home/u", path: "/bin" };

const fakeAdapter = (opts: {
  platform: SchedulerAdapter["platform"];
  inspect: () => InstalledTask[];
  onApply?: (op: SchedulerOp) => void;
  onApplyBatch?: (ops: SchedulerOp[], enabled: { id: string }[]) => void;
}): SchedulerAdapter => ({
  platform: opts.platform,
  identity: (tag, cronId) =>
    opts.platform === "win32"
      ? { logicalId: taskIdFor(tag, cronId), taskId: `JSpaceCron_${tag}_${cronId}` }
      : posixIdentity(tag, cronId),
  buildContent: (cron, _tag, _root, env) =>
    opts.platform === "darwin" ? "<plist>fake</plist>" : `${env.jspaceBinary}:${cron.id}`,
  inspect: () => opts.inspect(),
  apply: (op) => {
    opts.onApply?.(op);
    return [`applied ${op.taskId}`];
  },
  applyBatch: (ops, enabled, _tag, _root, _env) => {
    opts.onApplyBatch?.(ops, enabled);
    return ops.flatMap((op) => {
      opts.onApply?.(op);
      return [`applied ${op.taskId}`];
    });
  },
  uninstallAll: () => [],
});

test("cronInstall: all-disabled -> reconciles to delete ops (no early return)", () => {
  const wb = makeWorkbench([{ id: "a", enabled: false }]);
  const tag = "abc123";
  const installed = [{ taskId: taskIdFor(tag, "old"), cronId: "old", schedule: "0 21 * * *", argv: "cron run --id old --dir /wb" }];
  let applied: SchedulerOp | null = null;
  const res = cronInstall(wb, false, {
    tag,
    adapter: fakeAdapter({ platform: "darwin", inspect: () => installed, onApply: (op) => { applied = op; } }),
    env,
  });
  expect(applied!.action).toBe("delete");
  expect(applied!.taskId).toBe(taskIdFor(tag, "old"));
  expect(res.lines.some((l) => l.includes("applied 1 change"))).toBe(true);
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: enabled cron not installed -> create op (darwin content)", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp | null = null;
  cronInstall(wb, false, {
    tag,
    adapter: fakeAdapter({ platform: "darwin", inspect: () => [], onApply: (op) => { applied = op; } }),
    env,
  });
  const op = applied!;
  expect(op.action).toBe("create");
  expect(op.taskId).toBe(taskIdFor(tag, "a"));
  if (op.action === "create") expect(op.content).toContain("<plist"); // darwin content is a real plist body
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: identical installed state -> up to date, no apply", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp | null = null;
  const res = cronInstall(wb, false, {
    tag,
    adapter: fakeAdapter({
      platform: "darwin",
      inspect: () => [{ taskId: taskIdFor(tag, "a"), cronId: "a", schedule: "0 21 * * *", argv: `cron run --id a --dir ${wb}` }],
      onApply: (op) => { applied = op; },
    }),
    env,
  });
  expect(res.lines.some((l) => l.includes("up to date"))).toBe(true);
  expect(applied).toBeNull();
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: dry-run reports pending changes without applying", () => {
  const wb = makeWorkbench([{ id: "a", enabled: true }]);
  const tag = "abc123";
  let applied: SchedulerOp | null = null;
  const res = cronInstall(wb, true, {
    tag,
    adapter: fakeAdapter({ platform: "darwin", inspect: () => [], onApply: (op) => { applied = op; } }),
    env,
  });
  expect(res.lines.some((l) => l.includes("would apply 1 change"))).toBe(true);
  expect(applied).toBeNull();
  rmSync(wb, { recursive: true, force: true });
});

test("cronInstall: linux delegates whole-block semantics to adapter.applyBatch", () => {
  // scheduler-service passes every reconciliation op + the FULL enabled set to
  // adapter.applyBatch; the whole-block reshape (crontabBlock from enabled) is
  // the linux adapter's internal detail — application never builds a block.
  const wb = makeWorkbench([{ id: "a", enabled: true }, { id: "b", enabled: true }]);
  const tag = "abc123";
  const applied: SchedulerOp[] = [];
  let batch: { ops: SchedulerOp[]; enabled: { id: string }[] } | null = null;
  cronInstall(wb, false, {
    tag,
    adapter: fakeAdapter({
      platform: "linux",
      inspect: () => [],
      onApply: (op) => { applied.push(op); },
      onApplyBatch: (ops, enabled) => { batch = { ops, enabled }; },
    }),
    env,
  });
  expect(batch).not.toBeNull();
  expect(batch!.ops).toHaveLength(2); // one create per enabled cron (per-cron view)
  expect(batch!.ops.every((o) => o.action === "create")).toBe(true);
  expect(batch!.enabled.map((e) => e.id).sort()).toEqual(["a", "b"]); // full set, not just changed
  expect(applied).toHaveLength(2); // fake flatMaps applyBatch back to per-op apply
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
