// application/ingest/journal.ts — ingest journal repository + state machine +
// compensation. Machine truth for asset-ingest recovery (Child E, F4): a file's
// source stays in the inbox until `--complete` removes it, and a failure before
// the gbrain page is written compensates by removing the staged target copy, so
// no orphan file exists and nothing is silently lost.
//
// Commit ordering (cleanup-pending): `--complete` first durably records
// `failed/failedStep=committed` (source cleanup pending), only then unlinks the
// source, and persists `committed` only after cleanup is proven complete. A
// crash or unlink failure therefore leaves a visible, retryable residue instead
// of a committed journal whose source removal silently failed (P1).
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import {
  decodeIngestJournal,
  INGEST_STEPS,
  type IngestJournalV1,
  type IngestStep,
  type IngestStatus,
} from "../../core/contracts/ingest.ts";
import { localStamp } from "../time.ts";
import { readJsonRecords } from "../fs.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";

export const INGEST_STATE_DIR = join(CONFIG_DIR, "state", "ingest");

/**
 * Byte-level sha256 of a file (streamed in chunks; never decodes to text).
 * Distinct from sha256Of (string content) — contentHash must be the file's real
 * sha256, which utf-8 decoding corrupts for PDF/PPTX/XLSX (illegal bytes → U+FFFD).
 */
