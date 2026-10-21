// application/ingest/journal.ts — durable ingest journal state machine.
//
// Safety invariants:
// - the inbox source is removed only after verified gbrain/index checkpoints;
// - target creation is exclusive (no overwrite);
// - content identity, not an inbox path alone, detects duplicates;
// - source and target hashes are rechecked immediately before cleanup;
// - compensation removes a staged target only when its bytes still match the
//   exact copy this journal created.
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import {
  decodeIngestJournal,
  type IngestGbrainEvidence,
  type IngestIndexEvidence,
  type IngestJournalV2,
  type IngestStep,
} from "../../core/contracts/ingest.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";
import { readJsonRecords } from "../fs.ts";
import { withIngestMutationLock, withIngestMutationLockAsync } from "../lock.ts";
import { localStamp } from "../time.ts";

export const INGEST_STATE_DIR = join(CONFIG_DIR, "state", "ingest");

/** Byte-level sha256 for arbitrary binary assets. */
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
  source: string;
  target: string;
  relPath: string;
  ownerKind: "project" | "area";
  ownerId: string;
  slug: string;
  indexPath: string;
  indexEntry: string;
}

export interface IngestFileOps {
  /** Must use O_EXCL / COPYFILE_EXCL semantics. */
  copyFileExclusive: (src: string, dst: string) => void;
  unlink: (p: string) => void;
  /** Read an index by its filehub-relative path. */
  readIndex: (relPath: string) => string;
}

export type BeginResult =
  | { kind: "created"; journal: IngestJournalV2 }
  | { kind: "duplicate"; journal: IngestJournalV2 }
  | { kind: "resume"; journal: IngestJournalV2 }
  | { kind: "cleanup-pending"; journal: IngestJournalV2 }
  | { kind: "failed"; journal: IngestJournalV2 }
  | { kind: "target-exists"; journal?: undefined };

export type CompleteResult =
  | { kind: "committed"; journal: IngestJournalV2 }
  | { kind: "cleanup-pending"; journal: IngestJournalV2; error: Error }
  | { kind: "blocked"; journal: IngestJournalV2; error: Error };

export type JournalWriter = (root: string, j: IngestJournalV2) => void;

export type IngestVerifier =
  | ((journal: IngestJournalV2) => Promise<IngestGbrainEvidence>)
  | ((journal: IngestJournalV2) => Promise<IngestIndexEvidence>);

function dir(root: string): string {
  return join(root, INGEST_STATE_DIR);
}

export function writeJournal(root: string, journal: IngestJournalV2): void {
  const decoded = decodeIngestJournal(journal);
  if (!decoded.ok) {
    throw new Error(`refusing to write invalid ingest journal: ${decoded.issues.map((i) => i.message).join("; ")}`);
  }
  writeBytesAtomic(join(dir(root), `${journal.id}.json`), JSON.stringify(journal, null, 2) + "\n");
}

export function readJournals(root: string): { records: IngestJournalV2[]; issues: ContractIssue[] } {
  return readJsonRecords(dir(root), {
    ext: ".json",
    decode: decodeIngestJournal,
    sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
  });
}

export function readJournal(root: string, id: string): IngestJournalV2 {
  const journal = readJournals(root).records.find((candidate) => candidate.id === id);
  if (!journal) throw new Error(`no ingest journal: ${id}`);
  return journal;
}

export function isCleanupPending(journal: IngestJournalV2): boolean {
  return journal.status === "failed" && journal.failedStep === "committed";
}

export function completeRetryCommand(id: string): string {
  return `jspace ingest advance ${id} --complete`;
}

function withStamp(journal: IngestJournalV2): IngestJournalV2 {
  return { ...journal, updatedAt: localStamp() };
}

function samePlan(journal: IngestJournalV2, plan: IngestPlan, sourceHash: string): boolean {
  return (
    journal.source === plan.source &&
    journal.sourceHash === sourceHash &&
    journal.target === plan.target &&
    journal.relPath === plan.relPath &&
    journal.ownerKind === plan.ownerKind &&
    journal.ownerId === plan.ownerId &&
    journal.slug === plan.slug &&
    journal.indexPath === plan.indexPath &&
    journal.indexEntry === plan.indexEntry
  );
}

function isEexist(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === "EEXIST" || candidate?.message?.includes("EEXIST") === true;
}

