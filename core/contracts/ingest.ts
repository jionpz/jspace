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

/** Schema-3 bundle journals have an explicit pre-copy `copying` state. */
export const INGEST_BUNDLE_STATUSES = [
  "copying",
  "staged",
  "gbrain",
  "index",
  "committed",
  "failed",
] as const;
export type IngestBundleStatus = (typeof INGEST_BUNDLE_STATUSES)[number];

export const INGEST_BUNDLE_STEPS = ["copying", "staged", "gbrain", "index", "committed"] as const;
export type IngestBundleStep = (typeof INGEST_BUNDLE_STEPS)[number];

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
  /** Optional page-declared digest of the archived source bytes (`source_sha256`).
   *  When present it must equal the journal targetHash; older pages may omit it. */
  sourceSha256?: string;
}

export interface IngestIndexEvidence {
  verifiedAt: string;
  path: string;
  contentHash: string;
  line: string;
}

export interface IngestBundleOperation {
  /** Fencing token owned by the copier that last left `copying`. */
  token: string;
  pid: number;
}

/** Bundle page readback adds the flat bundle scalars; entry digest identity is
 *  still `sourceSha256` and the whole-tree identity is `bundleSha256`. */
export interface IngestBundleGbrainEvidence extends IngestGbrainEvidence {
  assetKind: "bundle";
  bundleRoot: string;
  bundleManifest: string;
  bundleSha256: string;
  bundleManifestSha256: string;
}

