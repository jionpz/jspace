// application/ingest/journal.test.ts — ingest journal state machine + compensation
// + idempotency + interruption resume. Fault injection via injected file ops;
// never touches a real filehub.
// Run: bun test application/ingest/journal.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceIngest,
  beginIngest,
  failIngest,
  readJournal,
  readJournals,
  resumableJournals,
  rollbackIngest,
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
  const done = advanceIngest(root, id, "committed", t.ops);
  expect(done.status).toBe("committed");
  expect(t.unlinked).toEqual([src]); // source removed only at commit
});

test("illegal state transitions are rejected", () => {
  const src = sourceFile();
  const t = track();
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  const id = journal.id;
  expect(() => advanceIngest(root, id, "index", t.ops)).toThrow(/cannot advance/); // staged→index skips gbrain
  expect(() => advanceIngest(root, id, "committed", t.ops)).toThrow(/cannot advance/);
  expect(advanceIngest(root, id, "gbrain", t.ops).status).toBe("gbrain");
  expect(() => advanceIngest(root, id, "gbrain", t.ops)).toThrow(/cannot advance/); // no-op re-advance
});

test("duplicate ingest (same content+relPath, committed) is skipped idempotently", () => {
  const src = sourceFile();
  const t = track();
  const first = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, first.journal.id, "gbrain", t.ops);
  advanceIngest(root, first.journal.id, "index", t.ops);
  advanceIngest(root, first.journal.id, "committed", t.ops);
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
  expect(failed.failedStep).toBe("gbrain"); // gbrain was the step in progress
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
  expect(failed.failedStep).toBe("index");
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
  expect(advanceIngest(root, journal.id, "committed", t.ops).status).toBe("committed");
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

test("commit persists journal BEFORE removing source: unlink failure leaves committed, not stuck", () => {
  const src = sourceFile();
  const t = track({ unlink: () => { throw new Error("unlink failed"); } });
  const { journal } = beginIngest(root, plan(src), t.ops) as { kind: "created"; journal: { id: string } };
  advanceIngest(root, journal.id, "gbrain", t.ops);
  advanceIngest(root, journal.id, "index", t.ops);
  // journal is persisted as committed first; the source unlink fails but is caught
  expect(advanceIngest(root, journal.id, "committed", t.ops).status).toBe("committed");
  expect(readJournal(root, journal.id).status).toBe("committed");
  expect(existsSync(src)).toBe(true); // leftover source; dupBySource prevents re-ingest
  // and the journal is not stuck in a dead state: it reads back committed
  expect(resumableJournals(root)).toHaveLength(0);
});

test("copy failure at begin does not write a journal", () => {
  const src = sourceFile();
  const t = track({ copyFile: () => { throw new Error("disk full"); } });
  expect(() => beginIngest(root, plan(src), t.ops)).toThrow(/disk full/);
  expect(readJournals(root)).toHaveLength(0);
});
