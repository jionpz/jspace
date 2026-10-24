// core/contracts/asset-bundle.ts — typed, deterministic bundle identity.
//
// A bundle is represented by one entry file (the asset page / index target) plus
// a manifest stored outside the bundle root. The manifest is the member truth;
// `tree-sha256-v1` is the only aggregate identity and must be reproducible from
// member path, kind, size, digest and executable bit alone.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readBool,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { isAbsolutePath, portabilityIssues } from "./paths.ts";
import { sha256Of } from "../shared/hash.ts";

export const ASSET_BUNDLE_SCHEMA_VERSION = 1;
export const ASSET_BUNDLE_KIND = "asset-bundle";
export const BUNDLE_MAX_MEMBERS = 10_000;
export const BUNDLE_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const BUNDLE_MAX_DEPTH = 32;
export const BUNDLE_MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** Owner-relative metadata directory. Hidden from the ordinary scan by design;
 *  bundle verification reads it explicitly. */
export const BUNDLE_METADATA_DIR = ".jspace/bundles";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const BUNDLE_OWNER_KINDS = ["project", "area"] as const;
export type BundleOwnerKind = (typeof BUNDLE_OWNER_KINDS)[number];

export interface BundleSource {
  label: string;
  version?: string;
}

export type BundleMember =
  | { path: string; kind: "dir" }
  | { path: string; kind: "file"; size: number; sha256: string; executable: boolean };

export interface AssetBundleManifestV1 {
  schema_version: 1;
  kind: "asset-bundle";
  ownerKind: BundleOwnerKind;
  ownerId: string;
  slug: string;
  rootRelPath: string;
  entry: string;
  source: BundleSource;
  members: BundleMember[];
  aggregateSha256: string;
}

export type TreeRecord =
  | ["d", string]
  | ["f", string, number, string, boolean];

/** UTF-8 byte order, independent of locale and filesystem traversal order. */
export function comparePathBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf-8"), Buffer.from(right, "utf-8"));
}

/** One portable bundle-relative path: `/` separators, no absolute form, no
 *  empty/`.`/`..` segments, no control characters, bounded depth. */
export function bundleMemberPathIssue(path: string): string | null {
  if (path.length === 0) return "must not be empty";
  if (isAbsolutePath(path)) return "must be a relative path";
  if (path.includes("\\")) return "must use / separators";
  if (path.endsWith("/")) return "must not end with a separator";
  if (/[\u0000-\u001f]/.test(path)) return "must not contain control characters";
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "must not contain empty, . or .. segments";
  }
  if (segments.length > BUNDLE_MAX_DEPTH) {
    return `must not be deeper than ${BUNDLE_MAX_DEPTH} segments`;
  }
  return null;
}

export function bundleRootPathIssue(path: string): string | null {
  const portable = portabilityIssues(path);
  if (portable.length > 0) return portable.join("; ");
  if (path.split("/").some((segment) => segment.length === 0)) {
    return "must not contain empty path segments";
  }
  if (!path.startsWith("projects/") && !path.startsWith("areas/")) {
    return "must be a filehub-relative path under projects/ or areas/";
  }
  return null;
}

