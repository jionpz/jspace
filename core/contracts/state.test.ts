// core/contracts/state.test.ts — pure decode tests for the four machine-truth
// state contracts (run record / incident / materialized journal / upgrade
// journal): valid round-trip, invalid field, unknown field, unsupported version.
// Run: bun test core/contracts/state.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeRunRecord, type RunRecordV1 } from "./run-record.ts";
import { decodeIncident, type IncidentV1 } from "./incident.ts";
import { decodeMaterializedJournal, type MaterializedJournalV1 } from "./materialized.ts";
import { decodeUpgradeJournal, type UpgradeJournalV1 } from "./upgrade.ts";

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}
function expectIssue(ok: boolean, codes: string[], code: string): void {
  expect(ok).toBe(false);
  expect(codes).toContain(code);
}

const RUN_ID = "6f3c5a20-0000-4000-8000-000000000001";
const INC_ID = "7f3c5a20-0000-4000-8000-000000000002";

function validRun(): RunRecordV1 {
  return { version: 1, id: RUN_ID, cronId: "nightly", startedAt: "2026-08-04T120000", exit: 0, status: "ok", timedOut: false, outputLog: "/logs/x.md", batchChanged: true };
}
function validIncident(): IncidentV1 {
  return { version: 1, id: INC_ID, cronId: "nightly", failureClass: "failed", status: "open", openedAt: "2026-08-04T120000", evidence: ["run-1"] };
}
function validMaterialized(): MaterializedJournalV1 {
  return { version: 1, asset_version: "v1.0.5", applied_at: "2026-08-04", files: { "AGENTS.md": { sha256: "abc" } } };
}
function validUpgrade(): UpgradeJournalV1 {
  return { version: 1, id: "up-1", from_version: "v1.0.4", to_version: "v1.0.5", plan: [{ action: "update", rel: "AGENTS.md" }], status: "applied" };
}

function roundTrip<T>(decode: (v: unknown) => DecodeResult<T>, value: T): void {
  const result = decode(JSON.parse(JSON.stringify(value)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(value);
}

test("RunRecordV1: valid round-trip", () => roundTrip(decodeRunRecord, validRun()));
test("RunRecordV1: invalid status / unknown field / unsupported version", () => {
  const d = decodeRunRecord({ ...validRun(), status: "skipped" });
  expectIssue(d.ok, codesOf(d), "run.status.invalid");
  expectIssue(decodeRunRecord({ ...validRun(), bogus: 1 }).ok, codesOf(decodeRunRecord({ ...validRun(), bogus: 1 })), "run.unknown-field");
  const v = decodeRunRecord({ ...validRun(), version: 2 });
  expectIssue(v.ok, codesOf(v), "run.version.unsupported");
  const m = decodeRunRecord({ ...validRun(), id: undefined });
  expectIssue(m.ok, codesOf(m), "run.id.invalid");
  const t = decodeRunRecord({ ...validRun(), timedOut: "yes" });
  expectIssue(t.ok, codesOf(t), "run.timedOut.invalid");
});

test("IncidentV1: valid round-trip", () => roundTrip(decodeIncident, validIncident()));
test("IncidentV1: invalid class/status/evidence / unknown field / version", () => {
  const f = decodeIncident({ ...validIncident(), failureClass: "ghost" });
  expectIssue(f.ok, codesOf(f), "incident.failureClass.invalid");
  const s = decodeIncident({ ...validIncident(), status: "gone" });
  expectIssue(s.ok, codesOf(s), "incident.status.invalid");
  const e = decodeIncident({ ...validIncident(), evidence: "not-array" });
  expectIssue(e.ok, codesOf(e), "incident.evidence.invalid");
  expectIssue(decodeIncident({ ...validIncident(), extra: true }).ok, codesOf(decodeIncident({ ...validIncident(), extra: true })), "incident.unknown-field");
  const v = decodeIncident({ ...validIncident(), version: 0 });
  expectIssue(v.ok, codesOf(v), "incident.version.unsupported");
});

test("MaterializedJournalV1: valid round-trip", () => roundTrip(decodeMaterializedJournal, validMaterialized()));
test("MaterializedJournalV1: bad files entry / unknown field / version", () => {
  const f = decodeMaterializedJournal({ ...validMaterialized(), files: { "AGENTS.md": { sha256: "" } } });
  expectIssue(f.ok, codesOf(f), "materialized.files.invalid");
  const n = decodeMaterializedJournal({ ...validMaterialized(), files: "nope" });
  expectIssue(n.ok, codesOf(n), "materialized.files.invalid");
  expectIssue(decodeMaterializedJournal({ ...validMaterialized(), stray: 1 }).ok, codesOf(decodeMaterializedJournal({ ...validMaterialized(), stray: 1 })), "materialized.unknown-field");
  const v = decodeMaterializedJournal({ ...validMaterialized(), version: 2 });
  expectIssue(v.ok, codesOf(v), "materialized.version.unsupported");
});

test("UpgradeJournalV1: valid round-trip", () => roundTrip(decodeUpgradeJournal, validUpgrade()));
test("UpgradeJournalV1: bad status / bad plan / unknown field / version", () => {
  const s = decodeUpgradeJournal({ ...validUpgrade(), status: "done" });
  expectIssue(s.ok, codesOf(s), "upgrade.status.invalid");
  const p = decodeUpgradeJournal({ ...validUpgrade(), plan: [{ action: "explode", rel: "x" }] });
  expectIssue(p.ok, codesOf(p), "upgrade.plan.invalid");
  const n = decodeUpgradeJournal({ ...validUpgrade(), plan: "none" });
  expectIssue(n.ok, codesOf(n), "upgrade.plan.invalid");
  expectIssue(decodeUpgradeJournal({ ...validUpgrade(), junk: true }).ok, codesOf(decodeUpgradeJournal({ ...validUpgrade(), junk: true })), "upgrade.unknown-field");
  const v = decodeUpgradeJournal({ ...validUpgrade(), version: 3 });
  expectIssue(v.ok, codesOf(v), "upgrade.version.unsupported");
});

test("non-object input fails root type for all four", () => {
  expectIssue(decodeRunRecord("x").ok, codesOf(decodeRunRecord("x")), "run.root.type");
  expectIssue(decodeIncident(null).ok, codesOf(decodeIncident(null)), "incident.root.type");
  expectIssue(decodeMaterializedJournal([]).ok, codesOf(decodeMaterializedJournal([])), "materialized.root.type");
  expectIssue(decodeUpgradeJournal(42).ok, codesOf(decodeUpgradeJournal(42)), "upgrade.root.type");
});
