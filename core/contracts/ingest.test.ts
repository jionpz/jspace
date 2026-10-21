// core/contracts/ingest.test.ts — pure decode tests for the ingest journal.
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import {
  decodeIngestJournal,
  type IngestGbrainEvidence,
  type IngestIndexEvidence,
  type IngestJournalV2,
} from "./ingest.ts";

const HASH = "a".repeat(64);
const INDEX_HASH = "b".repeat(64);

function gbrainEvidence(over: Partial<IngestGbrainEvidence> = {}): IngestGbrainEvidence {
  return {
    verifiedAt: "2026-10-18T120000",
    revision: "revision-3",
    contentHash: "c".repeat(64),
    slug: "assets/foo/doc",
    ownerKind: "project",
    ownerId: "foo",
    relPath: "projects/foo/2026-10-18-doc.md",
    tags: ["asset", "source:session"],
    ...over,
  };
}

function indexEvidence(over: Partial<IngestIndexEvidence> = {}): IngestIndexEvidence {
  return {
    verifiedAt: "2026-10-18T120100",
    path: "projects/foo/index.md",
    contentHash: INDEX_HASH,
    line: "2026-10-18 | doc | assets/foo/doc",
    ...over,
  };
}

function valid(over: Partial<IngestJournalV2> = {}): IngestJournalV2 {
  return {
    schema_version: 2,
    id: "6f3c5a20-0000-4000-8000-000000000001",
    source: "/tmp/filehub/_inbox/doc.md",
    target: "/tmp/filehub/projects/foo/2026-10-18-doc.md",
    relPath: "projects/foo/2026-10-18-doc.md",
    ownerKind: "project",
    ownerId: "foo",
    slug: "assets/foo/doc",
    indexPath: "projects/foo/index.md",
    indexEntry: "2026-10-18 | doc | assets/foo/doc",
    sourceHash: HASH,
    targetHash: HASH,
    status: "staged",
    createdAt: "2026-10-18T120000",
    updatedAt: "2026-10-18T120000",
    ...over,
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeIngestJournal(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("staged schema-2 journal decodes and round-trips", () => {
  const input = valid();
  const result = decodeIngestJournal(JSON.parse(JSON.stringify(input)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(input);
});

test("schema 1 is not accepted by the runtime decoder", () => {
  expectIssue({ ...valid(), schema_version: 1 }, "ingest.version.unsupported");
});

test("unknown fields and missing core fields are rejected", () => {
  expectIssue({ ...valid(), extra: true }, "ingest.unknown-field");
  expectIssue({ ...valid(), source: undefined }, "ingest.source.invalid");
  expectIssue({ ...valid(), indexEntry: undefined }, "ingest.indexEntry.invalid");
});

test("source/target must be absolute without traversal; portable paths stay relative", () => {
  expectIssue({ ...valid(), source: "relative/doc.md" }, "ingest.source.invalid");
  expectIssue({ ...valid(), target: "relative/doc.md" }, "ingest.target.invalid");
  expectIssue({ ...valid(), source: "/tmp/../etc/passwd" }, "ingest.source.invalid");
  expectIssue({ ...valid(), target: "/tmp/filehub/../escape" }, "ingest.target.invalid");
  expectIssue({ ...valid(), relPath: "../escape" }, "ingest.relPath.invalid");
  expectIssue({ ...valid(), indexPath: "/projects/foo/index.md" }, "ingest.indexPath.invalid");
  expectIssue({ ...valid(), indexPath: "projects//foo/index.md" }, "ingest.indexPath.invalid");
});

test("owner id is one segment and slug belongs to that owner", () => {
  expectIssue({ ...valid(), ownerId: "foo/bar" }, "ingest.ownerId.invalid");
  expectIssue({ ...valid(), ownerId: ".." }, "ingest.ownerId.invalid");
  expectIssue({ ...valid(), slug: "assets/other/doc" }, "ingest.slug.invalid");
  expectIssue({ ...valid(), slug: "assets/foo" }, "ingest.slug.invalid");
});

test("hashes must be lowercase 64-character sha256 digests", () => {
  expectIssue({ ...valid(), sourceHash: "A".repeat(64) }, "ingest.sourceHash.invalid");
  expectIssue({ ...valid(), targetHash: "short" }, "ingest.targetHash.invalid");
  expectIssue({ ...valid(), targetHash: "d".repeat(64) }, "ingest.hashes.mismatch");
});

test("gbrain checkpoint requires matching verified evidence", () => {
  const journal = valid({ status: "gbrain", gbrainEvidence: gbrainEvidence() });
  const result = decodeIngestJournal(journal);
  expect(result.ok).toBe(true);
  expectIssue(valid({ status: "gbrain" }), "ingest.gbrainEvidence.required");
  expectIssue(
    valid({ status: "gbrain", gbrainEvidence: gbrainEvidence({ relPath: "projects/other/doc.md" }) }),
    "ingest.gbrainEvidence.relPath.mismatch",
  );
  expectIssue(
    valid({ status: "gbrain", gbrainEvidence: gbrainEvidence({ tags: ["source:session"] }) }),
    "ingest.gbrainEvidence.tags.asset",
  );
});

test("index and committed checkpoints require both evidence objects", () => {
  const atIndex = valid({
    status: "index",
    gbrainEvidence: gbrainEvidence(),
    indexEvidence: indexEvidence(),
  });
  const result = decodeIngestJournal(atIndex);
  expect(result.ok).toBe(true);
  expectIssue(
    valid({ status: "index", gbrainEvidence: gbrainEvidence() }),
    "ingest.indexEvidence.required",
  );
  expectIssue(
    valid({
      status: "committed",
      gbrainEvidence: gbrainEvidence(),
      indexEvidence: indexEvidence({ line: "different" }),
    }),
    "ingest.indexEvidence.line.mismatch",
  );
});

test("failed journal requires failedStep and a reason, while non-failed states reject them", () => {
  const failed = valid({ status: "failed", failedStep: "index", failureReason: "source changed" });
  expect(decodeIngestJournal(failed).ok).toBe(true);
  expectIssue(valid({ status: "failed", failureReason: "x" }), "ingest.failedStep.required");
  expectIssue(valid({ status: "failed", failedStep: "staged" }), "ingest.failureReason.required");
  expectIssue(valid({ failedStep: "staged" }), "ingest.failedStep.unexpected");
});

test("staged journal cannot claim gbrain evidence", () => {
  expectIssue(valid({ gbrainEvidence: gbrainEvidence() }), "ingest.gbrainEvidence.unexpected");
});

test("gbrain evidence may carry a page source digest that matches the journal target hash", () => {
  const journal = valid({ status: "gbrain", gbrainEvidence: gbrainEvidence({ sourceSha256: HASH }) });
  const result = decodeIngestJournal(journal);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.gbrainEvidence?.sourceSha256).toBe(HASH);
});

test("gbrain evidence source digest must be a sha256 and must match the journal target hash", () => {
  expectIssue(
    valid({ status: "gbrain", gbrainEvidence: gbrainEvidence({ sourceSha256: "not-a-digest" }) }),
    "ingest.gbrainEvidence.sourceSha256.invalid",
  );
  expectIssue(
    valid({ status: "gbrain", gbrainEvidence: gbrainEvidence({ sourceSha256: INDEX_HASH }) }),
    "ingest.gbrainEvidence.sourceSha256.mismatch",
  );
});
