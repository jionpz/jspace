// core/contracts/pending.ts — typed deferred gbrain write contract.
//
// Pending envelopes live under the workbench at
// `.jspace/state/pending/<id>.APPLY.json`. They retain the exact intent and
// request identity needed for a safe retry after a lock conflict or lost
// response. They are staged work, never proof that a page was written.
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
import type { GbrainContentOrigin } from "./gbrain.ts";

export const ENVELOPE_STATUSES = ["staged", "applied", "acked", "terminal_failed"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const PENDING_INTENTS = ["create", "replace"] as const;
export type PendingIntent = (typeof PENDING_INTENTS)[number];

export const CONTENT_ORIGINS = ["user_said", "tool_output", "inferred"] as const;
export const ENVELOPE_EXT = ".APPLY.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface PendingWriteEnvelopeV2 {
  schema_version: 2;
  id: string;
  requestId: string;
  intent: PendingIntent;
  expectedRevision?: string;
  contentHash: string;
  contentOrigin: GbrainContentOrigin;
  sourceId: string;
  producer: string;
  slug: string;
  content: string;
  status: EnvelopeStatus;
  retryCount: number;
  createdAt: string;
  appliedAt?: string;
  committedRevision?: string;
  error?: string;
}

/** Historical filehub envelopes. This decoder exists only for the explicit
 *  workspace-upgrade migration; normal pending reads accept schema 2 only. */
export interface LegacyPendingWriteEnvelopeV1 {
  schema_version: 1;
  id: string;
  idempotencyKey: string;
  producer: string;
  slug: string;
  content: string;
  status: EnvelopeStatus;
  retryCount: number;
  createdAt: string;
  appliedAt?: string;
  error?: string;
}

/** Current envelope type alias. */
export type PendingWriteEnvelope = PendingWriteEnvelopeV2;

export function decodePendingEnvelope(input: unknown): DecodeResult<PendingWriteEnvelopeV2> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("pending.root.type", "pending", "pending envelope must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "schema_version",
    "id",
    "requestId",
    "intent",
    "expectedRevision",
    "contentHash",
    "contentOrigin",
    "sourceId",
    "producer",
    "slug",
    "content",
    "status",
    "retryCount",
    "createdAt",
    "appliedAt",
    "committedRevision",
    "error",
  ] as const;
  checkNoUnknownFields(input, FIELDS, "pending", "pending.unknown-field", issues);
  readVersion(issues, "pending.version.unsupported", "pending.version", input.schema_version, [2]);
  readUuid(issues, "pending.id.invalid", "pending.id", input.id);
  readUuid(issues, "pending.requestId.invalid", "pending.requestId", input.requestId);
  readEnum(issues, "pending.intent.invalid", "pending.intent", input.intent, PENDING_INTENTS);
  const contentHash = readRequiredString(input, "contentHash", "pending", "pending.contentHash.invalid", issues);
  if (contentHash !== undefined && !SHA256_PATTERN.test(contentHash)) {
    issues.add(
      "pending.contentHash.invalid",
      "pending.contentHash",
      "must be a 64-character lowercase sha256 hex digest",
    );
  }
  readEnum(issues, "pending.contentOrigin.invalid", "pending.contentOrigin", input.contentOrigin, CONTENT_ORIGINS);
  readRequiredString(input, "sourceId", "pending", "pending.sourceId.invalid", issues);
  readRequiredString(input, "producer", "pending", "pending.producer.invalid", issues);
  readRequiredString(input, "slug", "pending", "pending.slug.invalid", issues);
  readRequiredString(input, "content", "pending", "pending.content.invalid", issues);
  readRequiredString(input, "createdAt", "pending", "pending.createdAt.invalid", issues);
  readEnum(issues, "pending.status.invalid", "pending.status", input.status, ENVELOPE_STATUSES);
  if (input.intent === "replace" && input.expectedRevision === undefined) {
    issues.add("pending.expectedRevision.required", "pending.expectedRevision", "replace intent requires expectedRevision");
  }
  if (
    input.expectedRevision !== undefined &&
    (typeof input.expectedRevision !== "string" || input.expectedRevision.trim() === "")
  ) {
    issues.add("pending.expectedRevision.invalid", "pending.expectedRevision", "expectedRevision must be a non-empty opaque string");
  }
  if (input.intent === "create" && input.expectedRevision !== undefined) {
    issues.add("pending.expectedRevision.create", "pending.expectedRevision", "create intent must not carry expectedRevision");
  }
  if (typeof input.retryCount !== "number" || !Number.isInteger(input.retryCount) || input.retryCount < 0) {
    issues.add("pending.retryCount.invalid", "pending.retryCount", "retryCount must be a non-negative integer");
  }
  if (input.appliedAt !== undefined && typeof input.appliedAt !== "string") {
    issues.add("pending.appliedAt.invalid", "pending.appliedAt", "appliedAt must be a string");
  }
  if (
    input.committedRevision !== undefined &&
    (typeof input.committedRevision !== "string" || input.committedRevision.trim() === "")
  ) {
    issues.add("pending.committedRevision.invalid", "pending.committedRevision", "committedRevision must be a non-empty opaque string");
  }
  if (input.error !== undefined && typeof input.error !== "string") {
    issues.add("pending.error.invalid", "pending.error", "error must be a string");
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 2,
    id: input.id as string,
    requestId: input.requestId as string,
    intent: input.intent as PendingIntent,
    ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision as string } : {}),
    contentHash: contentHash as string,
    contentOrigin: input.contentOrigin as GbrainContentOrigin,
    sourceId: input.sourceId as string,
    producer: input.producer as string,
    slug: input.slug as string,
    content: input.content as string,
    status: input.status as EnvelopeStatus,
    retryCount: input.retryCount as number,
    createdAt: input.createdAt as string,
    ...(input.appliedAt !== undefined ? { appliedAt: input.appliedAt as string } : {}),
    ...(input.committedRevision !== undefined ? { committedRevision: input.committedRevision as string } : {}),
    ...(input.error !== undefined ? { error: input.error as string } : {}),
  });
}

export function decodeLegacyPendingEnvelope(
  input: unknown,
): DecodeResult<LegacyPendingWriteEnvelopeV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("pending.root.type", "pending", "pending envelope must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "schema_version",
    "id",
    "idempotencyKey",
    "producer",
    "slug",
    "content",
    "status",
    "retryCount",
    "createdAt",
    "appliedAt",
    "error",
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