function safeUnlinkIfIdentity(path: string, expectedHash: string, ops: IngestFileOps): { removed: boolean; changed: boolean } {
  if (!existsSync(path)) return { removed: false, changed: false };
  let actual: string;
  try {
    actual = sha256File(path);
  } catch {
    return { removed: false, changed: true };
  }
  if (actual !== expectedHash) return { removed: false, changed: true };
  ops.unlink(path);
  return { removed: true, changed: false };
}

export function beginIngest(root: string, plan: IngestPlan, ops: IngestFileOps): BeginResult {
  return withIngestMutationLock(root, () => beginIngestImpl(root, plan, ops));
}

function beginIngestImpl(root: string, plan: IngestPlan, ops: IngestFileOps): BeginResult {
  if (!existsSync(plan.source)) throw new Error(`ingest: source not found: ${plan.source}`);
  const sourceHash = sha256File(plan.source);
  const journals = readJournals(root).records;

  const committed = journals.find(
    (journal) => journal.status === "committed" && journal.sourceHash === sourceHash,
  );
  if (committed) return { kind: "duplicate", journal: committed };

  const cleanup = journals.find(
    (journal) => isCleanupPending(journal) && journal.source === plan.source && journal.sourceHash === sourceHash,
  );
  if (cleanup) return { kind: "cleanup-pending", journal: cleanup };

  const inProgress = journals.find(
    (journal) =>
      (journal.status === "staged" || journal.status === "gbrain" || journal.status === "index") &&
      samePlan(journal, plan, sourceHash),
  );
  if (inProgress) return { kind: "resume", journal: inProgress };

  const failed = journals.find(
    (journal) =>
      journal.status === "failed" &&
      !isCleanupPending(journal) &&
      journal.source === plan.source &&
      journal.sourceHash === sourceHash,
  );
  if (failed) return { kind: "failed", journal: failed };

  if (existsSync(plan.target)) return { kind: "target-exists" };
  try {
    ops.copyFileExclusive(plan.source, plan.target);
  } catch (error) {
    if (isEexist(error) || existsSync(plan.target)) return { kind: "target-exists" };
    throw error;
  }

  let targetHash: string;
  try {
    targetHash = sha256File(plan.target);
  } catch (error) {
    // The target's bytes cannot be proven; preserve it for inspection.
    throw new Error(`ingest: could not hash staged target ${plan.target}: ${(error as Error).message}`);
  }
  if (targetHash !== sourceHash) {
    // Unexpected copy mutation: never delete either copy without evidence.
    throw new Error(
      `ingest: staged target content differs from source (${plan.target}); both copies were preserved`,
    );
  }

  const journal: IngestJournalV2 = {
    schema_version: 2,
    id: crypto.randomUUID(),
    source: plan.source,
    target: plan.target,
    relPath: plan.relPath,
    ownerKind: plan.ownerKind,
    ownerId: plan.ownerId,
    slug: plan.slug,
    indexPath: plan.indexPath,
    indexEntry: plan.indexEntry,
    sourceHash,
    targetHash,
    status: "staged",
    createdAt: localStamp(),
    updatedAt: localStamp(),
  };
  try {
    writeJournal(root, journal);
  } catch (error) {
    const cleanupResult = safeUnlinkIfIdentity(plan.target, sourceHash, ops);
    if (cleanupResult.changed) {
      throw new Error(
        `ingest: journal write failed and the staged target changed; both copies were preserved: ${(error as Error).message}`,
      );
    }
    throw error;
  }
  return { kind: "created", journal };
}

function assertAdvanceable(journal: IngestJournalV2, step: "gbrain" | "index"): void {
  if (journal.status === "failed") {
    if (isCleanupPending(journal)) {
      throw new Error(`ingest ${journal.id}: source cleanup pending; run "${completeRetryCommand(journal.id)}" first`);
    }
    throw new Error(`ingest ${journal.id} is failed; resolve or roll back the journal first`);
  }
  const expected = step === "gbrain" ? "staged" : "gbrain";
  if (journal.status !== expected) {
    throw new Error(`ingest ${journal.id}: cannot advance to ${step} from ${journal.status}`);
  }
}

