// core/contracts/ingest.ts — typed ingest journal contract.
//
// One IngestJournalV1 per file being ingested into the file hub. It is the
// machine truth that drives recovery: after any step (stage-target / gbrain /
// index / commit) the journal records the highest mechanically-completed step,
// so an interruption resumes from the recorded step and a failure triggers the
// right compensation (no orphan files, no silent loss). The semantic skill
// drives the mechanical steps through the jspace CLI; it only supplies the plan
// (target path, slug, project id, index line) and the gbrain page content.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readEnum,
  readRequiredString,
  readUuid,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export const INGEST_STEPS = ["staged", "gbrain", "index", "committed"] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];
export type IngestStatus = IngestStep | "failed";

export interface IngestJournalV1 {
  schema_version: 1;
  id: string; // uuid
  source: string; // inbox file absolute path
  target: string; // staged target absolute path (inside the filehub)
  relPath: string; // filehub-relative target (portable pointer)
  slug: string; // gbrain slug assets/<projectId>/<semantic>
  projectId: string; // resolveProjectId result (registered id or derived)
  contentHash: string; // idempotency key: sha256 of source
  status: IngestStatus; // highest mechanically-completed step, or "failed"
  failedStep?: IngestStep;
  failureReason?: string;
  indexEntry?: string; // planned line for the project index.md
  createdAt: string;
  updatedAt: string;
}

export function decodeIngestJournal(input: unknown): DecodeResult<IngestJournalV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("ingest.root.type", "ingest", "ingest journal must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "schema_version", "id", "source", "target", "relPath", "slug", "projectId",
    "contentHash", "status", "failedStep", "failureReason", "indexEntry", "createdAt", "updatedAt",
  ] as const;
  checkNoUnknownFields(input, FIELDS, "ingest", "ingest.unknown-field", issues);
  readVersion(issues, "ingest.version.unsupported", "ingest.version", input.schema_version, [1]);
  const id = readRequiredString(input, "id", "ingest", "ingest.id.invalid", issues);
  readRequiredString(input, "source", "ingest", "ingest.source.invalid", issues);
  readRequiredString(input, "target", "ingest", "ingest.target.invalid", issues);
  readRequiredString(input, "relPath", "ingest", "ingest.relPath.invalid", issues);
  readRequiredString(input, "slug", "ingest", "ingest.slug.invalid", issues);
  readRequiredString(input, "projectId", "ingest", "ingest.projectId.invalid", issues);
  readRequiredString(input, "contentHash", "ingest", "ingest.contentHash.invalid", issues);
  readRequiredString(input, "createdAt", "ingest", "ingest.createdAt.invalid", issues);
  readRequiredString(input, "updatedAt", "ingest", "ingest.updatedAt.invalid", issues);
  const status = readRequiredString(input, "status", "ingest", "ingest.status.invalid", issues);
  if (status !== undefined) {
    readEnum(issues, "ingest.status.invalid", "ingest.status", status, [...INGEST_STEPS, "failed"]);
  }
  if (input.failedStep !== undefined) {
    readEnum(issues, "ingest.failedStep.invalid", "ingest.failedStep", input.failedStep, INGEST_STEPS);
  }
  if (input.failureReason !== undefined && typeof input.failureReason !== "string") {
    issues.add("ingest.failureReason.invalid", "ingest.failureReason", "failureReason must be a string");
  }
  if (input.indexEntry !== undefined && typeof input.indexEntry !== "string") {
    issues.add("ingest.indexEntry.invalid", "ingest.indexEntry", "indexEntry must be a string");
  }
  if (id !== undefined) readUuid(issues, "ingest.id.invalid", "ingest.id", id);
  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    id: id as string,
    source: input.source as string,
    target: input.target as string,
    relPath: input.relPath as string,
    slug: input.slug as string,
    projectId: input.projectId as string,
    contentHash: input.contentHash as string,
    status: status as IngestStatus,
    ...(input.failedStep !== undefined ? { failedStep: input.failedStep as IngestStep } : {}),
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason as string } : {}),
    ...(input.indexEntry !== undefined ? { indexEntry: input.indexEntry as string } : {}),
    createdAt: input.createdAt as string,
    updatedAt: input.updatedAt as string,
  });
}
