// application/ingest/journal.test.ts — ingest state machine, no-clobber,
// content identity and verified cleanup. Never touches a real filehub.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  IngestGbrainEvidence,
  IngestIndexEvidence,
  IngestJournalV2,
} from "../../core/contracts/ingest.ts";
import {
  advanceIngest,
  beginIngest,
  completeIngest,
  failIngest,
  isCleanupPending,
  readJournal,
  readJournals,
  resumableJournals,
  rollbackIngest,
  sha256File,
  writeJournal,
  type IngestFileOps,
  type IngestPlan,
} from "./journal.ts";

let root: string;
let inbox: string;
let filehub: string;
let indexText: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-ingest-"));
  inbox = join(root, "inbox");
  filehub = join(root, "filehub");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(join(filehub, "projects", "foo"), { recursive: true });
  indexText = "# Index\n";
  writeFileSync(join(filehub, "projects", "foo", "index.md"), indexText);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sourceFile(name = "doc.txt", content = "some ingestable content\n"): string {
  const path = join(inbox, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function plan(source: string, over: Partial<IngestPlan> = {}): IngestPlan {
  return {
    source,
    target: join(filehub, "projects", "foo", "2026-10-18-doc.txt"),
    relPath: "projects/foo/2026-10-18-doc.txt",
    ownerKind: "project",
    ownerId: "foo",
    slug: "assets/foo/doc",
    indexPath: "projects/foo/index.md",
    indexEntry: "2026-10-18 | doc | assets/foo/doc",
    ...over,
  };
}

function track(overrides: Partial<IngestFileOps> = {}) {
  const copied: string[] = [];
  const unlinked: string[] = [];
  const ops: IngestFileOps = {
    copyFileExclusive: (source, target) => {
      if (overrides.copyFileExclusive) return overrides.copyFileExclusive(source, target);
      copied.push(`${source}->${target}`);
      copyFileSync(source, target, fsConstants.COPYFILE_EXCL);
    },
    unlink: (path) => {
      if (overrides.unlink) return overrides.unlink(path);
      unlinked.push(path);
      unlinkSync(path);
    },
    readIndex: (relPath) => {
      if (overrides.readIndex) return overrides.readIndex(relPath);
      return readFileSync(join(filehub, relPath), "utf-8");
    },
  };
  return { copied, unlinked, ops };
}

function gbrainEvidence(journal: IngestJournalV2): IngestGbrainEvidence {
  return {
    verifiedAt: "2026-10-18T120000",
    revision: "revision-2",
    contentHash: "c".repeat(64),
    slug: journal.slug,
    ownerKind: journal.ownerKind,
    ownerId: journal.ownerId,
    relPath: journal.relPath,
    tags: ["asset", "source:session"],
  };
}

function indexEvidence(journal: IngestJournalV2): IngestIndexEvidence {
  return {
    verifiedAt: "2026-10-18T120100",
    path: journal.indexPath,
    contentHash: createHash("sha256").update(indexText).digest("hex"),
    line: journal.indexEntry,
  };
}

async function advanceToIndex(id: string): Promise<IngestJournalV2> {
  await advanceIngest(root, id, "gbrain", async (journal) => gbrainEvidence(journal));
  indexText = "# Index\n" + plan(journalSource(id)).indexEntry + "\n";
  writeFileSync(join(filehub, "projects", "foo", "index.md"), indexText);
  return advanceIngest(root, id, "index", async (journal) => indexEvidence(journal));
}

function journalSource(id: string): string {
  return readJournal(root, id).source;
}

test("begin copies exclusively, keeps source and records schema-2 evidence inputs", () => {
  const source = sourceFile();
  const expected = plan(source);
  const tracked = track();
  const result = beginIngest(root, expected, tracked.ops);
  expect(result.kind).toBe("created");
  if (result.kind !== "created") return;
  expect(tracked.copied).toEqual([`${source}->${expected.target}`]);
  expect(existsSync(source)).toBe(true);
  expect(existsSync(expected.target)).toBe(true);
  expect(result.journal.status).toBe("staged");
  expect(result.journal.sourceHash).toBe(sha256File(source));
  expect(result.journal.targetHash).toBe(result.journal.sourceHash);
  expect(result.journal.ownerKind).toBe("project");
});

test("target already exists: conflict, no overwrite, no journal", () => {
  const source = sourceFile();
  const expected = plan(source);
  writeFileSync(expected.target, "existing\n", "utf-8");
  const result = beginIngest(root, expected, track().ops);
  expect(result.kind).toBe("target-exists");
  expect(readFileSync(expected.target, "utf-8")).toBe("existing\n");
  expect(readJournals(root).records).toHaveLength(0);
});

test("same inbox path with new bytes is not treated as a committed duplicate", async () => {
  const source = sourceFile();
  const first = beginIngest(root, plan(source), track().ops);
  expect(first.kind).toBe("created");
  if (first.kind !== "created") return;
  await advanceToIndex(first.journal.id);
  expect(completeIngest(root, first.journal.id, track().ops).kind).toBe("committed");

  writeFileSync(source, "new content at the same inbox path\n", "utf-8");
  const secondPlan = plan(source, {
    target: join(filehub, "projects", "foo", "2026-10-18-doc-v2.txt"),
    relPath: "projects/foo/2026-10-18-doc-v2.txt",
    slug: "assets/foo/doc-v2",
    indexEntry: "2026-10-18 | doc-v2 | assets/foo/doc-v2",
  });
  const second = beginIngest(root, secondPlan, track().ops);
  expect(second.kind).toBe("created");
  expect(readJournals(root).records).toHaveLength(2);
});

test("same content resumes from the same plan but a different plan is not silently merged", async () => {
  const source = sourceFile();
  const expected = plan(source);
  beginIngest(root, expected, track().ops);
  expect(beginIngest(root, expected, track().ops).kind).toBe("resume");
  const changed = beginIngest(
    root,
    plan(source, {
      target: join(filehub, "projects", "foo", "different.txt"),
      relPath: "projects/foo/different.txt",
      slug: "assets/foo/different",
      indexEntry: "2026-10-18 | different | assets/foo/different",
    }),
    track().ops,
  );
  expect(changed.kind).toBe("created");
  expect(readJournals(root).records).toHaveLength(2);
});

test("staged cannot complete or jump to index; gbrain verification is required", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  expect(() => completeIngest(root, created.journal.id, track().ops)).toThrow(/cannot complete from staged/);
  await expect(
    advanceIngest(root, created.journal.id, "index", async (journal) => indexEvidence(journal)),
  ).rejects.toThrow(/cannot advance to index from staged/);
  const advanced = await advanceIngest(root, created.journal.id, "gbrain", async (journal) => gbrainEvidence(journal));
  expect(advanced.status).toBe("gbrain");
  expect(advanced.gbrainEvidence?.slug).toBe("assets/foo/doc");
});

test("complete rechecks target and index line and removes source only on success", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  const tracked = track();
  const done = completeIngest(root, created.journal.id, tracked.ops);
  expect(done.kind).toBe("committed");
  expect(existsSync(source)).toBe(false);
  expect(tracked.unlinked).toEqual([source]);
  expect(readJournal(root, created.journal.id).status).toBe("committed");
});