export async function advanceIngest(
  root: string,
  id: string,
  step: "gbrain" | "index",
  verify: IngestVerifier,
): Promise<IngestJournalV2> {
  return withIngestMutationLockAsync(root, async () => {
    const journal = readJournal(root, id);
    assertAdvanceable(journal, step);
    const evidence = await verify(journal);
    const updated = withStamp({
      ...journal,
      status: step,
      ...(step === "gbrain"
        ? { gbrainEvidence: evidence as IngestGbrainEvidence }
        : { indexEvidence: evidence as IngestIndexEvidence }),
    });
    writeJournal(root, updated);
    return updated;
  });
}

function failedJournal(
  journal: IngestJournalV2,
  failedStep: IngestStep,
  reason: string,
): IngestJournalV2 {
  return withStamp({
    ...journal,
    status: "failed",
    failedStep,
    failureReason: reason,
  });
}

function verifyIndexLine(journal: IngestJournalV2, ops: IngestFileOps): { contentHash: string } {
  let content: string;
  try {
    content = ops.readIndex(journal.indexPath);
  } catch (error) {
    throw new Error(`index ${journal.indexPath} is not readable: ${(error as Error).message}`);
  }
  const lines = content.split(/\r?\n/);
  if (!lines.includes(journal.indexEntry)) {
    throw new Error(`index ${journal.indexPath} does not contain the exact planned line: ${journal.indexEntry}`);
  }
  return { contentHash: createHash("sha256").update(content).digest("hex") };
}

export function completeIngest(
  root: string,
  id: string,
  ops: IngestFileOps,
  write: JournalWriter = writeJournal,
  refreshedGbrainEvidence?: IngestGbrainEvidence,
): CompleteResult {
  return withIngestMutationLock(root, () =>
    completeIngestImpl(root, id, ops, write, refreshedGbrainEvidence),
  );
}

function completeIngestImpl(
  root: string,
  id: string,
  ops: IngestFileOps,
  write: JournalWriter,
  refreshedGbrainEvidence: IngestGbrainEvidence | undefined,
): CompleteResult {
  const journal = readJournal(root, id);
  const cleanupPending = isCleanupPending(journal);
  if (journal.status !== "index" && !cleanupPending) {
    throw new Error(
      `ingest ${id}: cannot complete from ${journal.status}${journal.failedStep ? ` (failedStep=${journal.failedStep})` : ""}; only index or cleanup-pending may be completed`,
    );
  }
  const gbrainEvidence = refreshedGbrainEvidence ?? journal.gbrainEvidence;
  if (!gbrainEvidence || !journal.indexEvidence) {
    throw new Error(`ingest ${id}: completion requires verified gbrain and index evidence`);
  }
  if (
    gbrainEvidence.slug !== journal.slug ||
    gbrainEvidence.ownerKind !== journal.ownerKind ||
    gbrainEvidence.ownerId !== journal.ownerId ||
    gbrainEvidence.relPath !== journal.relPath
  ) {
    throw new Error(`ingest ${id}: refreshed gbrain evidence does not match the journal plan`);
  }
  if (gbrainEvidence.sourceSha256 !== undefined && gbrainEvidence.sourceSha256 !== journal.targetHash) {
    throw new Error(
      `ingest ${id}: refreshed gbrain evidence source_sha256 does not match the journal targetHash`,
    );
  }
  const recordedDigest = journal.gbrainEvidence?.sourceSha256;
  if (recordedDigest !== undefined && gbrainEvidence.sourceSha256 !== recordedDigest) {
    throw new Error(
      `ingest ${id}: refreshed gbrain evidence source_sha256 does not match the recorded gbrain checkpoint`,
    );
  }

  const block = (reason: string): CompleteResult => {
    const blocked = failedJournal(journal, "index", reason);
    try {
      write(root, blocked);
    } catch {
      // Keep the original durable state; the next command reports the same issue.
    }
    return { kind: "blocked", journal: blocked, error: new Error(reason) };
  };

  if (!existsSync(journal.target)) {
    return block(`staged target is missing: ${journal.target}; source and journal were preserved`);
  }
  let targetHash: string;
  try {
    targetHash = sha256File(journal.target);
  } catch (error) {
    return block(`staged target is unreadable: ${(error as Error).message}`);
  }
  if (targetHash !== journal.targetHash) {
    return block(`staged target changed after begin (${journal.target}); both copies were preserved`);
  }

  try {
    verifyIndexLine(journal, ops);
  } catch (error) {
    return block((error as Error).message);
  }

  if (existsSync(journal.source)) {
    let sourceHash: string;
    try {
      sourceHash = sha256File(journal.source);
    } catch (error) {
      return block(`inbox source is unreadable: ${(error as Error).message}`);
    }
    if (sourceHash !== journal.sourceHash) {
      return block(`inbox source changed after begin (${journal.source}); both copies were preserved`);
    }
  } else if (!cleanupPending) {
    return block(`inbox source disappeared before verified cleanup (${journal.source}); target was preserved`);
  }

  let pending = journal;
  if (!cleanupPending) {
    pending = withStamp({
      ...journal,
      gbrainEvidence,
      status: "failed",
      failedStep: "committed",
      failureReason: "source cleanup pending",
    });
    try {
      write(root, pending);
    } catch (error) {
      throw new Error(
        `ingest ${id}: could not record cleanup-pending (journal is still index); retry ${completeRetryCommand(id)}: ${(error as Error).message}`,
      );
    }
  }

  if (existsSync(pending.source)) {
    try {
      ops.unlink(pending.source);
    } catch (error) {
      const reason = `source cleanup pending: ${(error as Error).message}`;
      const recorded = withStamp({ ...pending, failureReason: reason });
      try {
        write(root, recorded);
      } catch {
        // The pre-unlink cleanup-pending record is already durable.
      }
      return { kind: "cleanup-pending", journal: recorded, error: new Error((error as Error).message) };
    }
  }

  const committed = withStamp({
    ...pending,
    gbrainEvidence,
    status: "committed",
    failedStep: undefined,
    failureReason: undefined,
  });
  try {
    write(root, committed);
  } catch (error) {
    return { kind: "cleanup-pending", journal: pending, error: new Error((error as Error).message) };
  }
  return { kind: "committed", journal: committed };
}

