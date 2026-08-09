// core/contracts/ingest.test.ts — pure decode tests for the ingest journal.
// Run: bun test core/contracts/ingest.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeIngestJournal, type IngestJournalV1 } from "./ingest.ts";

function valid(): IngestJournalV1 {
  return {
    schema_version: 1,
    id: "6f3c5a20-0000-4000-8000-000000000001",
    source: "/tmp/inbox/doc.txt",
    target: "/tmp/filehub/projects/foo/2026-08-04-doc.txt",
    relPath: "projects/foo/2026-08-04-doc.txt",
    slug: "assets/foo/doc",
    projectId: "foo",
    contentHash: "a".repeat(64),
    status: "staged",
    createdAt: "2026-08-04T100000",
    updatedAt: "2026-08-04T100000",
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeIngestJournal(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid journal decodes ok and round-trips", () => {
  const result = decodeIngestJournal(JSON.parse(JSON.stringify(valid())));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(valid());
});

test("version must be 1 and required fields present", () => {
  expectIssue({ ...valid(), schema_version: 2 }, "ingest.version.unsupported");
  expectIssue({ ...valid(), source: undefined }, "ingest.source.invalid");
  expectIssue({ ...valid(), status: undefined }, "ingest.status.invalid");
});

test("status must be a valid step or failed", () => {
  expectIssue({ ...valid(), status: "bogus" }, "ingest.status.invalid");
  expectIssue({ ...valid(), status: "failed", failedStep: "bogus" }, "ingest.failedStep.invalid");
});

test("unknown fields are rejected", () => {
  expectIssue({ ...valid(), extra: 1 }, "ingest.unknown-field");
});

test("failed journal with optional fields decodes", () => {
  const j: IngestJournalV1 = {
    ...valid(),
    status: "failed",
    failedStep: "gbrain",
    failureReason: "gbrain put failed",
    indexEntry: "doc.txt | 2026-08-04 | assets/foo/doc",
  };
  const result = decodeIngestJournal(JSON.parse(JSON.stringify(j)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(j);
});

test("cleanup-pending v1 journal (failed + failedStep=committed) decodes unchanged", () => {
  // the legal combination used for source-cleanup recovery; must remain a v1
  // journal (no new field/status) so journals written by older releases decode.
  const j: IngestJournalV1 = {
    ...valid(),
    status: "failed",
    failedStep: "committed",
    failureReason: "source cleanup pending",
  };
  const result = decodeIngestJournal(JSON.parse(JSON.stringify(j)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(j);
});
