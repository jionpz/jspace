// application/filehub/bundle.ts — bounded filesystem verification for a bundle.
//
// The ordinary filehub scan deliberately skips hidden directories, including
// the managed `.jspace/bundles` metadata directory. Bundle verification is an
// explicit read: manifest identity first, then a bounded walk of the actual
// tree compared in both directions against the manifest.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  ASSET_BUNDLE_KIND,
  BUNDLE_MAX_DEPTH,
  BUNDLE_MAX_FILE_BYTES,
  BUNDLE_MAX_MANIFEST_BYTES,
  BUNDLE_MAX_MEMBERS,
  bundleMemberPathIssue,
  bundleRootPathIssue,
  decodeAssetBundleManifest,
  treeSha256,
  type AssetBundleManifestV1,
  type TreeRecord,
} from "../../core/contracts/asset-bundle.ts";
import { portabilityIssues } from "../../core/contracts/paths.ts";
import { isRestrictedPath } from "./path-policy.ts";

const HASH_CHUNK_BYTES = 1024 * 1024;

export type BundleScanErrorCode =
  | "root_missing"
  | "root_symlink"
  | "root_not_directory"
  | "restricted"
  | "symlink"
  | "unsupported"
  | "limit_members"
  | "limit_bytes"
  | "limit_depth"
  | "unreadable";

export interface BundleFileEntry {
  path: string;
  size: number;
  sha256: string;
  executable: boolean;
}

export interface BundleTreeScan {
  state: "ok" | "error";
  code?: BundleScanErrorCode;
  detail?: string;
  /** Safe to show: restricted-path errors never include the member path. */
  path?: string;
  records: TreeRecord[];
  files: BundleFileEntry[];
  directories: string[];
  totalBytes: number;
  aggregateSha256?: string;
  /** false on platforms where the executable bit cannot be trusted. */
  executableVerified: boolean;
}

function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Hash a regular file without following a final-component symlink. */
export function sha256FileNoFollow(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("object is no longer a regular file");
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function scanError(
  code: BundleScanErrorCode,
  detail: string,
  path?: string,
): BundleTreeScan {
  return {
    state: "error",
    code,
    detail,
    ...(path !== undefined ? { path } : {}),
    records: [],
    files: [],
    directories: [],
    totalBytes: 0,
    executableVerified: process.platform !== "win32",
  };
}

/** Walk a bundle root with fixed budgets. Any symlink/special/restricted member
 *  refuses the whole tree: staging must not silently omit or follow it. */
export function scanBundleTree(absRoot: string): BundleTreeScan {
  let rootStat: ReturnType<typeof lstatSync>;
  try {
    rootStat = lstatSync(absRoot);
  } catch {
    return scanError("root_missing", "bundle root is missing or unreadable");
  }
  if (rootStat.isSymbolicLink()) {
    return scanError("root_symlink", "bundle root is a symlink and is not followed");
  }
  if (!rootStat.isDirectory()) {
    return scanError("root_not_directory", "bundle root is not a directory");
  }

  const records: TreeRecord[] = [];
  const files: BundleFileEntry[] = [];
  const directories: string[] = [];
  let totalBytes = 0;
  let failure: BundleTreeScan | null = null;

  const walk = (relDir: string, depth: number): void => {
    if (failure !== null) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(absRoot, relDir), { withFileTypes: true });
    } catch {
      failure = scanError(
        "unreadable",
        relDir === "" ? "bundle root could not be read" : `bundle directory could not be read: ${relDir}`,
        relDir === "" ? undefined : relDir,
      );
      return;
    }

    for (const entry of entries) {
      if (failure !== null) return;
      const memberPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const segments = memberPath.split("/").length;
      if (segments > BUNDLE_MAX_DEPTH) {
        failure = scanError(
          "limit_depth",
          `bundle member depth exceeds ${BUNDLE_MAX_DEPTH} segments (${memberPath})`,
          memberPath,
        );
        return;
      }
      if (isRestrictedPath(memberPath)) {
        // Deliberately no path: a diagnostics refusal must not echo a secret
        // filename it was asked to inspect.
        failure = scanError("restricted", "bundle contains a restricted path; the whole bundle was refused");
        return;
      }

      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(join(absRoot, memberPath));
      } catch {
        failure = scanError("unreadable", `bundle member could not be inspected: ${memberPath}`, memberPath);
        return;
      }
      if (stat.isSymbolicLink()) {
        failure = scanError("symlink", `bundle member is a symlink and is not followed: ${memberPath}`, memberPath);
        return;
      }
      if (stat.isDirectory()) {
        records.push(["d", memberPath]);
        directories.push(memberPath);
        if (records.length > BUNDLE_MAX_MEMBERS) {
          failure = scanError("limit_members", `bundle exceeds ${BUNDLE_MAX_MEMBERS} members`);
          return;
        }
        walk(memberPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        failure = scanError(
          "unsupported",
          `bundle member is neither a regular file nor a directory: ${memberPath}`,
          memberPath,
        );
        return;
      }
      // Charge the declared size before reading: an oversized member must be
      // rejected without first hashing gigabytes (or an unbounded file).
      totalBytes += stat.size;
      if (totalBytes > BUNDLE_MAX_FILE_BYTES) {
        failure = scanError("limit_bytes", `bundle file bytes exceed ${BUNDLE_MAX_FILE_BYTES}`);
        return;
      }
      let sha256: string;
      try {
        sha256 = sha256FileNoFollow(join(absRoot, memberPath));
      } catch {
        failure = scanError(
          "unreadable",
          `bundle file could not be read without following links: ${memberPath}`,
          memberPath,
        );
        return;
      }
      const executable = (stat.mode & 0o111) !== 0;
      records.push(["f", memberPath, stat.size, sha256, executable]);
      files.push({ path: memberPath, size: stat.size, sha256, executable });
      if (records.length > BUNDLE_MAX_MEMBERS) {
        failure = scanError("limit_members", `bundle exceeds ${BUNDLE_MAX_MEMBERS} members`);
        return;
      }
    }
  };

  walk("", 0);
  if (failure !== null) return failure;
  records.sort((left, right) => Buffer.compare(Buffer.from(left[1]), Buffer.from(right[1])));
  const aggregate = treeSha256(records);
  return {
    state: "ok",
    records,
    files,
    directories,
    totalBytes,
    aggregateSha256: aggregate,
    executableVerified: process.platform !== "win32",
  };
}

