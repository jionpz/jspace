// application/ingest/journal.test.ts — ingest journal state machine + compensation
// + idempotency + interruption resume. Fault injection via injected file ops;
// never touches a real filehub.
// Run: bun test application/ingest/journal.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-ingest-"));
  inbox = join(root, "inbox");
  filehub = join(root, "filehub");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(join(filehub, "projects", "foo"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function track(overrides: Partial<IngestFileOps> = {}) {
  const copied: string[] = [];
  const unlinked: string[] = [];
  return {
    copied,
    unlinked,
    ops: {
      copyFile: (s: string, d: string) => {
        if (overrides.copyFile) return overrides.copyFile(s, d);
        copied.push(`${s}->${d}`);
      },
      unlink: (p: string) => {
        if (overrides.unlink) return overrides.unlink(p);
        unlinked.push(p);
      },
    } as IngestFileOps,
  };
}

function sourceFile(): string {
  const p = join(inbox, "doc.txt");
  writeFileSync(p, "some ingestable content\n", "utf-8");
  return p;
}

function plan(source: string): IngestPlan {
  return {
    source,
    target: join(filehub, "projects", "foo", "2026-08-04-doc.txt"),
    relPath: "projects/foo/2026-08-04-doc.txt",
    slug: "assets/foo/doc",
    projectId: "foo",
    indexEntry: "doc.txt | 2026-08-04 | assets/foo/doc",
  };
}

test("begin copies a staged target, keeps source in inbox, journal=staged", () => {
  const src = sourceFile();
  const t = track();
  const res = beginIngest(root, plan(src), t.ops);
  expect(res.kind).toBe("created");
  if (res.kind !== "created") return;
  expect(t.copied).toEqual([`${src}->${plan(src).target}`]);
  expect(res.journal.status).toBe("staged");
  expect(existsSync(src)).toBe(true); // source stays in inbox
  expect(readJournals(root)).toHaveLength(1);
});

test("full advance staged→gbrain→index→committed removes the source", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  expect(advanceIngest(root, id, "gbrain", t.ops).status).toBe("gbrain");
  expect(advanceIngest(root, id, "index", t.ops).status).toBe("index");
  const done = completeIngest(root, id, t.ops);
  expect(done.kind).toBe("committed");
  if (done.kind !== "committed") return;
  expect(done.journal.status).toBe("committed");
  expect(t.unlinked).toEqual([src]); // source removed only at commit
});

test("illegal state transitions are rejected", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  expect(() => advanceIngest(root, id, "index", t.ops)).toThrow(/cannot advance/); // staged→index skips gbrain
  expect(() => completeIngest(root, id, t.ops)).toThrow(/cannot complete from staged/); // staged→committed illegal
  expect(advanceIngest(root, id, "gbrain", t.ops).status).toBe("gbrain");
  expect(() => advanceIngest(root, id, "gbrain", t.ops)).toThrow(/cannot advance/); // no-op re-advance
});

test("duplicate ingest (same content+relPath, committed) is skipped idempotently", () => {
  const src = sourceFile();
  const t = track();
  const first = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, first.journal.id, "gbrain", t.ops);
  advanceIngest(root, first.journal.id, "index", t.ops);
  completeIngest(root, first.journal.id, t.ops);
  const again = beginIngest(root, plan(src), t.ops);
  expect(again.kind).toBe("duplicate");
  expect(readJournals(root)).toHaveLength(1); // no second journal, no second page
});

test("re-begin of an in-progress file resumes (no re-copy)", () => {
  const src = sourceFile();
  const t = track();
  const first = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  t.copied.length = 0;
  const again = beginIngest(root, plan(src), t.ops);
  expect(again.kind).toBe("resume");
  expect(t.copied).toEqual([]); // did not re-stage
});

