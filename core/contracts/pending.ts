// core/contracts/pending.ts — typed pending write envelope contract.
//
// When a gbrain write conflicts with the serve lock (or otherwise fails to
// apply), the semantic skill stages the page as a PendingWriteEnvelopeV1 in
// `<filehub>/.jspace-logs/<id>.APPLY.json` instead of failing or silently
// dropping the write. A mechanical applier applies staged envelopes when the
// lock frees; repeated apply is idempotent (applied/acked/terminal_failed are
// skipped, and a get-dedupe avoids rewriting an identical page).
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

export const ENVELOPE_STATUSES = ["staged", "applied", "acked", "terminal_failed"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const ENVELOPE_EXT = ".APPLY.json";

export interface PendingWriteEnvelopeV1 {
  schema_version: 1;
  id: string; // uuid
  idempotencyKey: string; // sha256(content); repeat-apply dedupe
  producer: string; // asset-ingest | memory-writeback
  slug: string; // target gbrain slug
  content: string; // full page markdown (frontmatter + body)
  status: EnvelopeStatus;
  retryCount: number;
  createdAt: string;
  appliedAt?: string;
  error?: string;
}

export function decodePendingEnvelope(input: unknown): DecodeResult<PendingWriteEnvelopeV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("pending.root.type", "pending", "pending envelope must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "schema_version", "id", "idempotencyKey", "producer", "slug", "content",
    "status", "retryCount", "createdAt", "appliedAt", "error",
  ] as const;
  checkNoUnknownFields(input, FIELDS, "pending", "pending.unknown-field", issues);
  readVersion(issues, "pending.version.unsupported", "pending.version", input.schema_version, [1]);
  readUuid(issues, "pending.id.invalid", "pending.id", input.id);
  readRequiredString(input, "idempotencyKey", "pending", "pending.idempotencyKey.invalid", issues);
  readRequiredString(input, "producer", "pending", "pending.producer.invalid", issues);
  readRequiredString(input, "slug", "pending", "pending.slug.invalid", issues);
  readRequiredString(input, "content", "pending", "pending.content.invalid", issues);
  readRequiredString(input, "createdAt", "pending", "pending.createdAt.invalid", issues);
  readEnum(issues, "pending.status.invalid", "pending.status", input.status, ENVELOPE_STATUSES);
  if (typeof input.retryCount !== "number" || !Number.isInteger(input.retryCount) || input.retryCount < 0) {
    issues.add("pending.retryCount.invalid", "pending.retryCount", "retryCount must be a non-negative integer");
  }
  if (input.appliedAt !== undefined && typeof input.appliedAt !== "string") {
    issues.add("pending.appliedAt.invalid", "pending.appliedAt", "appliedAt must be a string");
  }
  if (input.error !== undefined && typeof input.error !== "string") {
    issues.add("pending.error.invalid", "pending.error", "error must be a string");
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    id: input.id as string,
    idempotencyKey: input.idempotencyKey as string,
    producer: input.producer as string,
    slug: input.slug as string,
    content: input.content as string,
    status: input.status as EnvelopeStatus,
    retryCount: input.retryCount as number,
    createdAt: input.createdAt as string,
    ...(input.appliedAt !== undefined ? { appliedAt: input.appliedAt as string } : {}),
    ...(input.error !== undefined ? { error: input.error as string } : {}),
  });
}
