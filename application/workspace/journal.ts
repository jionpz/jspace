// application/workspace/journal.ts — materialization journal (.jspace/state/
// materialized.json, gitignored). Records the last-applied actual file hashes
// so workspace diff can distinguish "bundle updated" from "user modified".
// Written by init and refreshed by upgrade/rollback; absence (old workbench /
// fresh clone) means "no known base". Recovery-critical: a damaged journal
// fails loud with a fix direction — never read as "no base".
//
// v2 (issue #39) carries the projection `links` section alongside `files`:
// the thin-link engine (projections.ts) owns it; per-file writers preserve
// whatever links are recorded so a file-only apply never erases them.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import {
  decodeMaterializedJournal,
  type MaterializedJournalV2,
  type MaterializedLinkEntry,
} from "../../core/contracts/materialized.ts";
import { materializedRels, sha256Of } from "./manifest.ts";
import { safeReadFile } from "./fs-helpers.ts";
import { localDate } from "../time.ts";
import { fail } from "../../core/shared/errors.ts";

export const MATERIALIZED_FILE = join(CONFIG_DIR, "state", "materialized.json");

export type MaterializedJournal = MaterializedJournalV2;
export type { MaterializedLinkEntry };

export function readMaterializedJournal(root: string): MaterializedJournal | null {
  const p = join(root, MATERIALIZED_FILE);
  const raw = safeReadFile(p);
  if (raw === null) return null; // absent = no known base (old workbench / fresh clone)
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`materialized journal ${p} is not valid JSON (${(e as Error).message}); repair it or run "jspace workspace upgrade" to restore`);
  }
  const d = decodeMaterializedJournal(parsed);
  if (!d.ok) {
    fail(`materialized journal ${p} is damaged: ${d.issues.map((i) => i.message).join("; ")}; repair it or run "jspace workspace upgrade" to restore`);
  }
  return d.value;
}

function writeJournal(
  root: string,
  bundleVersion: string,
  files: Record<string, { sha256: string }>,
  links: Record<string, MaterializedLinkEntry>,
): void {
  const j: MaterializedJournal = {
    schema_version: 2,
    asset_version: bundleVersion,
    applied_at: localDate(),
    files,
    links,
  };
  const p = join(root, MATERIALIZED_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeBytesAtomic(p, JSON.stringify(j, null, 2) + "\n");
}

/** Record the actual on-disk hashes of every materialized manifest file. This is
 *  accurate after init, upgrade and rollback alike (reads the tree, not the
 *  manifest). Files that are missing are omitted. `links` is the projection
 *  engine's result (init supplies it fresh; omitted = keep none). */
export function writeActualMaterializedJournal(
  root: string,
  manifest: DistributionManifestV1,
  links: Record<string, MaterializedLinkEntry> = {},
): void {
  const files: Record<string, { sha256: string }> = {};
  for (const f of manifest.files) {
    for (const rel of materializedRels(f.path)) {
      const content = safeReadFile(join(root, rel));
      if (content !== null) files[rel] = { sha256: sha256Of(content) };
    }
  }
  writeJournal(root, manifest.bundle_version, files, links);
}

/** Write an updated journal after an upgrade/rollback. Only files the upgrade
 *  actually wrote (create/update/migrate) refresh their recorded base to the
 *  on-disk hash. Preserved files (skipped because the user modified them, or of
 *  unknown origin with no prior record) keep their prior recorded base — a
 *  preserved edit is never promoted to the applied base, so a later upgrade
 *  cannot mistake it for "unmodified since last apply" and refresh it away.
 *  A file with no prior record stays unrecorded (unknown origin, preserved on
 *  every upgrade). Recorded links are carried over verbatim: the projection
 *  engine rewrites them through `writeJournalLinks` after its own apply. */
export function writeUpdatedMaterializedJournal(
  root: string,
  manifest: DistributionManifestV1,
  appliedRels: ReadonlySet<string>,
): void {
  const prior = readMaterializedJournal(root);
  const files: Record<string, { sha256: string }> = {};
  for (const f of manifest.files) {
    for (const rel of materializedRels(f.path)) {
      if (appliedRels.has(rel)) {
        const content = safeReadFile(join(root, rel));
        if (content !== null) files[rel] = { sha256: sha256Of(content) };
        continue;
      }
      if (prior?.files[rel] !== undefined) files[rel] = prior.files[rel];
    }
  }
  writeJournal(root, manifest.bundle_version, files, prior?.links ?? {});
}

/** Replace only the journal's links section (thin-link engine apply). Files and
 *  asset_version are carried from the current journal; when none exists yet the
 *  files map stays empty (init writes the full journal right after). */
export function writeJournalLinks(
  root: string,
  bundleVersion: string,
  links: Record<string, MaterializedLinkEntry>,
): void {
  const prior = readMaterializedJournal(root);
  writeJournal(root, bundleVersion, prior?.files ?? {}, links);
}