test("fail at staged compensates: staged copy removed, source stays in inbox (no orphan)", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const failed = failIngest(root, journal.id, "gbrain put failed", t.ops);
  expect(failed.status).toBe("failed");
  expect(failed.failedStep).toBe("staged"); // the last completed step (staged copy removed)
  expect(failed.failureReason).toBe("gbrain put failed");
  expect(t.unlinked).toEqual([plan(src).target]); // staged copy removed
  expect(existsSync(src)).toBe(true); // source remains, retryable
});

test("fail at index (page already written) does not destructively compensate", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, journal.id, "gbrain", t.ops);
  t.unlinked.length = 0;
  const failed = failIngest(root, journal.id, "index update failed", t.ops);
  expect(failed.status).toBe("failed");
  expect(failed.failedStep).toBe("gbrain"); // last completed step; index/commit still retryable
  expect(t.unlinked).toEqual([]); // keep file+page; index retryable
  expect(existsSync(src)).toBe(true);
});

test("interruption resumes from the recorded step without redoing", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, journal.id, "gbrain", t.ops); // interrupted after gbrain
  // next batch: journal is resumable; continue from gbrain -> index -> complete
  expect(resumableJournals(root).map((j) => j.id)).toContain(journal.id);
  expect(advanceIngest(root, journal.id, "index", t.ops).status).toBe("index");
  const done = completeIngest(root, journal.id, t.ops);
  expect(done.kind).toBe("committed");
  if (done.kind !== "committed") return;
  expect(done.journal.status).toBe("committed");
  // staged/gbrain steps were NOT re-executed (no extra copy, single source removal)
  expect(t.copied).toHaveLength(1);
  expect(t.unlinked).toEqual([src]);
});

test("rollback abandons a staged ingest and refuses once the page exists", () => {
  const src = sourceFile();
  const t = track();
  const staged = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const rolled = rollbackIngest(root, staged.journal.id, t.ops);
  expect(rolled.status).toBe("failed");
  expect(t.unlinked).toEqual([plan(src).target]);
  // page-written ingest cannot be rolled back (would orphan the page)
  const src2 = join(inbox, "doc2.txt");
  writeFileSync(src2, "second\n", "utf-8");
  const gbrain = beginIngest(root, { ...plan(src2), relPath: "projects/foo/doc2.txt" }, t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, gbrain.journal.id, "gbrain", t.ops);
  expect(() => rollbackIngest(root, gbrain.journal.id, t.ops)).toThrow(/gbrain page already written/);
});

test("unlink failure leaves durable cleanup-pending, not a false committed", () => {
  const src = sourceFile();
  const t = track({ unlink: () => { throw new Error("unlink failed"); } });
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", t.ops);
  advanceIngest(root, id, "index", t.ops);
  // cleanup-pending is durably recorded before the unlink; the unlink failure keeps it
  const res = completeIngest(root, id, t.ops);
  expect(res.kind).toBe("cleanup-pending");
  if (res.kind !== "cleanup-pending") return;
  expect(res.error.message).toContain("unlink failed");
  const j = readJournal(root, id);
  expect(j.status).toBe("failed");
  expect(j.failedStep).toBe("committed");
  expect(j.failureReason).toContain("source cleanup pending: unlink failed");
  expect(existsSync(src)).toBe(true); // source was NOT removed
  expect(resumableJournals(root)).toHaveLength(0); // not auto-resumed; needs explicit --complete
});

