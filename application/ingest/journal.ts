// application/ingest/journal.ts — ingest journal repository + state machine +
// compensation. Machine truth for asset-ingest recovery (Child E, F4): a file's
// source stays in the inbox until `--complete` removes it, and a failure before
// the gbrain page is written compensates by removing the staged target copy, so
// no orphan file exists and nothing is silently lost.
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import {
  decodeIngestJournal,
  INGEST_STEPS,
  type IngestJournalV1,
  type IngestStep,
  type IngestStatus,
} from "../../core/contracts/ingest.ts";
import { sha256Of } from "../workspace/manifest.ts";

export const INGEST_STATE_DIR = join(CONFIG_DIR, "state", "ingest");

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
  | { kind: "resume"; journal: IngestJournalV1 };

function dir(root: string): string {
  return join(root, INGEST_STATE_DIR);
}

function now(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

export function writeJournal(root: string, j: IngestJournalV1): void {
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(dir(root), `${j.id}.json`), JSON.stringify(j, null, 2) + "\n", "utf-8");
}

export function readJournals(root: string): IngestJournalV1[] {
  let names: string[];
  try {
    names = readdirSync(dir(root));
  } catch {
    return [];
  }
  const out: IngestJournalV1[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const decoded = decodeIngestJournal(JSON.parse(readFileSync(join(dir(root), n), "utf-8")));
      if (decoded.ok) out.push(decoded.value);
    } catch {
      /* skip corrupt journal */
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function readJournal(root: string, id: string): IngestJournalV1 {
  const j = readJournals(root).find((x) => x.id === id);
  if (!j) throw new Error(`no ingest journal: ${id}`);
  return j;
}

const NEXT_STEP: Record<IngestStep, IngestStep | undefined> = {
  staged: "gbrain",
  gbrain: "index",
  index: "committed",
  committed: undefined,
};

function withStamp(j: IngestJournalV1): IngestJournalV1 {
  return { ...j, updatedAt: now() };
}

/** Start an ingest: hash source for idempotency, stage a target copy (source
 *  stays in inbox), record journal=staged. Duplicate (same source already
 *  committed, or same content+target) and in-progress resumes are returned
 *  without re-staging. A missing source is a hard error unless it is already
 *  recorded as committed (source removed after commit). */
export function beginIngest(root: string, plan: IngestPlan, ops: IngestFileOps): BeginResult {
  const journals = readJournals(root);
  // source already ingested and committed (source may be gone after commit)
  const dupBySource = journals.find((j) => j.status === "committed" && j.source === plan.source);
  if (dupBySource) return { kind: "duplicate", journal: dupBySource };

  let contentHash = "";
  if (existsSync(plan.source)) {
    contentHash = sha256Of(readFileSync(plan.source, "utf-8"));
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
    version: 1,
    id: crypto.randomUUID(),
    source: plan.source,
    target: plan.target,
    relPath: plan.relPath,
    slug: plan.slug,
    projectId: plan.projectId,
    contentHash,
    status: "staged",
    ...(plan.indexEntry !== undefined ? { indexEntry: plan.indexEntry } : {}),
    createdAt: now(),
    updatedAt: now(),
  };
  writeJournal(root, journal);
  return { kind: "created", journal };
}

/** Advance to a later step. `complete` mechanically removes the inbox source. */
export function advanceIngest(root: string, id: string, step: IngestStep, ops: IngestFileOps): IngestJournalV1 {
  const j = readJournal(root, id);
  const stepIndex = INGEST_STEPS.indexOf(step);
  const currentIndex = INGEST_STEPS.indexOf(j.status as IngestStep);
  if (j.status === "failed") throw new Error(`ingest ${id} is failed; retry or rollback first`);
  if (stepIndex !== currentIndex + 1) {
    throw new Error(`ingest ${id}: cannot advance to ${step} from ${j.status}`);
  }
  if (step === "committed") {
    ops.unlink(j.source); // source removed only at commit; target copy is authoritative
  }
  const updated = withStamp({ ...j, status: step });
  writeJournal(root, updated);
  return updated;
}

/** Mark an ingest failed and apply the compensation for the step in progress.
 *  staged (gbrain never written) -> remove the staged target copy, source stays
 *  in inbox (no orphan). gbrain/index -> page already exists; no destructive
 *  compensation (index/commit remain retryable). */
export function failIngest(root: string, id: string, reason: string, ops: IngestFileOps): IngestJournalV1 {
  const j = readJournal(root, id);
  if (j.status === "committed") throw new Error(`ingest ${id} is already committed`);
  if (j.status === "staged") {
    // gbrain page was never written: remove the staged copy, keep source in inbox.
    ops.unlink(j.target);
  }
  const failedStep = NEXT_STEP[j.status as IngestStep]; // the step that was in progress
  const updated = withStamp({
    ...j,
    status: "failed" as IngestStatus,
    failedStep,
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
  return readJournals(root).filter(
    (j) => (j.status === "staged" || j.status === "gbrain" || j.status === "index") && existsSync(j.source),
  );
}
