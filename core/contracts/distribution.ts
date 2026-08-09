// core/contracts/distribution.ts — distribution manifest base contract + decoder.
//
// This contract only defines the typed base shape + decoder. Manifest
// generation and embedded-asset location live in cli (generated manifests);
// diff/upgrade conflict policy lives in application/workspace.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readEnum,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { portabilityIssues } from "./paths.ts";

export type AssetOwnership = "managed" | "seed" | "user";

export interface DistributionFile {
  path: string;
  sha256: string;
  ownership: AssetOwnership;
}

export interface DistributionManifestV1 {
  version: 1;
  bundle_version: string;
  files: DistributionFile[];
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const OWNERSHIPS: readonly AssetOwnership[] = ["managed", "seed", "user"];

export function decodeDistributionManifest(input: unknown): DecodeResult<DistributionManifestV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("manifest.root.type", "manifest", "manifest root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["version", "bundle_version", "files"], "manifest", "manifest.unknown-field", issues);

  readVersion(issues, "manifest.version.unsupported", "manifest.version", input.version, [1]);
  readRequiredString(input, "bundle_version", "manifest", "manifest.bundle_version.invalid", issues);

  const files: DistributionFile[] = [];
  if (!Array.isArray(input.files)) {
    issues.add("manifest.files.type", "manifest.files", "files must be an array");
  } else {
    input.files.forEach((item, i) => {
      const prefix = `manifest.files[${i}]`;
      if (!isRecord(item)) {
        issues.add("manifest.file.type", prefix, "file must be an object");
        return;
      }
      const before = issues.issues.length;
      checkNoUnknownFields(item, ["path", "sha256", "ownership"], prefix, "manifest.file.unknown-field", issues);
      const path = readRequiredString(item, "path", prefix, "manifest.file.path.invalid", issues);
      if (path !== undefined) {
        for (const m of portabilityIssues(path)) issues.add("manifest.file.path.invalid", `${prefix}.path`, `path ${m}`);
      }
      const sha256 = readRequiredString(item, "sha256", prefix, "manifest.file.sha256.invalid", issues);
      if (sha256 !== undefined && !SHA256_PATTERN.test(sha256)) {
        issues.add("manifest.file.sha256.invalid", `${prefix}.sha256`, "sha256 must be a 64-char hex digest");
      }
      readEnum(issues, "manifest.file.ownership.invalid", `${prefix}.ownership`, item.ownership, OWNERSHIPS);
      if (issues.issues.length === before) {
        files.push({ path: path as string, sha256: sha256 as string, ownership: item.ownership as AssetOwnership });
      }
    });
  }

  if (!issues.ok) return failure(issues.issues);
  return success({ version: 1, bundle_version: input.bundle_version as string, files });
}