test("cleanup retry with source still present unlinks and converges to committed", () => {
  const src = sourceFile();
  const failOps = track({ unlink: () => { throw new Error("unlink failed"); } });
  const { journal } = beginIngest(root, plan(src), failOps.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", failOps.ops);
  advanceIngest(root, id, "index", failOps.ops);
  expect(completeIngest(root, id, failOps.ops).kind).toBe("cleanup-pending"); // first attempt fails
  expect(isCleanupPending(readJournal(root, id))).toBe(true);
  // retry the same --complete with working ops: source exists -> unlink -> committed
  const ok = track();
  const res = completeIngest(root, id, ok.ops);
  expect(res.kind).toBe("committed");
  expect(ok.unlinked).toEqual([src]); // source exists -> unlinked once
  expect(readJournal(root, id).status).toBe("committed");
});

test("cleanup retry with source already absent skips unlink and converges", () => {
  const src = sourceFile();
  const failOps = track({ unlink: () => { throw new Error("unlink failed"); } });
  const { journal } = beginIngest(root, plan(src), failOps.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", failOps.ops);
  advanceIngest(root, id, "index", failOps.ops);
  expect(completeIngest(root, id, failOps.ops).kind).toBe("cleanup-pending");
  // simulate the crash window: cleanup-pending durable + source already removed
  // (e.g. the unlink succeeded but the committed write never landed)
  unlinkSync(src);
  expect(isCleanupPending(readJournal(root, id))).toBe(true);
  const ok = track();
  const res = completeIngest(root, id, ok.ops);
  expect(res.kind).toBe("committed");
  expect(ok.unlinked).toEqual([]); // source already gone: no second unlink
  expect(readJournal(root, id).status).toBe("committed");
});

test("failed committed write after unlink leaves cleanup-pending; retry converges", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", t.ops);
  advanceIngest(root, id, "index", t.ops);
  // injected writer: first write (cleanup-pending) ok, second write (committed) fails
  let writes = 0;
  const flakyWrite = (r: string, j: IngestJournalV1): void => {
    writes += 1;
    if (writes === 2) throw new Error("committed write failed");
    writeJournal(r, j);
  };
  const res = completeIngest(root, id, t.ops, flakyWrite);
  expect(res.kind).toBe("cleanup-pending");
  if (res.kind !== "cleanup-pending") return;
  expect(res.error.message).toContain("committed write failed");
  // durable cleanup-pending survives; the source unlink already happened
  expect(isCleanupPending(readJournal(root, id))).toBe(true);
  expect(t.unlinked).toEqual([src]);
  // physically remove the source to match the real post-unlink crash state
  unlinkSync(src);
  // retry with a working writer converges without re-unlinking
  const ok = track();
  const retry = completeIngest(root, id, ok.ops);
  expect(retry.kind).toBe("committed");
  expect(ok.unlinked).toEqual([]);
  expect(readJournal(root, id).status).toBe("committed");
});

test("begin on a cleanup-pending source does not create a second journal", () => {
  const src = sourceFile();
  const failOps = track({ unlink: () => { throw new Error("unlink failed"); } });
  const first = beginIngest(root, plan(src), failOps.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, first.journal.id, "gbrain", failOps.ops);
  advanceIngest(root, first.journal.id, "index", failOps.ops);
  expect(completeIngest(root, first.journal.id, failOps.ops).kind).toBe("cleanup-pending");
  const again = beginIngest(root, plan(src), failOps.ops);
  expect(again.kind).toBe("cleanup-pending");
  expect(readJournals(root)).toHaveLength(1); // no second journal, no re-stage
  expect(isCleanupPending(readJournal(root, first.journal.id))).toBe(true);
});

test("a hand-written v1 cleanup-pending journal decodes and recovers", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  // write the raw v1 shape directly (what an older release / crash leaves on disk)
  const pendingRaw = { ...journal, status: "failed", failedStep: "committed", failureReason: "source cleanup pending" };
  writeJournal(root, pendingRaw);
  expect(isCleanupPending(readJournal(root, journal.id))).toBe(true);
  const res = completeIngest(root, journal.id, t.ops);
  expect(res.kind).toBe("committed");
  expect(t.unlinked).toEqual([src]); // cleanup unlinks the leftover source once
  expect(readJournal(root, journal.id).status).toBe("committed");
});

