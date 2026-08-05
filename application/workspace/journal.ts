// application/workspace/journal.ts — materialization journal (.jspace/state/
// materialized.json, gitignored). Records the last-applied actual file hashes
// so workspace diff can distinguish "bundle updated" from "user modified".
// Written by init and refreshed by upgrade/rollback; absence (old workbench /
// fresh clone) means "no known base".
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { materializedRel, sha256Of } from "./manifest.ts";

export const MATERIALIZED_FILE = join(CONFIG_DIR, "state", "materialized.json");

export interface MaterializedJournal {
  version: 1;
  asset_version: string;
  applied_at: string;
  files: Record<string, { sha256: string }>;
}

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeReadFile(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

export function readMaterializedJournal(root: string): MaterializedJournal | null {
  const raw = safeReadFile(join(root, MATERIALIZED_FILE));
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw) as MaterializedJournal;
    if (j.version === 1 && j.files && typeof j.files === "object") return j;
    return null;
  } catch {
    return null;
  }
}

function writeJournal(root: string, bundleVersion: string, files: Record<string, { sha256: string }>): void {
  const j: MaterializedJournal = {
    version: 1,
    asset_version: bundleVersion,
    applied_at: localDate(),
    files,
  };
  const p = join(root, MATERIALIZED_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(j, null, 2) + "\n", "utf-8");
}

/** Record the actual on-disk hashes of every materialized manifest file. This is
 *  accurate after init, upgrade and rollback alike (reads the tree, not the
 *  manifest). Files that are missing are omitted. */
export function writeActualMaterializedJournal(root: string, manifest: DistributionManifestV1): void {
  const files: Record<string, { sha256: string }> = {};
  for (const f of manifest.files) {
    const rel = materializedRel(f.path);
    if (rel === null) continue;
    const content = safeReadFile(join(root, rel));
    if (content !== null) files[rel] = { sha256: sha256Of(content) };
  }
  writeJournal(root, manifest.bundle_version, files);
}

/** Write an updated journal after an upgrade/rollback. Only files the upgrade
 *  actually wrote (create/update/migrate) refresh their recorded base to the
 *  on-disk hash. Preserved files (skipped because the user modified them, or of
 *  unknown origin with no prior record) keep their prior recorded base — a
 *  preserved edit is never promoted to the applied base, so a later upgrade
 *  cannot mistake it for "unmodified since last apply" and refresh it away.
 *  A file with no prior record stays unrecorded (unknown origin, preserved on
 *  every upgrade). */
export function writeUpdatedMaterializedJournal(
  root: string,
  manifest: DistributionManifestV1,
  appliedRels: ReadonlySet<string>,
): void {
  const prior = readMaterializedJournal(root)?.files ?? {};
  const files: Record<string, { sha256: string }> = {};
  for (const f of manifest.files) {
    const rel = materializedRel(f.path);
    if (rel === null) continue;
    if (appliedRels.has(rel)) {
      const content = safeReadFile(join(root, rel));
      if (content !== null) files[rel] = { sha256: sha256Of(content) };
      continue;
    }
    if (prior[rel] !== undefined) files[rel] = prior[rel];
  }
  writeJournal(root, manifest.bundle_version, files);
}
