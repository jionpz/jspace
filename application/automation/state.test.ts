// application/automation/state.test.ts — structured runs + incidents state.
// Run: bun test application/automation/state.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// ids must be uuid-shape (P2-5: run/incident/pending id strictness).
const RUN_A = "6f3c5a20-0000-4000-8000-0000000000a1";
const RUN_B = "6f3c5a20-0000-4000-8000-0000000000b1";

function run(id: string, status: RunRecord["status"], startedAt: string): RunRecord {
  return { version: 1, id, cronId: "nightly", startedAt, exit: status === "ok" ? 0 : 1, status, timedOut: false, outputLog: `/logs/${id}.md`, batchChanged: true };
}

test("writeRun/readRuns/lastRun round-trip and sort by startedAt", () => {
  writeRun(root, "nightly", run(RUN_A, "failed", "2026-08-04T09:00:00"));
  writeRun(root, "nightly", run(RUN_B, "ok", "2026-08-04T10:00:00"));
  const { records: runs } = readRuns(root, "nightly");
  expect(runs.map((r) => r.id)).toEqual([RUN_A, RUN_B]);
  expect(lastRun(root, "nightly")?.status).toBe("ok");
  expect(lastRun(root, "missing")).toBeNull();
});

test("openOrUpdate opens on failure, resolves on success, acks keep evidence", () => {
  openOrUpdate(root, "nightly", "failed", "run-1");
  openOrUpdate(root, "nightly", "failed", "run-2");
  let incs = readIncidents(root).records;
  expect(incs).toHaveLength(1); // same cron+failure class updates in place
  expect(incs[0].evidence).toEqual(["run-1", "run-2"]);
  expect(incs[0].status).toBe("open");
  expect(openIncidents(root)).toHaveLength(1);

  resolveIncidents(root, "nightly");
  incs = readIncidents(root).records;
  expect(incs[0].status).toBe("resolved");
  expect(openIncidents(root)).toHaveLength(0);

  // a new failure re-opens
  openOrUpdate(root, "nightly", "failed", "run-3");
  const acked = ackIncidents(root);
  expect(acked).toBe(1);
  incs = readIncidents(root).records;
  expect(incs.find((i) => i.status === "open")).toBeUndefined();
  expect(incs.some((i) => i.status === "acknowledged")).toBe(true); // evidence retained
  // reopen creates a NEW incident (old one is resolved); assert the acked one kept run-3
  expect(incs.find((i) => i.status === "acknowledged")?.evidence).toContain("run-3");
});

test("different failure classes are distinct incidents", () => {
  openOrUpdate(root, "nightly", "failed", "r1");
  openOrUpdate(root, "nightly", "suspect", "r2");
  expect(readIncidents(root).records).toHaveLength(2);
});

test("ackIncidents with a cron id only touches that cron", () => {
  openOrUpdate(root, "a", "failed", "r1");
  openOrUpdate(root, "b", "failed", "r2");
  expect(ackIncidents(root, "a")).toBe(1);
  expect(openIncidents(root).map((i) => i.cronId)).toEqual(["b"]);
});

test("damaged run/incident records surface as issues, valid ones still readable", () => {
  writeRun(root, "nightly", run(RUN_A, "ok", "2026-08-04T09:00:00"));
  const runsDir = join(root, ".jspace", "state", "runs", "nightly");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, "corrupt.json"), "{ not json");
  writeFileSync(join(runsDir, "bad-version.json"), JSON.stringify({ ...run(RUN_B, "ok", "2026-08-04T10:00:00"), version: 99 }));

  const col = readRuns(root, "nightly");
  expect(col.records.map((r) => r.id)).toEqual([RUN_A]); // valid still readable
  expect(col.issues.map((i) => i.path).sort()).toEqual(["bad-version.json", "corrupt.json"]);
  expect(col.issues.every((i) => i.code !== "")).toBe(true);

  openOrUpdate(root, "nightly", "failed", "run-1");
  const incDir = join(root, ".jspace", "state", "incidents");
  writeFileSync(join(incDir, "broken.json"), "{ nope");
  const incs = readIncidents(root);
  expect(incs.records).toHaveLength(1); // the valid incident still loads
  expect(incs.issues.map((i) => i.path)).toEqual(["broken.json"]);
});
