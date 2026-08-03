// application/workspace/manifest.ts — bundle manifest ownership rules, path
// mapping and freshness diff (pure; consumed by gen-assets and workspace diff).
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  AssetOwnership,
  DistributionManifestV1,
} from "../../core/contracts/distribution.ts";

export function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Ownership by bundle-key prefix. skills are seed (created once, never
 *  overwritten); everything else from the template is managed. */
export function ownershipFor(rel: string): AssetOwnership {
  if (rel.startsWith("skills/")) return "seed";
  return "managed";
}

/** Map a bundle manifest key to the workbench-relative path it materializes to,
 *  or null when the key is not materialized into the workbench (filehub is
 *  created on demand by `filehub init`, not by init/upgrade). */
export function materializedRel(key: string): string | null {
  if (key.startsWith("templates/workbench/")) return key.slice("templates/workbench/".length);
  if (key.startsWith("skills/")) return key; // skills/<name>/... stays as-is
  return null;
}

export type DiffAction = "create" | "no-op" | "update" | "conflict" | "skip" | "stale";

export interface DiffEntry {
  rel: string;
  ownership: AssetOwnership;
  action: DiffAction;
  reason: string;
  currentSha?: string;
}

export interface DiffDeps {
  /** Read a workbench file's content, or null when missing. */
  readFile: (p: string) => string | null;
  /** Last-applied materialization journal (empty for an old workbench). */
  recorded: Record<string, { sha256: string }>;
}

/** Compare the workbench tree + journal against the bundle manifest.
 *  Pure: takes readFile and recorded via deps, returns entries, mutates nothing. */
export function diffBundle(root: string, manifest: DistributionManifestV1, deps: DiffDeps): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const f of manifest.files) {
    const rel = materializedRel(f.path);
    if (rel === null) continue; // filehub skeleton is checked by filehub init
    const current = deps.readFile(join(root, rel));
    if (current === null) {
      out.push({ rel, ownership: f.ownership, action: "create", reason: "missing" });
      continue;
    }
    const currentSha = sha256Of(current);
    const recorded = deps.recorded[rel]?.sha256;
    if (currentSha === f.sha256) {
      out.push({ rel, ownership: f.ownership, action: "no-op", reason: "up to date", currentSha });
    } else if (recorded !== undefined && currentSha === recorded) {
      // matches the last applied state -> the bundle moved forward; safe to update
      out.push({
        rel,
        ownership: f.ownership,
        action: f.ownership === "seed" ? "skip" : "update",
        reason: f.ownership === "seed" ? "seed: never overwrite" : "bundle updated",
        currentSha,
      });
    } else {
      // neither the expected nor the recorded hash -> user modified it
      out.push({
        rel,
        ownership: f.ownership,
        action: f.ownership === "seed" ? "skip" : "conflict",
        reason: f.ownership === "seed" ? "seed: local content kept" : "locally modified",
        currentSha,
      });
    }
  }
  // recorded but no longer in the bundle -> stale (reported, never auto-deleted)
  for (const rel of Object.keys(deps.recorded)) {
    if (!manifest.files.some((f) => materializedRel(f.path) === rel)) {
      out.push({ rel, ownership: "managed", action: "stale", reason: "no longer in bundle" });
    }
  }
  return out;
}
