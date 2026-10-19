// core/contracts/pending.test.ts — strict schema-2 pending envelope decoder.
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodePendingEnvelope, type PendingWriteEnvelopeV2 } from "./pending.ts";

function valid(over: Partial<PendingWriteEnvelopeV2> = {}): PendingWriteEnvelopeV2 {
  return {
    schema_version: 2,
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    requestId: "a1b2c3d4-0000-4000-8000-000000000001",
    intent: "create",
    contentHash: "b".repeat(64),
    contentOrigin: "user_said",
    sourceId: "jspace:pending:memory-writeback:test",
    producer: "memory-writeback",
    slug: "project/acme/state",
    content: "---\ntype: note\n---\n# state\n",
    status: "staged",
    retryCount: 0,
    createdAt: "2026-10-18T100000",
    ...over,
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodePendingEnvelope(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid create envelope decodes and round-trips", () => {
  const input = valid();
  const result = decodePendingEnvelope(JSON.parse(JSON.stringify(input)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(input);
});

test("replace requires and preserves expectedRevision", () => {
  const replacement = valid({ intent: "replace", expectedRevision: "revision-7" });
  const result = decodePendingEnvelope(JSON.parse(JSON.stringify(replacement)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.expectedRevision).toBe("revision-7");
  expectIssue(valid({ intent: "replace" }), "pending.expectedRevision.required");
  expectIssue(valid({ intent: "replace", expectedRevision: 7 as never }), "pending.expectedRevision.invalid");
  expectIssue(valid({ intent: "replace", expectedRevision: "   " }), "pending.expectedRevision.invalid");
});

test("create must not carry expectedRevision", () => {
  expectIssue(valid({ expectedRevision: "revision-3" }), "pending.expectedRevision.create");
});

test("schema 1 and unknown fields are rejected", () => {
  expectIssue({ ...valid(), schema_version: 1 }, "pending.version.unsupported");
  expectIssue({ ...valid(), idempotencyKey: "old" }, "pending.unknown-field");
});

test("request id and envelope id are UUIDs", () => {
  expectIssue(valid({ id: "not-a-uuid" }), "pending.id.invalid");
  expectIssue(valid({ requestId: "not-a-uuid" }), "pending.requestId.invalid");
});

test("intent, origin, status and retry count are strict", () => {
  expectIssue(valid({ intent: "upsert" as never }), "pending.intent.invalid");
  expectIssue(valid({ contentOrigin: "confirmed" as never }), "pending.contentOrigin.invalid");
  expectIssue(valid({ status: "done" as never }), "pending.status.invalid");
  expectIssue(valid({ retryCount: -1 }), "pending.retryCount.invalid");
  expectIssue(valid({ retryCount: 1.5 }), "pending.retryCount.invalid");
});

test("applied receipt fields decode and remain typed", () => {
  const applied = valid({
    status: "applied",
    appliedAt: "2026-10-18T101500",
    committedRevision: "revision-8",
  });
  const result = decodePendingEnvelope(JSON.parse(JSON.stringify(applied)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(applied);
});
