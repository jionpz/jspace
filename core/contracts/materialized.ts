// core/contracts/materialized.ts — typed materialization journal contract
// (.jspace/state/materialized.json). Recovery-critical: records the last-applied
// actual file hashes so workspace diff can distinguish "bundle updated" from
// "user modified". An invalid journal must fail loud, never read as "no base".
//
// v2 (issue #39) adds the optional `links` section: per-skill directory
// symlinks materialized by the thin-link projection engine, recorded as
// { target, mode } so doctor can verify structure and copy-fallback stays
// visible. v1 journals (files only) decode with `links: {}` — additive field,
// no data migration.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

/** How a projection entry is physically materialized. "copy" is the visible
 *  fallback for platforms without symlink privilege — never a silent mode. */
export type ProjectionLinkMode = "link" | "junction" | "copy";

export interface MaterializedLinkEntry {
  /** Link target as written (relative for in-workbench projections, absolute
   *  for user-level). Compare via resolve() against the SSOT, not textually. */
  target: string;
  mode: ProjectionLinkMode;
}

export interface MaterializedJournalV2 {
  schema_version: 2;
  asset_version: string;
  applied_at: string;
  files: Record<string, { sha256: string }>;
  links: Record<string, MaterializedLinkEntry>;
}

const LINK_MODES: readonly string[] = ["link", "junction", "copy"];

export function decodeMaterializedJournal(input: unknown): DecodeResult<MaterializedJournalV2> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("materialized.root.type", "materialized", "materialized journal must be an object");
    return failure(issues.issues);
  }
  const FIELDS = ["schema_version", "asset_version", "applied_at", "files", "links"] as const;
  checkNoUnknownFields(input, FIELDS, "materialized", "materialized.unknown-field", issues);
  const version = readVersion(issues, "materialized.version.unsupported", "materialized.version", input.schema_version, [1, 2]);
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
  // v1 journals predate the thin-link engine: links absent means "none recorded".
  if (input.links !== undefined) {
    if (!isRecord(input.links)) {
      issues.add("materialized.links.invalid", "materialized.links", "links must be an object of {target, mode} entries");
    } else {
      for (const [rel, v] of Object.entries(input.links)) {
        if (
          !isRecord(v) ||
          typeof v.target !== "string" ||
          v.target.length === 0 ||
          typeof v.mode !== "string" ||
          !LINK_MODES.includes(v.mode)
        ) {
          issues.add("materialized.links.invalid", `materialized.links.${rel}`, `links[${rel}] must be { target: <non-empty string>, mode: ${LINK_MODES.join("|")} }`);
        }
      }
    }
  }
  if (!issues.ok) return failure(issues.issues);
  const links: Record<string, MaterializedLinkEntry> = {};
  if (version === 2 && isRecord(input.links)) {
    for (const [rel, v] of Object.entries(input.links)) {
      links[rel] = { target: (v as { target: string }).target, mode: (v as { mode: ProjectionLinkMode }).mode };
    }
  }
  return success({
    schema_version: 2,
    asset_version: input.asset_version as string,
    applied_at: input.applied_at as string,
    files: input.files as Record<string, { sha256: string }>,
    links,
  });
}