export interface BundleManifestRead {
  state: "ok" | "missing" | "unreadable" | "symlink" | "not_file" | "too_large" | "invalid";
  detail?: string;
  manifest?: AssetBundleManifestV1;
  bytes?: Buffer;
  manifestSha256?: string;
}

export function readBundleManifest(rootAbs: string, manifestRelPath: string): BundleManifestRead {
  const issues = portabilityIssues(manifestRelPath);
  if (issues.length > 0) return { state: "invalid", detail: issues.join("; ") };
  const abs = resolve(rootAbs, manifestRelPath);
  if (!within(abs, rootAbs)) return { state: "invalid", detail: "manifest path escapes the filehub root" };

  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(abs);
  } catch {
    return { state: "missing", detail: "bundle manifest is missing" };
  }
  if (stat.isSymbolicLink()) return { state: "symlink", detail: "bundle manifest is a symlink and is not followed" };
  if (!stat.isFile()) return { state: "not_file", detail: "bundle manifest is not a regular file" };
  if (stat.size > BUNDLE_MAX_MANIFEST_BYTES) {
    return { state: "too_large", detail: `bundle manifest exceeds ${BUNDLE_MAX_MANIFEST_BYTES} bytes` };
  }

  let bytes: Buffer;
  try {
    const fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!fstatSync(fd).isFile()) return { state: "not_file", detail: "bundle manifest is not a regular file" };
      const chunks: Buffer[] = [];
      const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
      let read = 0;
      while ((read = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        chunks.push(Buffer.from(chunk.subarray(0, read)));
      }
      bytes = Buffer.concat(chunks);
    } finally {
      closeSync(fd);
    }
  } catch {
    return { state: "unreadable", detail: "bundle manifest could not be read without following links" };
  }

  if (bytes.length > BUNDLE_MAX_MANIFEST_BYTES) {
    return { state: "too_large", detail: `bundle manifest exceeds ${BUNDLE_MAX_MANIFEST_BYTES} bytes` };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { state: "invalid", detail: "bundle manifest is not valid UTF-8" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "invalid", detail: "bundle manifest is not valid JSON" };
  }
  const decoded = decodeAssetBundleManifest(parsed);
  if (!decoded.ok) {
    return {
      state: "invalid",
      detail: decoded.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
    };
  }
  return {
    state: "ok",
    manifest: decoded.value,
    bytes,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export interface BundleTreeComparison {
  missing: string[];
  extra: string[];
  changed: string[];
}

export function compareBundleTree(
  manifest: AssetBundleManifestV1,
  actual: BundleTreeScan,
): BundleTreeComparison {
  const expected = new Map<string, TreeRecord>();
  for (const record of manifest.members.map((member) =>
    member.kind === "dir"
      ? (["d", member.path] as TreeRecord)
      : (["f", member.path, member.size, member.sha256, member.executable] as TreeRecord),
  )) {
    expected.set(record[1], record);
  }
  const seen = new Map<string, TreeRecord>();
  for (const record of actual.records) seen.set(record[1], record);

  const missing: string[] = [];
  const extra: string[] = [];
  const changed: string[] = [];
  for (const [path, record] of expected) {
    const found = seen.get(path);
    if (found === undefined) {
      missing.push(path);
      continue;
    }
    if (JSON.stringify(record) !== JSON.stringify(found)) changed.push(path);
  }
  for (const path of seen.keys()) {
    if (!expected.has(path)) extra.push(path);
  }
  return {
    missing: missing.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    extra: extra.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    changed: changed.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
  };
}

export interface BundlePageMetadata {
  bundleRoot: string;
  bundleManifest: string;
  bundleSha256: string;
  bundleManifestSha256: string;
}

/** Parse the flat bundle scalars shared by filehub check and memory check. The
 *  caller must first establish that `asset_kind` is `bundle`. */
export function bundleMetadataFromFields(
  fields: Readonly<Record<string, string>>,
): { ok: true; metadata: BundlePageMetadata } | { ok: false; detail: string } {
  const bundleRoot = fields.bundle_root;
  const bundleManifest = fields.bundle_manifest;
  const bundleSha256 = fields.bundle_sha256;
  const bundleManifestSha256 = fields.bundle_manifest_sha256;
  if (!bundleRoot) return { ok: false, detail: "asset_kind bundle requires bundle_root" };
  if (!bundleManifest) return { ok: false, detail: "asset_kind bundle requires bundle_manifest" };
  if (!bundleSha256) return { ok: false, detail: "asset_kind bundle requires bundle_sha256" };
  if (!bundleManifestSha256) return { ok: false, detail: "asset_kind bundle requires bundle_manifest_sha256" };
  const rootIssue = bundleRootPathIssue(bundleRoot);
  if (rootIssue !== null) return { ok: false, detail: `bundle_root is invalid: ${rootIssue}` };
  const manifestIssues = portabilityIssues(bundleManifest);
  if (manifestIssues.length > 0) {
    return { ok: false, detail: `bundle_manifest is invalid: ${manifestIssues.join("; ")}` };
  }
  if (!/^[0-9a-f]{64}$/.test(bundleSha256)) {
    return { ok: false, detail: "bundle_sha256 must be a 64-character lowercase sha256 digest" };
  }
  if (!/^[0-9a-f]{64}$/.test(bundleManifestSha256)) {
    return { ok: false, detail: "bundle_manifest_sha256 must be a 64-character lowercase sha256 digest" };
  }
  if (bundleManifest === bundleRoot || bundleManifest.startsWith(`${bundleRoot.replace(/\/+$/, "")}/`)) {
    return { ok: false, detail: "bundle_manifest must live outside bundle_root" };
  }
  return {
    ok: true,
    metadata: { bundleRoot, bundleManifest, bundleSha256, bundleManifestSha256 },
  };
}

export function manifestIdentityIssues(
  manifest: AssetBundleManifestV1,
  expected: {
    ownerKind: "project" | "area";
    ownerId: string;
    slug: string;
    rootRelPath: string;
    entry: string;
  },
): string[] {
  const out: string[] = [];
  if (manifest.kind !== ASSET_BUNDLE_KIND) out.push(`manifest kind must be ${ASSET_BUNDLE_KIND}`);
  if (manifest.ownerKind !== expected.ownerKind) out.push("manifest ownerKind does not match the page owner");
  if (manifest.ownerId !== expected.ownerId) out.push("manifest ownerId does not match the page owner");
  if (manifest.slug !== expected.slug) out.push("manifest slug does not match the asset page slug");
  if (manifest.rootRelPath !== expected.rootRelPath) out.push("manifest rootRelPath does not match bundle_root");
  if (manifest.entry !== expected.entry) out.push("manifest entry does not match the page rel_path");
  return out;
}

/** A bundle-relative entry path must be a regular member of the manifest. */
export function entryMember(manifest: AssetBundleManifestV1): { size: number; sha256: string } | null {
  if (bundleMemberPathIssue(manifest.entry) !== null) return null;
  const member = manifest.members.find((candidate) => candidate.path === manifest.entry);
  return member !== undefined && member.kind === "file"
    ? { size: member.size, sha256: member.sha256 }
    : null;
}
