// application/automation/state.test.ts — structured runs + incidents state.
// Run: bun test application/automation/state.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastRun, readRuns, writeRun, type RunRecord } from "./runs.ts";
import {
  ackIncidents,
  openIncidents,
  openOrUpdate,
  readIncidents,
  resolveIncidents,
} from "./incidents.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-cronstate-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(id: string, status: RunRecord["status"], startedAt: string): RunRecord {
  return { id, cronId: "nightly", startedAt, exit: status === "ok" ? 0 : 1, status, timedOut: false, outputLog: `/logs/${id}.md`, batchChanged: true };
}

test("writeRun/readRuns/lastRun round-trip and sort by startedAt", () => {
  writeRun(root, "nightly", run("a", "failed", "2026-08-04T09:00:00"));
  writeRun(root, "nightly", run("b", "ok", "2026-08-04T10:00:00"));
  const runs = readRuns(root, "nightly");
  expect(runs.map((r) => r.id)).toEqual(["a", "b"]);
  expect(lastRun(root, "nightly")?.status).toBe("ok");
  expect(lastRun(root, "missing")).toBeNull();
});

test("openOrUpdate opens on failure, resolves on success, acks keep evidence", () => {
  openOrUpdate(root, "nightly", "failed", "run-1");
  openOrUpdate(root, "nightly", "failed", "run-2");
  let incs = readIncidents(root);
  expect(incs).toHaveLength(1); // same cron+failure class updates in place
  expect(incs[0].evidence).toEqual(["run-1", "run-2"]);
  expect(incs[0].status).toBe("open");
  expect(openIncidents(root)).toHaveLength(1);

  resolveIncidents(root, "nightly");
  incs = readIncidents(root);
  expect(incs[0].status).toBe("resolved");
  expect(openIncidents(root)).toHaveLength(0);

  // a new failure re-opens
  openOrUpdate(root, "nightly", "failed", "run-3");
  const acked = ackIncidents(root);
  expect(acked).toBe(1);
  incs = readIncidents(root);
  expect(incs.find((i) => i.status === "open")).toBeUndefined();
  expect(incs.some((i) => i.status === "acknowledged")).toBe(true); // evidence retained
  expect(incs[0].evidence).toContain("run-3");
});

test("different failure classes are distinct incidents", () => {
  openOrUpdate(root, "nightly", "failed", "r1");
  openOrUpdate(root, "nightly", "suspect", "r2");
  expect(readIncidents(root)).toHaveLength(2);
});

test("ackIncidents with a cron id only touches that cron", () => {
  openOrUpdate(root, "a", "failed", "r1");
  openOrUpdate(root, "b", "failed", "r2");
  expect(ackIncidents(root, "a")).toBe(1);
  expect(openIncidents(root).map((i) => i.cronId)).toEqual(["b"]);
});
