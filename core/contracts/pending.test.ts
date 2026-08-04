// core/contracts/pending.test.ts — pure decode tests for the pending envelope.
// Run: bun test core/contracts/pending.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodePendingEnvelope, type PendingWriteEnvelopeV1 } from "./pending.ts";

function valid(): PendingWriteEnvelopeV1 {
  return {
    version: 1,
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    idempotencyKey: "b".repeat(64),
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "---\ntype: reference\n---\n# doc\n\ncontent",
    status: "staged",
    retryCount: 0,
    createdAt: "2026-08-04T100000",
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

test("valid envelope decodes and round-trips", () => {
  const result = decodePendingEnvelope(JSON.parse(JSON.stringify(valid())));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(valid());
});

test("status must be a valid envelope status", () => {
  expectIssue({ ...valid(), status: "bogus" }, "pending.status.invalid");
});

test("retryCount must be a non-negative integer", () => {
  expectIssue({ ...valid(), retryCount: -1 }, "pending.retryCount.invalid");
  expectIssue({ ...valid(), retryCount: 1.5 }, "pending.retryCount.invalid");
});

test("optional appliedAt/error and terminal states decode", () => {
  const j: PendingWriteEnvelopeV1 = {
    ...valid(),
    status: "terminal_failed",
    retryCount: 3,
    error: "page exists with different content",
  };
  const result = decodePendingEnvelope(JSON.parse(JSON.stringify(j)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(j);
});

test("unknown fields are rejected", () => {
  expectIssue({ ...valid(), extra: 1 }, "pending.unknown-field");
});