test("source changes before complete: both copies preserved and no committed claim", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  writeFileSync(source, "changed after staging\n", "utf-8");
  const tracked = track();
  const result = completeIngest(root, created.journal.id, tracked.ops);
  expect(result.kind).toBe("blocked");
  expect(existsSync(source)).toBe(true);
  expect(existsSync(plan(source).target)).toBe(true);
  expect(tracked.unlinked).toEqual([]);
  expect(readJournal(root, created.journal.id).status).toBe("failed");
  expect(readJournal(root, created.journal.id).failureReason).toContain("source changed");
});

test("target changes before complete: preserved and completion blocked", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  writeFileSync(plan(source).target, "target changed\n", "utf-8");
  const result = completeIngest(root, created.journal.id, track().ops);
  expect(result.kind).toBe("blocked");
  expect(readFileSync(plan(source).target, "utf-8")).toBe("target changed\n");
  expect(existsSync(source)).toBe(true);
  expect(readJournal(root, created.journal.id).failureReason).toContain("target changed");
});

test("missing exact index line blocks completion", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  writeFileSync(join(filehub, "projects", "foo", "index.md"), "# Index\n", "utf-8");
  const result = completeIngest(root, created.journal.id, track().ops);
  expect(result.kind).toBe("blocked");
  expect(existsSync(source)).toBe(true);
});

test("staged failure compensates only the unchanged staged copy", () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  const tracked = track();
  const failed = failIngest(root, created.journal.id, "gbrain put failed", tracked.ops);
  expect(failed.status).toBe("failed");
  expect(failed.failedStep).toBe("staged");
  expect(tracked.unlinked).toEqual([plan(source).target]);
  expect(existsSync(source)).toBe(true);
});