test("failed cleanup-pending write leaves journal at index; retry --complete works", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", t.ops);
  advanceIngest(root, id, "index", t.ops);
  // first write of the committed path (the cleanup-pending persist) fails
  let writes = 0;
  const failFirstWrite = (r: string, j: IngestJournalV1): void => {
    writes += 1;
    if (writes === 1) throw new Error("pending write failed");
    writeJournal(r, j);
  };
  expect(() => completeIngest(root, id, t.ops, failFirstWrite)).toThrow(/still index/);
  expect(readJournal(root, id).status).toBe("index"); // durable state unchanged
  expect(t.unlinked).toEqual([]); // no unlink before the pending write
  const res = completeIngest(root, id, t.ops); // rerun the same --complete
  expect(res.kind).toBe("committed");
  expect(readJournal(root, id).status).toBe("committed");
  expect(t.unlinked).toEqual([src]);
});

test("advance/fail/rollback reject a cleanup-pending journal and point to --complete", () => {
  const src = sourceFile();
  const failOps = track({ unlink: () => { throw new Error("unlink failed"); } });
  const { journal } = beginIngest(root, plan(src), failOps.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", failOps.ops);
  advanceIngest(root, id, "index", failOps.ops);
  expect(completeIngest(root, id, failOps.ops).kind).toBe("cleanup-pending");
  expect(isCleanupPending(readJournal(root, id))).toBe(true);
  expect(() => advanceIngest(root, id, "gbrain", failOps.ops)).toThrow(/--complete/);
  expect(() => failIngest(root, id, "nope", failOps.ops)).toThrow(/--complete/);
  expect(() => rollbackIngest(root, id, failOps.ops)).toThrow(/--complete/);
  expect(isCleanupPending(readJournal(root, id))).toBe(true); // rejections never disturb it
});

test("fail at index is NOT cleanup-pending; --complete refuses; re-begin recovers", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  advanceIngest(root, id, "gbrain", t.ops);
  advanceIngest(root, id, "index", t.ops);
  // a user/skill abort at index is a PLAIN failure (failedStep=index), never the
  // cleanup-pending marker — only completeIngest may create that. --complete must
  // refuse (not force-commit + unlink the source), and the source stays for a retry.
  const failed = failIngest(root, id, "manual abort", t.ops);
  expect(failed.status).toBe("failed");
  expect(failed.failedStep).toBe("index");
  expect(isCleanupPending(readJournal(root, id))).toBe(false);
  expect(() => completeIngest(root, id, t.ops)).toThrow(/cannot complete/);
  expect(t.unlinked).toEqual([]); // source never touched
  expect(existsSync(src)).toBe(true);
  // retry: re-begin stages a fresh journal; the source is still in inbox
  const again = beginIngest(root, plan(src), t.ops);
  expect(again.kind).toBe("created");
  expect(readJournals(root)).toHaveLength(2);
  expect(existsSync(src)).toBe(true);
});

test("copy failure at begin does not write a journal", () => {
  const src = sourceFile();
  const t = track({ copyFile: () => { throw new Error("disk full"); } });
  expect(() => beginIngest(root, plan(src), t.ops)).toThrow(/disk full/);
  expect(readJournals(root)).toHaveLength(0);
});

test("sha256File is byte-level (matches shasum, not utf-8 text hash)", () => {
  // synthetic PDF bytes: include a byte sequence invalid under utf-8
  // (e.g. 0xFF 0xFE) so a text-based hash would differ.
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from([0xff, 0xfe, 0x00, 0x01]),
    Buffer.from("\n%%EOF\n"),
  ]);
  const xlsx = Buffer.concat([
    Buffer.from("PK\x03\x04"),
    Buffer.from([0x80, 0x81, 0x82, 0x83]),
    Buffer.from("mock xlsx body"),
  ]);
  for (const [name, buf] of [["sample.pdf", pdf], ["sample.xlsx", xlsx]] as const) {
    const p = join(inbox, name);
    writeFileSync(p, buf);
    // expected: real sha256 of the bytes (compute independently via crypto)
    const expected = createHash("sha256").update(buf).digest("hex");
    expect(sha256File(p)).toBe(expected);
    // sanity: must differ from utf-8 text hash when bytes are invalid utf-8
    const textHash = createHash("sha256").update(buf.toString("utf-8")).digest("hex");
    expect(sha256File(p)).not.toBe(textHash);
  }
});
