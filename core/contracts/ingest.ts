// core/contracts/ingest.ts — durable asset-ingest journal contract.
//
// A journal records the exact owner/path/slug/index plan and the evidence that
// proves each external checkpoint. `gbrain` and `index` are checkpoints, not
// claims supplied by the caller; a committed journal therefore carries verified
// evidence for both before the inbox source may be removed.
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
import { isAbsolutePath, portabilityIssues } from "./paths.ts";

export const INGEST_OWNER_KINDS = ["project", "area"] as const;
export type IngestOwnerKind = (typeof INGEST_OWNER_KINDS)[number];

export const INGEST_STATUSES = ["staged", "gbrain", "index", "committed", "failed"] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

export const INGEST_STEPS = ["staged", "gbrain", "index", "committed"] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface IngestGbrainEvidence {
  verifiedAt: string;
  /** Opaque CAS token from gbrain (currently a UUID string). */
  revision: string;
  contentHash: string;
  slug: string;
  ownerKind: IngestOwnerKind;
  ownerId: string;
  relPath: string;
  tags: string[];
}

export interface IngestIndexEvidence {
  verifiedAt: string;
  path: string;
  contentHash: string;
  line: string;
}

export interface IngestJournalV2 {
  schema_version: 2;
  id: string;
  source: string;
  target: string;
  relPath: string;
  ownerKind: IngestOwnerKind;
  ownerId: string;
  slug: string;
  indexPath: string;
  indexEntry: string;
  sourceHash: string;
  targetHash: string;
  status: IngestStatus;
  failedStep?: IngestStep;
  failureReason?: string;
  gbrainEvidence?: IngestGbrainEvidence;
  indexEvidence?: IngestIndexEvidence;
  createdAt: string;
  updatedAt: string;
}

/** Historical project-only journal. This shape is migration input only. */
export interface IngestJournalV1Legacy {
  schema_version: 1;
  id: string;
  source: string;
  target: string;
  relPath: string;
  slug: string;
  projectId: string;
  contentHash: string;
  status: IngestStatus;
  failedStep?: IngestStep;
  failureReason?: string;
  indexEntry?: string;
  createdAt: string;
  updatedAt: string;
}

/** Current journal type alias. Old schema-1 journals are migration input only. */
export type IngestJournal = IngestJournalV2;

function absolutePathIssue(value: string): string | null {
  if (!isAbsolutePath(value)) return "must be an absolute path";
  if (value.split(/[\\/]+/).some((segment) => segment === "." || segment === "..")) {
    return "must not contain . or .. segments";
  }
  return null;
}

function singleSegmentIssue(value: string): string | null {
  if (value.length === 0) return "must be a non-empty segment";
  if (value !== value.trim()) return "must not have leading or trailing whitespace";
  if (value === "." || value === "..") return "must not be . or ..";
  if (/[\\/]/.test(value)) return "must be one path segment";
  return null;
}

function portableRelativeIssue(value: string): string | null {
  const issues = portabilityIssues(value);
  if (issues.length > 0) return issues.join("; ");
  if (value.split("/").some((segment) => segment.length === 0)) {
    return "must not contain empty path segments";
  }
  return null;
}

function slugIssue(slug: string, ownerId: string): string | null {
  if (slug.includes("\\")) return "must use / separators";
  const segments = slug.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "must not contain empty, . or .. segments";
  }
  if (segments.length < 3 || segments[0] !== "assets" || segments[1] !== ownerId) {
    return `must begin with assets/${ownerId}/ and name a semantic page`;
  }
  return null;
}

function readSha256(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
  code: string,
  issues: IssueCollector,
): string | undefined {
  const value = readRequiredString(obj, key, prefix, code, issues);
  if (value !== undefined && !SHA256_PATTERN.test(value)) {
    issues.add(code, `${prefix}.${key}`, "must be a 64-character lowercase sha256 hex digest");
    return undefined;
  }
  return value;
}