export function sha256File(p: string): string {
  const h = createHash("sha256");
  const fd = openSync(p, "r");
  try {
    const buf = new Uint8Array(65536);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

export interface IngestPlan {
  source: string; // inbox file absolute path
  target: string; // staged target absolute path (inside the filehub)
  relPath: string; // filehub-relative target (portable pointer)
  slug: string; // gbrain slug assets/<projectId>/<semantic>
  projectId: string;
  indexEntry?: string; // planned project index.md line
}

/** Injected file operations (fault-injectable in tests). */
export interface IngestFileOps {
  copyFile: (src: string, dst: string) => void;
  unlink: (p: string) => void;
}

export type BeginResult =
  | { kind: "created"; journal: IngestJournalV1 }
  | { kind: "duplicate"; journal: IngestJournalV1 }
  | { kind: "resume"; journal: IngestJournalV1 }
  | { kind: "cleanup-pending"; journal: IngestJournalV1 };

/** Result of completing an ingest: committed success, or cleanup still pending
 *  after a source-removal failure (journal durably `failed/failedStep=committed`;
 *  the same `--complete` retries it idempotently). */
export type CompleteResult =
  | { kind: "committed"; journal: IngestJournalV1 }
  | { kind: "cleanup-pending"; journal: IngestJournalV1; error: Error };

/** Injected journal writer (fault-injectable in tests). */
export type JournalWriter = (root: string, j: IngestJournalV1) => void;

function dir(root: string): string {
  return join(root, INGEST_STATE_DIR);
}

export function writeJournal(root: string, j: IngestJournalV1): void {
  // atomic (temp+rename) so a crash mid-write never leaves a truncated .json
  // that readJournals would silently skip (machine-truth invariant).
  writeBytesAtomic(join(dir(root), `${j.id}.json`), JSON.stringify(j, null, 2) + "\n");
}

export function readJournals(root: string): { records: IngestJournalV1[]; issues: ContractIssue[] } {
  // Damaged journals are surfaced via issues (never silently dropped) so the
  // health surface (doctor / context) can report them like damaged incidents.
  return readJsonRecords(dir(root), {
    ext: ".json",
    decode: decodeIngestJournal,
    sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
  });
}

export function readJournal(root: string, id: string): IngestJournalV1 {
  const j = readJournals(root).records.find((x) => x.id === id);
  if (!j) throw new Error(`no ingest journal: ${id}`);
  return j;
}

/** True when the journal is cleanup-pending: the previous commit removed the
 *  source (or was about to) but did not durably prove cleanup complete. The
 *  same `--complete` retries it: unlink if the source still exists, otherwise
 *  converge to committed. Never treat it as a plain un-retryable failure. */
export function isCleanupPending(j: IngestJournalV1): boolean {
  return j.status === "failed" && j.failedStep === "committed";
}

/** The exact user-facing retry command for a cleanup-pending ingest (single
 *  source of truth so journal errors and CLI output never drift). */
export function completeRetryCommand(id: string): string {
  return `jspace ingest advance ${id} --complete`;
}

function withStamp(j: IngestJournalV1): IngestJournalV1 {
  return { ...j, updatedAt: localStamp() };
}

/** Start an ingest: hash source for idempotency, stage a target copy (source
 *  stays in inbox), record journal=staged. Duplicate (same source already
 *  committed, or same content+target) and in-progress resumes are returned
 *  without re-staging. A missing source is a hard error unless it is already
 *  recorded as committed (source removed after commit). */
export function beginIngest(root: string, plan: IngestPlan, ops: IngestFileOps): BeginResult {
  const journals = readJournals(root).records;
  // a previous commit left cleanup pending for this source: do NOT stage a
  // second copy/journal — the user/skill must finish cleanup with --complete.
  // Note: source identity is the path; if a NEW file landed at the same inbox
  // path, --complete will remove that path (documented inbox discipline).
  const pendingCleanup = journals.find((j) => isCleanupPending(j) && j.source === plan.source);
  if (pendingCleanup) return { kind: "cleanup-pending", journal: pendingCleanup };
  // source already ingested and committed (source may be gone after commit)
  const dupBySource = journals.find((j) => j.status === "committed" && j.source === plan.source);
  if (dupBySource) return { kind: "duplicate", journal: dupBySource };

  let contentHash = "";
  if (existsSync(plan.source)) {
    contentHash = sha256File(plan.source);
    const dupByContent = journals.find(
      (j) => j.status === "committed" && j.contentHash === contentHash && j.relPath === plan.relPath,
    );
    if (dupByContent) return { kind: "duplicate", journal: dupByContent };
    const inProgress = journals.find(
      (j) => j.status !== "committed" && j.status !== "failed" && j.source === plan.source,
    );
    if (inProgress) return { kind: "resume", journal: inProgress };
  }
  if (!existsSync(plan.source)) {
    throw new Error(`ingest: source not found: ${plan.source}`);
  }

  ops.copyFile(plan.source, plan.target);
  const journal: IngestJournalV1 = {
    schema_version: 1,
    id: crypto.randomUUID(),
    source: plan.source,
    target: plan.target,
    relPath: plan.relPath,
    slug: plan.slug,
    projectId: plan.projectId,
    contentHash,
    status: "staged",
    ...(plan.indexEntry !== undefined ? { indexEntry: plan.indexEntry } : {}),
    createdAt: localStamp(),
    updatedAt: localStamp(),
  };
  try {
    writeJournal(root, journal);
  } catch (e) {
    // journal write failed after the staged copy: compensate (remove the copy)
    // so no target file exists without a journal record (no-orphan invariant).
    try {
      ops.unlink(plan.target);
    } catch {
      /* best-effort compensation */
    }
    throw e;
  }
  return { kind: "created", journal };
}

/** Advance an intermediate mechanical step (gbrain / index). `committed` is
 *  handled by completeIngest() — it has its own cleanup-pending machine so a
 *  failed source removal stays visible and retryable instead of a fake success.
 *  A cleanup-pending journal (failed/failedStep=committed) can only move forward
 *  via completeIngest(); other failed states stay illegal. */
export function advanceIngest(root: string, id: string, step: IngestStep, _ops: IngestFileOps): IngestJournalV1 {
  const j = readJournal(root, id);
  if (j.status === "failed") {
    if (isCleanupPending(j)) {
      throw new Error(`ingest ${id}: source cleanup pending; run "${completeRetryCommand(id)}" first`);
    }
    throw new Error(`ingest ${id} is failed; retry or rollback first`);
  }
  if (step === "committed") throw new Error(`ingest ${id}: use "${completeRetryCommand(id)}" for the committed step`);
  const stepIndex = INGEST_STEPS.indexOf(step);
  const currentIndex = INGEST_STEPS.indexOf(j.status as IngestStep);
  if (stepIndex !== currentIndex + 1) {
    throw new Error(`ingest ${id}: cannot advance to ${step} from ${j.status}`);
  }
  const updated = withStamp({ ...j, status: step });
  writeJournal(root, updated);
  return updated;
}

/** Complete an ingest (the `--complete` step). Starting states are `index` (normal
 *  path) and `failed/failedStep=committed` (cleanup-pending recovery); anything
 *  else is illegal. Ordering guarantees a visible, retryable residue over false
 *  success or silent loss:
 *
 *  1. durably record cleanup-pending (`failed/failedStep=committed`) BEFORE any
 *     source mutation — a crash here leaves `index`, so `--complete` just reruns;
 *  2. unlink the source when present (missing = already cleaned, skip);
 *  3. persist `committed` only after cleanup is known complete.
 *
 * Unlink failure keeps the cleanup-pending state durable and returns
 * `{ kind: "cleanup-pending", error }`; the same command retries idempotently.
 * If the final committed write fails after a successful unlink, the durable
 * cleanup-pending state still reads back and the next `--complete` converges
 * without re-unlinking. */
export function completeIngest(
  root: string,
  id: string,
  ops: IngestFileOps,
  write: JournalWriter = writeJournal,
): CompleteResult {
  const j = readJournal(root, id);
  const pending =
    j.status === "index"
      ? withStamp({ ...j, status: "failed" as IngestStatus, failedStep: "committed", failureReason: "source cleanup pending" })
      : isCleanupPending(j)
        ? j
        : null;
  if (!pending) {
    throw new Error(
      `ingest ${id}: cannot complete from ${j.status}${j.failedStep ? ` (failedStep=${j.failedStep})` : ""}; only index or cleanup-pending may be completed`,
    );
  }
  if (pending !== j) {
    try {
      write(root, pending); // persist cleanup-pending before unlink
    } catch (e) {
      // durable journal is still `index`; the recovery is simply to rerun.
      const error = e instanceof Error ? e : new Error(String(e));
      throw new Error(`ingest ${id}: could not record cleanup-pending (journal is still index); retry ${completeRetryCommand(id)}: ${error.message}`);
    }
  }
  return finishCleanup(root, pending, ops, write);
}

function finishCleanup(root: string, pending: IngestJournalV1, ops: IngestFileOps, write: JournalWriter): CompleteResult {
  if (existsSync(pending.source)) {
    try {
      ops.unlink(pending.source);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      // keep cleanup-pending durable and record why; retry is the same command.
      const recorded = withStamp({ ...pending, failureReason: `source cleanup pending: ${error.message}` });
      try {
        write(root, recorded);
      } catch {
        /* the pre-unlink cleanup-pending journal is already durable */
      }
      return { kind: "cleanup-pending", journal: recorded, error };
    }
  }
  // source removed now (or already absent): persist committed
  const committed = withStamp({ ...pending, status: "committed" as IngestStatus, failedStep: undefined, failureReason: undefined });
  try {
    write(root, committed);
  } catch (e) {
    // atomic write left the pre-unlink cleanup-pending journal on disk; the
    // source is gone, so the next --complete skips the unlink and converges.
    const error = e instanceof Error ? e : new Error(String(e));
    return { kind: "cleanup-pending", journal: pending, error };
  }
  return { kind: "committed", journal: committed };
}

/** Mark an ingest failed and apply the compensation for the step in progress.
 *  staged (gbrain never written) -> remove the staged target copy, source stays
 *  in inbox (no orphan). gbrain/index -> page already exists; no destructive
 *  compensation (index/commit remain retryable). failedStep records the LAST
 *  COMPLETED step (j.status) — never "committed": the cleanup-pending marker
 *  (`failed/failedStep=committed`) is produced ONLY by completeIngest when the
 *  source removal is in doubt. A plain failure must not masquerade as
 *  cleanup-pending, or `--complete` would force-commit it and unlink the source. */
export function failIngest(root: string, id: string, reason: string, ops: IngestFileOps): IngestJournalV1 {
  const j = readJournal(root, id);
  if (j.status === "committed") throw new Error(`ingest ${id} is already committed`);
  if (isCleanupPending(j)) {
    throw new Error(`ingest ${id}: source cleanup pending; run "${completeRetryCommand(id)}" first`);
  }
  if (j.status === "failed") throw new Error(`ingest ${id} is already failed`);
  if (j.status === "staged") {
    // gbrain page was never written: remove the staged copy, keep source in inbox.
    ops.unlink(j.target);
  }
  const updated = withStamp({
    ...j,
    status: "failed" as IngestStatus,
    failedStep: j.status as IngestStep,
    failureReason: reason,
  });
  writeJournal(root, updated);
  return updated;
}

/** Explicitly abandon a staged-only ingest (no gbrain page yet): remove the
 *  staged target copy so the source is the only copy. Refuses once the page
 *  exists (gbrain/index) — there a page would be orphaned by removal. */
export function rollbackIngest(root: string, id: string, ops: IngestFileOps): IngestJournalV1 {
  const j = readJournal(root, id);
  if (j.status === "committed") throw new Error(`ingest ${id} is already committed`);
  if (isCleanupPending(j)) {
    throw new Error(`ingest ${id}: source cleanup pending; run "${completeRetryCommand(id)}" first`);
  }
  if (j.status === "failed") throw new Error(`ingest ${id} is already failed`);
  if (j.status === "gbrain" || j.status === "index") {
    throw new Error(`ingest ${id}: gbrain page already written; rollback would orphan it — continue or repair manually`);
  }
  if (j.status === "staged") ops.unlink(j.target);
  const updated = withStamp({ ...j, status: "failed" as IngestStatus, failedStep: "staged", failureReason: "rolled back" });
  writeJournal(root, updated);
  return updated;
}

/** In-progress journals whose source still exists in inbox are resumable:
 *  the next batch continues from the recorded step (no completed step redoes). */
export function resumableJournals(root: string): IngestJournalV1[] {
  return readJournals(root).records.filter(
    (j) => (j.status === "staged" || j.status === "gbrain" || j.status === "index") && existsSync(j.source),
  );
}