export function failIngest(
  root: string,
  id: string,
  reason: string,
  ops: IngestFileOps,
): IngestJournalV2 {
  return withIngestMutationLock(root, () => failIngestImpl(root, id, reason, ops));
}

function failIngestImpl(
  root: string,
  id: string,
  reason: string,
  ops: IngestFileOps,
): IngestJournalV2 {
  const journal = readJournal(root, id);
  if (journal.status === "committed") throw new Error(`ingest ${id} is already committed`);
  if (isCleanupPending(journal)) {
    throw new Error(`ingest ${id}: source cleanup pending; run "${completeRetryCommand(id)}" first`);
  }
  if (journal.status === "failed") throw new Error(`ingest ${id} is already failed`);

  let failureReason = reason;
  if (journal.status === "staged") {
    const cleanup = safeUnlinkIfIdentity(journal.target, journal.targetHash, ops);
    if (cleanup.changed) {
      failureReason += "; staged target changed and was preserved alongside the inbox source";
    }
  }
  const failed = failedJournal(journal, journal.status as IngestStep, failureReason);
  writeJournal(root, failed);
  return failed;
}

export function rollbackIngest(root: string, id: string, ops: IngestFileOps): IngestJournalV2 {
  return withIngestMutationLock(root, () => rollbackIngestImpl(root, id, ops));
}

function rollbackIngestImpl(root: string, id: string, ops: IngestFileOps): IngestJournalV2 {
  const journal = readJournal(root, id);
  if (journal.status === "committed") throw new Error(`ingest ${id} is already committed`);
  if (isCleanupPending(journal)) {
    throw new Error(`ingest ${id}: source cleanup pending; run "${completeRetryCommand(id)}" first`);
  }
  if (journal.status === "failed") throw new Error(`ingest ${id} is already failed`);
  if (journal.status === "gbrain" || journal.status === "index") {
    throw new Error(`ingest ${id}: gbrain page already written; rollback would orphan it — continue or repair manually`);
  }

  const cleanup = safeUnlinkIfIdentity(journal.target, journal.targetHash, ops);
  const failed = failedJournal(
    journal,
    "staged",
    cleanup.changed
      ? "rollback refused: staged target changed; both copies were preserved"
      : "rolled back",
  );
  writeJournal(root, failed);
  return failed;
}

export function resumableJournals(root: string): IngestJournalV2[] {
  return readJournals(root).records.filter((journal) => {
    if (journal.status !== "staged" && journal.status !== "gbrain" && journal.status !== "index") return false;
    if (!existsSync(journal.source)) return false;
    try {
      return sha256File(journal.source) === journal.sourceHash;
    } catch {
      return false;
    }
  });
}