function decodeGbrainEvidence(
  value: unknown,
  journal: Record<string, unknown>,
  issues: IssueCollector,
): IngestGbrainEvidence | undefined {
  const prefix = "ingest.gbrainEvidence";
  if (!isRecord(value)) {
    issues.add("ingest.gbrainEvidence.invalid", prefix, "gbrainEvidence must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(
    value,
    ["verifiedAt", "revision", "contentHash", "slug", "ownerKind", "ownerId", "relPath", "tags"],
    prefix,
    "ingest.gbrainEvidence.unknown-field",
    issues,
  );
  const verifiedAt = readRequiredString(value, "verifiedAt", prefix, "ingest.gbrainEvidence.verifiedAt.invalid", issues);
  const revision = readRequiredString(
    value,
    "revision",
    prefix,
    "ingest.gbrainEvidence.revision.invalid",
    issues,
  );
  const contentHash = readSha256(
    value,
    "contentHash",
    prefix,
    "ingest.gbrainEvidence.contentHash.invalid",
    issues,
  );
  const slug = readRequiredString(value, "slug", prefix, "ingest.gbrainEvidence.slug.invalid", issues);
  const ownerKind = readEnum(
    issues,
    "ingest.gbrainEvidence.ownerKind.invalid",
    `${prefix}.ownerKind`,
    value.ownerKind,
    INGEST_OWNER_KINDS,
  );
  const ownerId = readRequiredString(value, "ownerId", prefix, "ingest.gbrainEvidence.ownerId.invalid", issues);
  const relPath = readRequiredString(value, "relPath", prefix, "ingest.gbrainEvidence.relPath.invalid", issues);

  const tags: string[] = [];
  if (
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    !value.tags.every((tag) => typeof tag === "string" && tag.length > 0)
  ) {
    issues.add("ingest.gbrainEvidence.tags.invalid", `${prefix}.tags`, "tags must be a non-empty array of non-empty strings");
  } else {
    tags.push(...(value.tags as string[]));
    if (!tags.includes("asset")) {
      issues.add("ingest.gbrainEvidence.tags.asset", `${prefix}.tags`, "tags must include asset");
    }
  }

  if (ownerId !== undefined) {
    const ownerIssue = singleSegmentIssue(ownerId);
    if (ownerIssue !== null) issues.add("ingest.gbrainEvidence.ownerId.invalid", `${prefix}.ownerId`, ownerIssue);
  }
  if (relPath !== undefined) {
    const relIssue = portableRelativeIssue(relPath);
    if (relIssue !== null) issues.add("ingest.gbrainEvidence.relPath.invalid", `${prefix}.relPath`, relIssue);
  }
  if (slug !== undefined && ownerId !== undefined) {
    const pageIssue = slugIssue(slug, ownerId);
    if (pageIssue !== null) issues.add("ingest.gbrainEvidence.slug.invalid", `${prefix}.slug`, pageIssue);
  }

  if (journal.ownerKind !== undefined && ownerKind !== undefined && ownerKind !== journal.ownerKind) {
    issues.add("ingest.gbrainEvidence.ownerKind.mismatch", `${prefix}.ownerKind`, "must match the journal ownerKind");
  }
  if (journal.ownerId !== undefined && ownerId !== undefined && ownerId !== journal.ownerId) {
    issues.add("ingest.gbrainEvidence.ownerId.mismatch", `${prefix}.ownerId`, "must match the journal ownerId");
  }
  if (journal.relPath !== undefined && relPath !== undefined && relPath !== journal.relPath) {
    issues.add("ingest.gbrainEvidence.relPath.mismatch", `${prefix}.relPath`, "must match the journal relPath");
  }
  if (journal.slug !== undefined && slug !== undefined && slug !== journal.slug) {
    issues.add("ingest.gbrainEvidence.slug.mismatch", `${prefix}.slug`, "must match the journal slug");
  }

  if (issues.issues.length !== before) return undefined;
  return {
    verifiedAt: verifiedAt as string,
    revision: revision as string,
    contentHash: contentHash as string,
    slug: slug as string,
    ownerKind: ownerKind as IngestOwnerKind,
    ownerId: ownerId as string,
    relPath: relPath as string,
    tags,
  };
}

function decodeIndexEvidence(
  value: unknown,
  journal: Record<string, unknown>,
  issues: IssueCollector,
): IngestIndexEvidence | undefined {
  const prefix = "ingest.indexEvidence";
  if (!isRecord(value)) {
    issues.add("ingest.indexEvidence.invalid", prefix, "indexEvidence must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(
    value,
    ["verifiedAt", "path", "contentHash", "line"],
    prefix,
    "ingest.indexEvidence.unknown-field",
    issues,
  );
  const verifiedAt = readRequiredString(value, "verifiedAt", prefix, "ingest.indexEvidence.verifiedAt.invalid", issues);
  const path = readRequiredString(value, "path", prefix, "ingest.indexEvidence.path.invalid", issues);
  const contentHash = readSha256(value, "contentHash", prefix, "ingest.indexEvidence.contentHash.invalid", issues);
  const line = readRequiredString(value, "line", prefix, "ingest.indexEvidence.line.invalid", issues);

  if (path !== undefined) {
    const pathIssue = portableRelativeIssue(path);
    if (pathIssue !== null) issues.add("ingest.indexEvidence.path.invalid", `${prefix}.path`, pathIssue);
  }
  if (line !== undefined && /[\r\n]/.test(line)) {
    issues.add("ingest.indexEvidence.line.invalid", `${prefix}.line`, "line must be one physical line");
  }
  if (journal.indexPath !== undefined && path !== undefined && path !== journal.indexPath) {
    issues.add("ingest.indexEvidence.path.mismatch", `${prefix}.path`, "must match the journal indexPath");
  }
  if (journal.indexEntry !== undefined && line !== undefined && line !== journal.indexEntry) {
    issues.add("ingest.indexEvidence.line.mismatch", `${prefix}.line`, "must match the journal indexEntry");
  }

  if (issues.issues.length !== before) return undefined;
  return {
    verifiedAt: verifiedAt as string,
    path: path as string,
    contentHash: contentHash as string,
    line: line as string,
  };
}

export function decodeIngestJournal(input: unknown): DecodeResult<IngestJournalV2> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("ingest.root.type", "ingest", "ingest journal must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(
    input,
    [
      "schema_version",
      "id",
      "source",
      "target",
      "relPath",
      "ownerKind",
      "ownerId",
      "slug",
      "indexPath",
      "indexEntry",
      "sourceHash",
      "targetHash",
      "status",
      "failedStep",
      "failureReason",
      "gbrainEvidence",
      "indexEvidence",
      "createdAt",
      "updatedAt",
    ],
    "ingest",
    "ingest.unknown-field",
    issues,
  );
  readVersion(issues, "ingest.version.unsupported", "ingest.schema_version", input.schema_version, [2]);
  readUuid(issues, "ingest.id.invalid", "ingest.id", input.id);

  const source = readRequiredString(input, "source", "ingest", "ingest.source.invalid", issues);
  const target = readRequiredString(input, "target", "ingest", "ingest.target.invalid", issues);
  const relPath = readRequiredString(input, "relPath", "ingest", "ingest.relPath.invalid", issues);
  const ownerKind = readEnum(issues, "ingest.ownerKind.invalid", "ingest.ownerKind", input.ownerKind, INGEST_OWNER_KINDS);
  const ownerId = readRequiredString(input, "ownerId", "ingest", "ingest.ownerId.invalid", issues);
  const slug = readRequiredString(input, "slug", "ingest", "ingest.slug.invalid", issues);
  const indexPath = readRequiredString(input, "indexPath", "ingest", "ingest.indexPath.invalid", issues);
  const indexEntry = readRequiredString(input, "indexEntry", "ingest", "ingest.indexEntry.invalid", issues);
  const sourceHash = readSha256(input, "sourceHash", "ingest", "ingest.sourceHash.invalid", issues);
  const targetHash = readSha256(input, "targetHash", "ingest", "ingest.targetHash.invalid", issues);
  const status = readEnum(issues, "ingest.status.invalid", "ingest.status", input.status, INGEST_STATUSES);
  const failedStep =
    input.failedStep === undefined
      ? undefined
      : readEnum(issues, "ingest.failedStep.invalid", "ingest.failedStep", input.failedStep, INGEST_STEPS);
  const failureReason =
    input.failureReason === undefined
      ? undefined
      : readRequiredString(input, "failureReason", "ingest", "ingest.failureReason.invalid", issues);
  const createdAt = readRequiredString(input, "createdAt", "ingest", "ingest.createdAt.invalid", issues);
  const updatedAt = readRequiredString(input, "updatedAt", "ingest", "ingest.updatedAt.invalid", issues);

  if (source !== undefined) {
    const issue = absolutePathIssue(source);
    if (issue !== null) issues.add("ingest.source.invalid", "ingest.source", issue);
  }
  if (target !== undefined) {
    const issue = absolutePathIssue(target);
    if (issue !== null) issues.add("ingest.target.invalid", "ingest.target", issue);
  }
  if (relPath !== undefined) {
    const issue = portableRelativeIssue(relPath);
    if (issue !== null) issues.add("ingest.relPath.invalid", "ingest.relPath", issue);
  }
  if (indexPath !== undefined) {
    const issue = portableRelativeIssue(indexPath);
    if (issue !== null) issues.add("ingest.indexPath.invalid", "ingest.indexPath", issue);
  }
  if (indexEntry !== undefined && /[\r\n]/.test(indexEntry)) {
    issues.add("ingest.indexEntry.invalid", "ingest.indexEntry", "must be one physical line");
  }
  if (ownerId !== undefined) {
    const issue = singleSegmentIssue(ownerId);
    if (issue !== null) issues.add("ingest.ownerId.invalid", "ingest.ownerId", issue);
  }
  if (slug !== undefined && ownerId !== undefined) {
    const issue = slugIssue(slug, ownerId);
    if (issue !== null) issues.add("ingest.slug.invalid", "ingest.slug", issue);
  }
  if (sourceHash !== undefined && targetHash !== undefined && sourceHash !== targetHash) {
    issues.add(
      "ingest.hashes.mismatch",
      "ingest.targetHash",
      "sourceHash and targetHash must match: ingest stages an exact copy",
    );
  }

  if (status === "failed") {
    if (failedStep === undefined) {
      issues.add("ingest.failedStep.required", "ingest.failedStep", "failed journal requires failedStep");
    }
    if (failureReason === undefined) {
      issues.add("ingest.failureReason.required", "ingest.failureReason", "failed journal requires failureReason");
    }
  } else if (status !== undefined) {
    if (failedStep !== undefined) {
      issues.add("ingest.failedStep.unexpected", "ingest.failedStep", "non-failed journal must not carry failedStep");
    }
    if (failureReason !== undefined) {
      issues.add("ingest.failureReason.unexpected", "ingest.failureReason", "non-failed journal must not carry failureReason");
    }
  }

  const gbrainEvidence =
    input.gbrainEvidence === undefined ? undefined : decodeGbrainEvidence(input.gbrainEvidence, input, issues);
  const indexEvidence =
    input.indexEvidence === undefined ? undefined : decodeIndexEvidence(input.indexEvidence, input, issues);

  if (status === "gbrain" && gbrainEvidence === undefined) {
    issues.add("ingest.gbrainEvidence.required", "ingest.gbrainEvidence", "gbrain checkpoint requires verified evidence");
  }
  if ((status === "index" || status === "committed") && gbrainEvidence === undefined) {
    issues.add("ingest.gbrainEvidence.required", "ingest.gbrainEvidence", `${status} journal requires verified gbrain evidence`);
  }
  if ((status === "index" || status === "committed") && indexEvidence === undefined) {
    issues.add("ingest.indexEvidence.required", "ingest.indexEvidence", `${status} journal requires verified index evidence`);
  }
  if (status === "staged" && gbrainEvidence !== undefined) {
    issues.add("ingest.gbrainEvidence.unexpected", "ingest.gbrainEvidence", "staged journal must not carry gbrain evidence");
  }

  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 2,
    id: input.id as string,
    source: source as string,
    target: target as string,
    relPath: relPath as string,
    ownerKind: ownerKind as IngestOwnerKind,
    ownerId: ownerId as string,
    slug: slug as string,
    indexPath: indexPath as string,
    indexEntry: indexEntry as string,
    sourceHash: sourceHash as string,
    targetHash: targetHash as string,
    status: status as IngestStatus,
    ...(failedStep !== undefined ? { failedStep } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
    ...(gbrainEvidence !== undefined ? { gbrainEvidence } : {}),
    ...(indexEvidence !== undefined ? { indexEvidence } : {}),
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  });
}

