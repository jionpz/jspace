// core/contracts/materialized.ts — typed materialization journal contract
// (.jspace/state/materialized.json). Recovery-critical: records the last-applied
// actual file hashes so workspace diff can distinguish "bundle updated" from
// "user modified". An invalid journal must fail loud, never read as "no base".
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export interface MaterializedJournalV1 {
  version: 1;
  asset_version: string;
  applied_at: string;
  files: Record<string, { sha256: string }>;
}

export function decodeMaterializedJournal(input: unknown): DecodeResult<MaterializedJournalV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("materialized.root.type", "materialized", "materialized journal must be an object");
    return failure(issues.issues);
  }
  const FIELDS = ["version", "asset_version", "applied_at", "files"] as const;
  checkNoUnknownFields(input, FIELDS, "materialized", "materialized.unknown-field", issues);
  if (input.version !== 1) {
    issues.add("materialized.version.unsupported", "materialized.version", "version must be 1");
  }
  readRequiredString(input, "asset_version", "materialized", "materialized.asset_version.invalid", issues);
  readRequiredString(input, "applied_at", "materialized", "materialized.applied_at.invalid", issues);
  if (!isRecord(input.files)) {
    issues.add("materialized.files.invalid", "materialized.files", "files must be an object of {sha256} entries");
  } else {
    for (const [rel, v] of Object.entries(input.files)) {
      if (!isRecord(v) || typeof v.sha256 !== "string" || v.sha256.length === 0) {
        issues.add("materialized.files.invalid", `materialized.files.${rel}`, `files[${rel}] must be { sha256: <non-empty string> }`);
      }
    }
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    version: 1,
    asset_version: input.asset_version as string,
    applied_at: input.applied_at as string,
    files: input.files as Record<string, { sha256: string }>,
  });
}