export interface IngestBundleJournalV3 {
  schema_version: 3;
  kind: "bundle";
  id: string;
  /** Inbox directory (retained after commit). */
  source: string;
  /** Bundle directory under the owner root. */
  target: string;
  /** Bundle-relative entry file, also the asset page/index target. */
  relPath: string;
  ownerKind: IngestOwnerKind;
  ownerId: string;
  slug: string;
  indexPath: string;
  indexEntry: string;
  sourcePolicy: "retain";
  manifestRelPath: string;
  manifestSha256: string;
  aggregateSha256: string;
  sourceHash: string;
  targetHash?: string;
  status: IngestBundleStatus;
  operation?: IngestBundleOperation;
  failedStep?: IngestBundleStep;
  failureReason?: string;
  gbrainEvidence?: IngestBundleGbrainEvidence;
  indexEvidence?: IngestIndexEvidence;
  createdAt: string;
  updatedAt: string;
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

/** Every runtime-readable journal record. Schema-1 journals are migration
 *  input only and are never surfaced as a completed runtime record. */
export type IngestJournal = IngestJournalV2 | IngestBundleJournalV3;

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

function bundleSlugIssue(slug: string, ownerId: string): string | null {
  if (slug.includes("\\")) return "must use / separators";
  const segments = slug.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "must not contain empty, . or .. segments";
  }
  if (segments.length !== 3 || segments[0] !== "assets" || segments[1] !== ownerId) {
    return `must match assets/${ownerId}/<semantic>`;
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

function readOptionalSha256(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
  code: string,
  issues: IssueCollector,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    issues.add(code, `${prefix}.${key}`, "must be a 64-character lowercase sha256 hex digest");
    return undefined;
  }
  return value;
}

function decodeGbrainEvidence(
  value: unknown,
  journal: Record<string, unknown>,
  issues: IssueCollector,
  bundle: boolean,
): IngestGbrainEvidence | IngestBundleGbrainEvidence | undefined {
  const prefix = "ingest.gbrainEvidence";
  if (!isRecord(value)) {
    issues.add("ingest.gbrainEvidence.invalid", prefix, "gbrainEvidence must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(
    value,
    [
      "verifiedAt",
      "revision",
      "contentHash",
      "slug",
      "ownerKind",
      "ownerId",
      "relPath",
      "tags",
      "sourceSha256",
      ...(bundle
        ? ["assetKind", "bundleRoot", "bundleManifest", "bundleSha256", "bundleManifestSha256"]
        : []),
    ],
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
  const sourceSha256 = readOptionalSha256(
    value,
    "sourceSha256",
    prefix,
    "ingest.gbrainEvidence.sourceSha256.invalid",
    issues,
  );

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
  if (
    sourceSha256 !== undefined &&
    typeof journal.targetHash === "string" &&
    sourceSha256 !== journal.targetHash
  ) {
    issues.add(
      "ingest.gbrainEvidence.sourceSha256.mismatch",
      `${prefix}.sourceSha256`,
      "must match the journal targetHash",
    );
  }

  let bundleFields:
    | Pick<IngestBundleGbrainEvidence, "assetKind" | "bundleRoot" | "bundleManifest" | "bundleSha256" | "bundleManifestSha256">
    | undefined;
  if (bundle) {
    if (value.assetKind !== "bundle") {
      issues.add("ingest.gbrainEvidence.assetKind", `${prefix}.assetKind`, "must be bundle");
    }
    const bundleRoot = readRequiredString(
      value,
      "bundleRoot",
      prefix,
      "ingest.gbrainEvidence.bundleRoot",
      issues,
    );
    const bundleManifest = readRequiredString(
      value,
      "bundleManifest",
      prefix,
      "ingest.gbrainEvidence.bundleManifest",
      issues,
    );
    const bundleSha256 = readSha256(
      value,
      "bundleSha256",
      prefix,
      "ingest.gbrainEvidence.bundleSha256",
      issues,
    );
    const bundleManifestSha256 = readSha256(
      value,
      "bundleManifestSha256",
      prefix,
      "ingest.gbrainEvidence.bundleManifestSha256",
      issues,
    );
    if (bundleRoot !== undefined) {
      const issue = portableRelativeIssue(bundleRoot);
      if (issue !== null) issues.add("ingest.gbrainEvidence.bundleRoot", `${prefix}.bundleRoot`, issue);
    }
    if (bundleManifest !== undefined) {
      const issue = portableRelativeIssue(bundleManifest);
      if (issue !== null) issues.add("ingest.gbrainEvidence.bundleManifest", `${prefix}.bundleManifest`, issue);
      if (typeof journal.manifestRelPath === "string" && bundleManifest !== journal.manifestRelPath) {
        issues.add(
          "ingest.gbrainEvidence.bundleManifest.mismatch",
          `${prefix}.bundleManifest`,
          "must match the journal manifestRelPath",
        );
      }
    }
    if (typeof journal.aggregateSha256 === "string" && bundleSha256 !== undefined && bundleSha256 !== journal.aggregateSha256) {
      issues.add(
        "ingest.gbrainEvidence.bundleSha256.mismatch",
        `${prefix}.bundleSha256`,
        "must match the journal aggregateSha256",
      );
    }
    if (typeof journal.manifestSha256 === "string" && bundleManifestSha256 !== undefined && bundleManifestSha256 !== journal.manifestSha256) {
      issues.add(
        "ingest.gbrainEvidence.bundleManifestSha256.mismatch",
        `${prefix}.bundleManifestSha256`,
        "must match the journal manifestSha256",
      );
    }
    bundleFields = {
      assetKind: "bundle",
      bundleRoot: bundleRoot as string,
      bundleManifest: bundleManifest as string,
      bundleSha256: bundleSha256 as string,
      bundleManifestSha256: bundleManifestSha256 as string,
    };
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
    ...(sourceSha256 !== undefined ? { sourceSha256 } : {}),
    ...(bundleFields ?? {}),
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
    input.gbrainEvidence === undefined
      ? undefined
      : decodeGbrainEvidence(input.gbrainEvidence, input, issues, false);
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

/** Strict schema-3 bundle journal decoder. v2 journals stay on their original
 *  decoder; neither shape accepts the other's fields. */
export function decodeIngestBundleJournal(input: unknown): DecodeResult<IngestBundleJournalV3> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("ingest.root.type", "ingest", "ingest journal must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(
    input,
    [
      "schema_version",
      "kind",
      "id",
      "source",
      "target",
      "relPath",
      "ownerKind",
      "ownerId",
      "slug",
      "indexPath",
      "indexEntry",
      "sourcePolicy",
      "manifestRelPath",
      "manifestSha256",
      "aggregateSha256",
      "sourceHash",
      "targetHash",
      "status",
      "operation",
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
  readVersion(issues, "ingest.version.unsupported", "ingest.schema_version", input.schema_version, [3]);
  if (input.kind !== "bundle") {
    issues.add("ingest.kind.invalid", "ingest.kind", "schema-3 journals must declare kind bundle");
  }
  readUuid(issues, "ingest.id.invalid", "ingest.id", input.id);

  const source = readRequiredString(input, "source", "ingest", "ingest.source.invalid", issues);
  const target = readRequiredString(input, "target", "ingest", "ingest.target.invalid", issues);
  const relPath = readRequiredString(input, "relPath", "ingest", "ingest.relPath.invalid", issues);
  const ownerKind = readEnum(
    issues,
    "ingest.ownerKind.invalid",
    "ingest.ownerKind",
    input.ownerKind,
    INGEST_OWNER_KINDS,
  );
  const ownerId = readRequiredString(input, "ownerId", "ingest", "ingest.ownerId.invalid", issues);
  const slug = readRequiredString(input, "slug", "ingest", "ingest.slug.invalid", issues);
  const indexPath = readRequiredString(input, "indexPath", "ingest", "ingest.indexPath.invalid", issues);
  const indexEntry = readRequiredString(input, "indexEntry", "ingest", "ingest.indexEntry.invalid", issues);
  const sourcePolicy = input.sourcePolicy;
  if (sourcePolicy !== "retain") {
    issues.add("ingest.sourcePolicy.invalid", "ingest.sourcePolicy", "bundle journals must retain the inbox source");
  }
  const manifestRelPath = readRequiredString(
    input,
    "manifestRelPath",
    "ingest",
    "ingest.manifestRelPath.invalid",
    issues,
  );
  const manifestSha256 = readSha256(
    input,
    "manifestSha256",
    "ingest",
    "ingest.manifestSha256.invalid",
    issues,
  );
  const aggregateSha256 = readSha256(
    input,
    "aggregateSha256",
    "ingest",
    "ingest.aggregateSha256.invalid",
    issues,
  );
  const sourceHash = readSha256(input, "sourceHash", "ingest", "ingest.sourceHash.invalid", issues);
  const targetHash = readOptionalSha256(
    input,
    "targetHash",
    "ingest",
    "ingest.targetHash.invalid",
    issues,
  );
  const status = readEnum(
    issues,
    "ingest.status.invalid",
    "ingest.status",
    input.status,
    INGEST_BUNDLE_STATUSES,
  );
  const failedStep =
    input.failedStep === undefined
      ? undefined
      : readEnum(
          issues,
          "ingest.failedStep.invalid",
          "ingest.failedStep",
          input.failedStep,
          INGEST_BUNDLE_STEPS,
        );
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
    const issue = bundleSlugIssue(slug, ownerId);
    if (issue !== null) issues.add("ingest.slug.invalid", "ingest.slug", issue);
  }
  if (manifestRelPath !== undefined) {
    const issue = portableRelativeIssue(manifestRelPath);
    if (issue !== null) issues.add("ingest.manifestRelPath.invalid", "ingest.manifestRelPath", issue);
    if (!manifestRelPath.endsWith(".json")) {
      issues.add("ingest.manifestRelPath.invalid", "ingest.manifestRelPath", "must be a .json manifest path");
    }
    if (target !== undefined) {
      const targetRel = target.replace(/\\/g, "/");
      const normalized = manifestRelPath.replace(/\\/g, "/");
      if (
        normalized === targetRel ||
        normalized.startsWith(`${targetRel.replace(/\/+$/, "")}/`)
      ) {
        issues.add(
          "ingest.manifestRelPath.invalid",
          "ingest.manifestRelPath",
          "manifest must live outside the bundle root",
        );
      }
    }
  }
  if (sourceHash !== undefined && targetHash !== undefined && sourceHash !== targetHash) {
    issues.add(
      "ingest.hashes.mismatch",
      "ingest.targetHash",
      "entry sourceHash and targetHash must match: the entry file is copied byte-for-byte",
    );
  }

  let operation: IngestBundleOperation | undefined;
  if (input.operation !== undefined) {
    if (!isRecord(input.operation)) {
      issues.add("ingest.operation.invalid", "ingest.operation", "operation must be an object");
    } else {
      const opPrefix = "ingest.operation";
      checkNoUnknownFields(
        input.operation,
        ["token", "pid"],
        opPrefix,
        "ingest.operation.unknown-field",
        issues,
      );
      const token = readRequiredString(
        input.operation,
        "token",
        opPrefix,
        "ingest.operation.token.invalid",
        issues,
      );
      const pid = input.operation.pid;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
        issues.add("ingest.operation.pid.invalid", `${opPrefix}.pid`, "pid must be a positive integer");
      }
      if (token !== undefined && typeof pid === "number") {
        operation = { token, pid };
      }
    }
  }

  const gbrainEvidence =
    input.gbrainEvidence === undefined
      ? undefined
      : decodeGbrainEvidence(input.gbrainEvidence, input, issues, true);
  const indexEvidence =
    input.indexEvidence === undefined
      ? undefined
      : decodeIndexEvidence(input.indexEvidence, input, issues);

  if (status === "copying") {
    if (operation === undefined) {
      issues.add("ingest.operation.required", "ingest.operation", "copying journal requires an operation owner");
    }
    if (targetHash !== undefined) {
      issues.add(
        "ingest.targetHash.unexpected",
        "ingest.targetHash",
        "copying journal must not claim a completed entry copy",
      );
    }
    if (gbrainEvidence !== undefined || indexEvidence !== undefined) {
      issues.add(
        "ingest.evidence.unexpected",
        "ingest.gbrainEvidence",
        "copying journal must not carry gbrain/index evidence",
      );
    }
    if (failedStep !== undefined || failureReason !== undefined) {
      issues.add("ingest.failed.unexpected", "ingest.failedStep", "copying journal is not failed");
    }
  } else if (status === "staged") {
    if (operation !== undefined) {
      issues.add("ingest.operation.unexpected", "ingest.operation", "staged journal no longer owns a copier");
    }
    if (targetHash === undefined) {
      issues.add("ingest.targetHash.required", "ingest.targetHash", "staged journal requires the entry copy digest");
    }
    if (gbrainEvidence !== undefined || indexEvidence !== undefined) {
      issues.add(
        "ingest.evidence.unexpected",
        "ingest.gbrainEvidence",
        "staged journal must not carry gbrain/index evidence",
      );
    }
    if (failedStep !== undefined || failureReason !== undefined) {
      issues.add("ingest.failed.unexpected", "ingest.failedStep", "staged journal is not failed");
    }
  } else if (status !== undefined && status !== "failed") {
    if (operation !== undefined) {
      issues.add("ingest.operation.unexpected", "ingest.operation", "only a copying journal owns a copier");
    }
    if (targetHash === undefined) {
      issues.add(
        "ingest.targetHash.required",
        "ingest.targetHash",
        `${status} journal requires the entry copy digest`,
      );
    }
    if (failedStep !== undefined || failureReason !== undefined) {
      issues.add("ingest.failed.unexpected", "ingest.failedStep", `${status} journal is not failed`);
    }
    if ((status === "gbrain" || status === "index" || status === "committed") && gbrainEvidence === undefined) {
      issues.add("ingest.gbrainEvidence.required", "ingest.gbrainEvidence", `${status} journal requires gbrain evidence`);
    }
    if ((status === "index" || status === "committed") && indexEvidence === undefined) {
      issues.add("ingest.indexEvidence.required", "ingest.indexEvidence", `${status} journal requires index evidence`);
    }
  } else if (status === "failed") {
    if (failedStep === undefined) {
      issues.add("ingest.failedStep.required", "ingest.failedStep", "failed journal requires failedStep");
    }
    if (failureReason === undefined) {
      issues.add("ingest.failureReason.required", "ingest.failureReason", "failed journal requires failureReason");
    }
    if (failedStep === "copying") {
      if (targetHash !== undefined) {
        issues.add(
          "ingest.targetHash.unexpected",
          "ingest.targetHash",
          "a copy that failed in copying must not claim a completed entry copy",
        );
      }
    } else if (targetHash === undefined) {
      issues.add("ingest.targetHash.required", "ingest.targetHash", `${failedStep} failure requires the entry digest`);
    }
    if (failedStep !== "copying" && operation !== undefined) {
      issues.add(
        "ingest.operation.unexpected",
        "ingest.operation",
        "only failedStep=copying retains the copier operation for resume",
      );
    }
    if ((failedStep === "copying" || failedStep === "staged") && gbrainEvidence !== undefined) {
      issues.add(
        "ingest.gbrainEvidence.unexpected",
        "ingest.gbrainEvidence",
        "failure before the gbrain checkpoint must not synthesize evidence",
      );
    }
    if (
      (failedStep === "copying" || failedStep === "staged" || failedStep === "gbrain") &&
      indexEvidence !== undefined
    ) {
      issues.add(
        "ingest.indexEvidence.unexpected",
        "ingest.indexEvidence",
        "failure before the index checkpoint must not synthesize evidence",
      );
    }
  }

  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 3,
    kind: "bundle",
    id: input.id as string,
    source: source as string,
    target: target as string,
    relPath: relPath as string,
    ownerKind: ownerKind as IngestOwnerKind,
    ownerId: ownerId as string,
    slug: slug as string,
    indexPath: indexPath as string,
    indexEntry: indexEntry as string,
    sourcePolicy: "retain",
    manifestRelPath: manifestRelPath as string,
    manifestSha256: manifestSha256 as string,
    aggregateSha256: aggregateSha256 as string,
    sourceHash: sourceHash as string,
    ...(targetHash !== undefined ? { targetHash } : {}),
    status: status as IngestBundleStatus,
    ...(operation !== undefined ? { operation } : {}),
    ...(failedStep !== undefined ? { failedStep } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
    ...(gbrainEvidence !== undefined ? { gbrainEvidence: gbrainEvidence as IngestBundleGbrainEvidence } : {}),
    ...(indexEvidence !== undefined ? { indexEvidence } : {}),
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  });
}

/** List/doctor/status dispatcher: v2 keeps its original decoder, v3 uses the
 *  bundle decoder, and schema 1 remains unsupported runtime state (its only
 *  path is the existing workspace migration). */
export function decodeIngestJournalRecord(input: unknown): DecodeResult<IngestJournal> {
  if (isRecord(input) && input.schema_version === 3) return decodeIngestBundleJournal(input);
  return decodeIngestJournal(input);
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