/** Strict decoder for the one-time schema-1 migration. It deliberately does not
 *  relax the current v2 checkpoint/evidence rules; the migration maps an old
 *  checkpoint without verifiable evidence to a blocked journal instead. */
export function decodeLegacyIngestJournal(
  input: unknown,
): DecodeResult<IngestJournalV1Legacy> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("ingest.root.type", "ingest", "ingest journal must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(
    input,
    [
      "schema_version",
      "id",
      "source",
      "target",
      "relPath",
      "slug",
      "projectId",
      "contentHash",
      "status",
      "failedStep",
      "failureReason",
      "indexEntry",
      "createdAt",
      "updatedAt",
    ],
    "ingest",
    "ingest.unknown-field",
    issues,
  );
  readVersion(issues, "ingest.version.unsupported", "ingest.schema_version", input.schema_version, [1]);
  readUuid(issues, "ingest.id.invalid", "ingest.id", input.id);
  const source = readRequiredString(input, "source", "ingest", "ingest.source.invalid", issues);
  const target = readRequiredString(input, "target", "ingest", "ingest.target.invalid", issues);
  const relPath = readRequiredString(input, "relPath", "ingest", "ingest.relPath.invalid", issues);
  const slug = readRequiredString(input, "slug", "ingest", "ingest.slug.invalid", issues);
  const projectId = readRequiredString(input, "projectId", "ingest", "ingest.projectId.invalid", issues);
  const contentHash = readRequiredString(input, "contentHash", "ingest", "ingest.contentHash.invalid", issues);
  const status = readEnum(issues, "ingest.status.invalid", "ingest.status", input.status, INGEST_STATUSES);
  const failedStep =
    input.failedStep === undefined
      ? undefined
      : readEnum(issues, "ingest.failedStep.invalid", "ingest.failedStep", input.failedStep, INGEST_STEPS);
  const failureReason =
    input.failureReason === undefined
      ? undefined
      : readRequiredString(input, "failureReason", "ingest", "ingest.failureReason.invalid", issues);
  const indexEntry =
    input.indexEntry === undefined
      ? undefined
      : readRequiredString(input, "indexEntry", "ingest", "ingest.indexEntry.invalid", issues);
  const createdAt = readRequiredString(input, "createdAt", "ingest", "ingest.createdAt.invalid", issues);
  const updatedAt = readRequiredString(input, "updatedAt", "ingest", "ingest.updatedAt.invalid", issues);

  if (source !== undefined) {
    const issue = absolutePathIssue(source);
    if (issue !== null) issues.add("ingest.source.invalid", "ingest.source", issue);
  }
  if (target !== undefined) {
    const issue = absolutePathIssue(target);
    if (issue !== null) issues.add("ingest.target.invalid", "ingest.target", issue);
  }
  if (relPath !== undefined) {
    const issue = portableRelativeIssue(relPath);
    if (issue !== null) issues.add("ingest.relPath.invalid", "ingest.relPath", issue);
  }
  if (projectId !== undefined) {
    const issue = singleSegmentIssue(projectId);
    if (issue !== null) issues.add("ingest.projectId.invalid", "ingest.projectId", issue);
  }
  if (indexEntry !== undefined && /[\r\n]/.test(indexEntry)) {
    issues.add("ingest.indexEntry.invalid", "ingest.indexEntry", "must be one physical line");
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    id: input.id as string,
    source: source as string,
    target: target as string,
    relPath: relPath as string,
    slug: slug as string,
    projectId: projectId as string,
    contentHash: contentHash as string,
    status: status as IngestStatus,
    ...(failedStep !== undefined ? { failedStep } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
    ...(indexEntry !== undefined ? { indexEntry } : {}),
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  });
}