test("changed staged target is never deleted by fail or rollback", () => {
  const source = sourceFile();
  const first = beginIngest(root, plan(source), track().ops);
  expect(first.kind).toBe("created");
  if (first.kind !== "created") return;
  writeFileSync(plan(source).target, "changed staged bytes\n", "utf-8");
  const failed = failIngest(root, first.journal.id, "write failed", track().ops);
  expect(failed.failureReason).toContain("was preserved");
  expect(existsSync(plan(source).target)).toBe(true);

  const source2 = sourceFile("doc2.txt", "second\n");
  const second = beginIngest(
    root,
    plan(source2, {
      target: join(filehub, "projects", "foo", "doc2.txt"),
      relPath: "projects/foo/doc2.txt",
      slug: "assets/foo/doc2",
      indexEntry: "2026-10-18 | doc2 | assets/foo/doc2",
    }),
    track().ops,
  );
  expect(second.kind).toBe("created");
  if (second.kind !== "created") return;
  const changedTarget = join(filehub, "projects", "foo", "doc2.txt");
  writeFileSync(changedTarget, "changed rollback target\n", "utf-8");
  const rolled = rollbackIngest(root, second.journal.id, track().ops);
  expect(rolled.failureReason).toContain("preserved");
  expect(existsSync(changedTarget)).toBe(true);
});

test("unlink failure records cleanup-pending; retry converges", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  const failing = track({ unlink: () => { throw new Error("unlink failed"); } });
  const first = completeIngest(root, created.journal.id, failing.ops);
  expect(first.kind).toBe("cleanup-pending");
  expect(isCleanupPending(readJournal(root, created.journal.id))).toBe(true);
  expect(existsSync(source)).toBe(true);
  const retry = track();
  expect(completeIngest(root, created.journal.id, retry.ops).kind).toBe("committed");
  expect(retry.unlinked).toEqual([source]);
});

test("cleanup-pending with source already absent converges without re-unlinking", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  expect(completeIngest(root, created.journal.id, track({ unlink: () => { throw new Error("blocked"); } }).ops).kind).toBe("cleanup-pending");
  unlinkSync(source);
  const retry = track();
  expect(completeIngest(root, created.journal.id, retry.ops).kind).toBe("committed");
  expect(retry.unlinked).toEqual([]);
});

test("committed write failure leaves cleanup-pending and retry converges", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  let writes = 0;
  const flakyWrite = (recordRoot: string, journal: IngestJournalV2): void => {
    writes += 1;
    if (writes === 2) throw new Error("committed write failed");
    writeJournal(recordRoot, journal);
  };
  const result = completeIngest(root, created.journal.id, track().ops, flakyWrite);
  expect(result.kind).toBe("cleanup-pending");
  expect(isCleanupPending(readJournal(root, created.journal.id))).toBe(true);
  expect(completeIngest(root, created.journal.id, track().ops).kind).toBe("committed");
});

test("resumable journals require an unchanged source and a non-failed state", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  expect(resumableJournals(root).map((journal) => journal.id)).toContain(created.journal.id);
  writeFileSync(source, "changed\n", "utf-8");
  expect(resumableJournals(root).map((journal) => journal.id)).not.toContain(created.journal.id);
  await advanceIngest(root, created.journal.id, "gbrain", async (journal) => gbrainEvidence(journal));
  expect(readJournal(root, created.journal.id).status).toBe("gbrain");
});

test("sha256File is byte-level", () => {
  const path = join(root, "binary.bin");
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
  writeFileSync(path, bytes);
  expect(sha256File(path)).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(sha256File(path)).not.toBe(createHash("sha256").update(bytes.toString("utf-8")).digest("hex"));
});

test("refreshed gbrain evidence with a mismatched source digest blocks completion", async () => {
  const source = sourceFile();
  const created = beginIngest(root, plan(source), track().ops);
  expect(created.kind).toBe("created");
  if (created.kind !== "created") return;
  await advanceToIndex(created.journal.id);
  const journal = readJournal(root, created.journal.id);
  const refreshed = { ...gbrainEvidence(journal), sourceSha256: "f".repeat(64) };
  expect(() => completeIngest(root, created.journal.id, track().ops, undefined, refreshed)).toThrow(
    /source_sha256/,
  );
  expect(readJournal(root, created.journal.id).status).not.toBe("committed");
});