function lowercaseNormalized(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export function treeRecordsFromMembers(members: readonly BundleMember[]): TreeRecord[] {
  return members.map((member) =>
    member.kind === "dir"
      ? (["d", member.path] as TreeRecord)
      : (["f", member.path, member.size, member.sha256, member.executable] as TreeRecord),
  );
}

/** `tree-sha256-v1`: sort records by path UTF-8 bytes, then hash the compact
 *  JSON of `["tree-sha256-v1", records]`. No mtime, mode, uid/gid or absolute
 *  path participates. */
export function treeSha256(records: readonly TreeRecord[]): string {
  const sorted = [...records].sort((left, right) => comparePathBytes(left[1], right[1]));
  return sha256Of(JSON.stringify(["tree-sha256-v1", sorted]));
}

export function aggregateForMembers(members: readonly BundleMember[]): string {
  return treeSha256(treeRecordsFromMembers(members));
}

export function bundleManifestRelPath(ownerRoot: string, slug: string): string {
  return `${ownerRoot.replace(/\/+$/, "")}/${BUNDLE_METADATA_DIR}/${sha256Of(slug)}.json`;
}

/** Fixed field order, two-space indent, trailing LF. Manifest bytes are hashed
 *  separately, so serialization must not depend on object insertion accidents. */
export function serializeAssetBundleManifest(manifest: AssetBundleManifestV1): string {
  const ordered = {
    schema_version: manifest.schema_version,
    kind: manifest.kind,
    ownerKind: manifest.ownerKind,
    ownerId: manifest.ownerId,
    slug: manifest.slug,
    rootRelPath: manifest.rootRelPath,
    entry: manifest.entry,
    source: {
      label: manifest.source.label,
      ...(manifest.source.version !== undefined ? { version: manifest.source.version } : {}),
    },
    members: manifest.members.map((member) =>
      member.kind === "dir"
        ? { path: member.path, kind: member.kind }
        : {
            path: member.path,
            kind: member.kind,
            size: member.size,
            sha256: member.sha256,
            executable: member.executable,
          },
    ),
    aggregateSha256: manifest.aggregateSha256,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
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

function readMember(
  value: unknown,
  index: number,
  prefix: string,
  issues: IssueCollector,
): BundleMember | undefined {
  const path = `${prefix}.members[${index}]`;
  if (!isRecord(value)) {
    issues.add("asset-bundle.member.invalid", path, "member must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  const kind = value.kind;
  if (kind !== "dir" && kind !== "file") {
    issues.add("asset-bundle.member.kind", `${path}.kind`, "must be dir or file");
    return undefined;
  }
  if (kind === "dir") {
    checkNoUnknownFields(value, ["path", "kind"], path, "asset-bundle.member.unknown-field", issues);
    const memberPath = readRequiredString(value, "path", path, "asset-bundle.member.path.invalid", issues);
    if (memberPath !== undefined) {
      const issue = bundleMemberPathIssue(memberPath);
      if (issue !== null) issues.add("asset-bundle.member.path.invalid", `${path}.path`, issue);
    }
    if (issues.issues.length !== before) return undefined;
    return { path: memberPath as string, kind: "dir" };
  }

  checkNoUnknownFields(
    value,
    ["path", "kind", "size", "sha256", "executable"],
    path,
    "asset-bundle.member.unknown-field",
    issues,
  );
  const memberPath = readRequiredString(value, "path", path, "asset-bundle.member.path.invalid", issues);
  if (memberPath !== undefined) {
    const issue = bundleMemberPathIssue(memberPath);
    if (issue !== null) issues.add("asset-bundle.member.path.invalid", `${path}.path`, issue);
  }
  const size = value.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    issues.add("asset-bundle.member.size", `${path}.size`, "must be a non-negative safe integer");
  }
  const sha256 = readSha256(value, "sha256", path, "asset-bundle.member.sha256", issues);
  const executable = readBool(issues, "asset-bundle.member.executable", `${path}.executable`, value.executable);
  if (issues.issues.length !== before) return undefined;
  return {
    path: memberPath as string,
    kind: "file",
    size: size as number,
    sha256: sha256 as string,
    executable: executable as boolean,
  };
}

export function decodeAssetBundleManifest(input: unknown): DecodeResult<AssetBundleManifestV1> {
  const issues = new IssueCollector();
  const prefix = "asset-bundle";
  if (!isRecord(input)) {
    issues.add("asset-bundle.type", prefix, "asset bundle manifest must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(
    input,
    [
      "schema_version",
      "kind",
      "ownerKind",
      "ownerId",
      "slug",
      "rootRelPath",
      "entry",
      "source",
      "members",
      "aggregateSha256",
    ],
    prefix,
    "asset-bundle.unknown-field",
    issues,
  );
  readVersion(issues, "asset-bundle.version.unsupported", "asset-bundle.schema_version", input.schema_version, [
    ASSET_BUNDLE_SCHEMA_VERSION,
  ]);
  if (input.kind !== ASSET_BUNDLE_KIND) {
    issues.add("asset-bundle.kind", "asset-bundle.kind", `must be ${ASSET_BUNDLE_KIND}`);
  }
  const ownerKind = input.ownerKind;
  if (ownerKind !== "project" && ownerKind !== "area") {
    issues.add("asset-bundle.ownerKind", "asset-bundle.ownerKind", "must be project or area");
  }
  const ownerId = readRequiredString(input, "ownerId", prefix, "asset-bundle.ownerId", issues);
  if (ownerId !== undefined && (ownerId !== ownerId.trim() || /[\\/]/.test(ownerId) || ownerId === "." || ownerId === "..")) {
    issues.add("asset-bundle.ownerId", "asset-bundle.ownerId", "must be one plain path segment");
  }
  const slug = readRequiredString(input, "slug", prefix, "asset-bundle.slug", issues);
  if (slug !== undefined && ownerId !== undefined) {
    const expected = `assets/${ownerId}/`;
    const segments = slug.split("/");
    if (
      !slug.startsWith(expected) ||
      segments.length !== 3 ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      issues.add("asset-bundle.slug", "asset-bundle.slug", `must match ${expected}<semantic>`);
    }
  }
  const rootRelPath = readRequiredString(input, "rootRelPath", prefix, "asset-bundle.rootRelPath", issues);
  if (rootRelPath !== undefined) {
    const issue = bundleRootPathIssue(rootRelPath);
    if (issue !== null) issues.add("asset-bundle.rootRelPath", "asset-bundle.rootRelPath", issue);
    if (rootRelPath.endsWith(`/${BUNDLE_METADATA_DIR}`) || rootRelPath.includes(`/${BUNDLE_METADATA_DIR}/`)) {
      issues.add(
        "asset-bundle.rootRelPath",
        "asset-bundle.rootRelPath",
        "bundle root must not overlap the managed metadata directory",
      );
    }
  }
  const entry = readRequiredString(input, "entry", prefix, "asset-bundle.entry", issues);
  if (entry !== undefined) {
    const issue = bundleMemberPathIssue(entry);
    if (issue !== null) issues.add("asset-bundle.entry", "asset-bundle.entry", issue);
  }

  const sourcePrefix = "asset-bundle.source";
  let source: BundleSource | undefined;
  if (!isRecord(input.source)) {
    issues.add("asset-bundle.source", sourcePrefix, "source must be an object");
  } else {
    checkNoUnknownFields(input.source, ["label", "version"], sourcePrefix, "asset-bundle.source.unknown-field", issues);
    const label = readRequiredString(input.source, "label", sourcePrefix, "asset-bundle.source.label", issues);
    const version =
      input.source.version === undefined
        ? undefined
        : readRequiredString(input.source, "version", sourcePrefix, "asset-bundle.source.version", issues);
    if (label !== undefined) source = { label, ...(version !== undefined ? { version } : {}) };
  }

  let members: BundleMember[] | undefined;
  if (!Array.isArray(input.members)) {
    issues.add("asset-bundle.members", "asset-bundle.members", "members must be an array");
  } else {
    const parsed: BundleMember[] = [];
    input.members.forEach((member, index) => {
      const decoded = readMember(member, index, prefix, issues);
      if (decoded !== undefined) parsed.push(decoded);
    });
    members = parsed;
    if (parsed.length > BUNDLE_MAX_MEMBERS) {
      issues.add(
        "asset-bundle.limit.members",
        "asset-bundle.members",
        `bundle has ${parsed.length} members; the limit is ${BUNDLE_MAX_MEMBERS}`,
      );
    }
    let totalBytes = 0;
    for (const member of parsed) {
      if (member.kind === "file") totalBytes += member.size;
    }
    if (totalBytes > BUNDLE_MAX_FILE_BYTES) {
      issues.add(
        "asset-bundle.limit.bytes",
        "asset-bundle.members",
        `bundle members total ${totalBytes} bytes; the limit is ${BUNDLE_MAX_FILE_BYTES}`,
      );
    }

    const exact = new Set<string>();
    const folded = new Map<string, string>();
    const filePaths: string[] = [];
    for (const member of parsed) {
      if (exact.has(member.path)) {
        issues.add("asset-bundle.member.duplicate", "asset-bundle.members", `duplicate member path: ${member.path}`);
        continue;
      }
      exact.add(member.path);
      const key = lowercaseNormalized(member.path);
      const prior = folded.get(key);
      if (prior !== undefined) {
        issues.add(
          "asset-bundle.member.fold-collision",
          "asset-bundle.members",
          `member paths collide after case/Unicode folding: ${prior} / ${member.path}`,
        );
      } else {
        folded.set(key, member.path);
      }
      if (member.kind === "file") filePaths.push(member.path);
    }
    if (filePaths.length > 0) {
      for (const file of filePaths) {
        if (parsed.some((candidate) => candidate.path.startsWith(`${file}/`))) {
          issues.add(
            "asset-bundle.member.parent-type",
            "asset-bundle.members",
            `member path is both a file and a parent directory: ${file}`,
          );
        }
      }
    }
    for (let index = 1; index < parsed.length; index++) {
      if (comparePathBytes(parsed[index - 1]!.path, parsed[index]!.path) >= 0) {
        issues.add(
          "asset-bundle.members.unsorted",
          "asset-bundle.members",
          "members must be sorted by path UTF-8 bytes with no duplicate path",
        );
        break;
      }
    }
    if (entry !== undefined) {
      const entryMember = parsed.find((member) => member.path === entry);
      if (entryMember === undefined) {
        issues.add("asset-bundle.entry.not-member", "asset-bundle.entry", "entry must be listed in members");
      } else if (entryMember.kind !== "file") {
        issues.add("asset-bundle.entry.not-file", "asset-bundle.entry", "entry must be a regular file member");
      }
    }
  }

  const aggregateSha256 = readSha256(
    input,
    "aggregateSha256",
    prefix,
    "asset-bundle.aggregateSha256",
    issues,
  );
  if (aggregateSha256 !== undefined && members !== undefined && issues.ok) {
    const computed = aggregateForMembers(members);
    if (computed !== aggregateSha256) {
      issues.add(
        "asset-bundle.aggregate.mismatch",
        "asset-bundle.aggregateSha256",
        `member records hash to ${computed}, not the declared aggregate`,
      );
    }
  }

  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    kind: "asset-bundle",
    ownerKind: ownerKind as BundleOwnerKind,
    ownerId: ownerId as string,
    slug: slug as string,
    rootRelPath: rootRelPath as string,
    entry: entry as string,
    source: source as BundleSource,
    members: members as BundleMember[],
    aggregateSha256: aggregateSha256 as string,
  });
}
