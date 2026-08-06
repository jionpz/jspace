// application/workspace/manifest.ts — bundle manifest ownership rules, path
// mapping and freshness diff (pure; consumed by gen-assets and workspace diff).
import { extractAgentsBlock, JSPACE_BLOCK_START, JSPACE_BLOCK_END } from "./agents-block.ts";
import { join } from "node:path";
import { sha256Of } from "../../core/shared/hash.ts";
export { sha256Of };
import type {
  AssetOwnership,
  DistributionManifestV1,
} from "../../core/contracts/distribution.ts";

/** Ownership by bundle-key prefix. Three tiers drive diff/upgrade:
 *  - seed: user-customizable templates (README/.gitignore/.claude settings +
 *    bundled skills). Upgrade refreshes an unmodified file and preserves a
 *    locally modified one (skip, non-blocking). AGENTS.md is also seed, but
 *    diffBundle special-cases it: JSpace owns only the JSPACE block inside
 *    the user's file, so only the block is ever refreshed (block-update).
 *  - user: user data under .jspace/ (hub.json registry, cron.json definitions).
 *    Upgrade never overwrites them; schema evolution goes through migration.
 *  - managed: reserved force-replace class (currently unused). Upgrade
 *    refreshes and --accept-conflicts force-overwrites a local edit. */
export function ownershipFor(key: string): AssetOwnership {
  if (key.startsWith("skills/")) return "seed";
  if (key.startsWith("templates/workbench/.jspace/")) return "user";
  if (key.startsWith("templates/workbench/")) return "seed";
  return "managed";
}

/** User data files are recreated by upgrade when missing AND this returns true.
 *  hub.json missing = broken registry (doctor errors) -> recreate an empty one
 *  for recovery. cron.json missing = deliberate "no cron" state (the user
 *  deleted the file) -> respect the deletion and never recreate it. */
export function recreateOnMissing(rel: string): boolean {
  return rel !== ".jspace/cron.json";
}

/** Official skill name → workbench-relative path under `.jspace/skills/`. */
export function skillRel(name: string): string {
  return `.jspace/skills/${name}`;
}

/** Official skill name → absolute path rooted at the workbench root. */
export function skillRoot(root: string, name: string): string {
  return join(root, skillRel(name));
}

/** Map a bundle manifest key to the workbench-relative path it materializes to,
 *  or null when the key is not materialized into the workbench (filehub is
 *  created on demand by `filehub init`, not by init/upgrade). */
export function materializedRel(key: string): string | null {
  if (key.startsWith("templates/workbench/")) return key.slice("templates/workbench/".length);
  if (key.startsWith("skills/")) return skillRel(key.slice("skills/".length)); // 官方 skill → .jspace/skills/
  return null;
}

export type DiffAction = "create" | "no-op" | "update" | "conflict" | "skip" | "stale" | "remove" | "block-update" | "migrate";

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
  /** Bundle manifest key -> raw bundled content (embedded ASSETS). Required
   *  for the AGENTS.md block compare; when absent, AGENTS.md is conservatively
   *  left untouched (skip) — never refreshed as a whole file. */
  bundleContent?: (key: string) => string | null;
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
      // user data: hub.json missing -> recreate empty for recovery; cron.json
      // missing -> a deliberate "no cron" state, keep it deleted.
      const keepDeleted = f.ownership === "user" && !recreateOnMissing(rel);
      out.push({
        rel,
        ownership: f.ownership,
        action: keepDeleted ? "skip" : "create",
        reason: keepDeleted ? "user: deletion respected" : "missing",
      });
      continue;
    }
    const currentSha = sha256Of(current);
    const recorded = deps.recorded[rel]?.sha256;
    if (rel === "AGENTS.md") {
      // JSpace owns only the JSPACE block inside AGENTS.md; everything outside
      // belongs to the user. Compare the embedded block against the bundle
      // block and plan a block-only refresh — never a whole-file rewrite.
      const bundleContent = deps.bundleContent?.(f.path) ?? null;
      if (bundleContent === null) {
        out.push({ rel, ownership: f.ownership, action: "skip", reason: "AGENTS.md: block compare unavailable; left untouched", currentSha });
      } else {
        const bundleBlock = extractAgentsBlock(bundleContent);
        if (bundleBlock === null) {
          out.push({ rel, ownership: f.ownership, action: "skip", reason: "bundle AGENTS.md has no JSPACE block", currentSha });
        } else {
          const currentBlock = extractAgentsBlock(current);
          const hasStart = current.includes(JSPACE_BLOCK_START);
          const hasEnd = current.includes(JSPACE_BLOCK_END);
          if (currentBlock === null && (hasStart || hasEnd)) {
            // only one marker present: damaged user file — never mutate it.
            out.push({ rel, ownership: f.ownership, action: "skip", reason: "AGENTS.md: malformed JSPACE block; left untouched", currentSha });
          } else if (currentBlock === bundleBlock) {
            out.push({ rel, ownership: f.ownership, action: "no-op", reason: "up to date (block)", currentSha });
          } else {
            out.push({
              rel,
              ownership: f.ownership,
              action: "block-update",
              reason: currentBlock === null ? "no JSPACE block; embedded on upgrade" : "JSPACE block updated",
              currentSha,
            });
          }
        }
      }
      continue;
    }
    if (currentSha === f.sha256) {
      out.push({ rel, ownership: f.ownership, action: "no-op", reason: "up to date", currentSha });
    } else if (recorded !== undefined && currentSha === recorded) {
      // matches the last applied state -> the bundle moved forward. seed and
      // managed refresh; user never refreshes (data stays on disk).
      const skip = f.ownership === "user";
      out.push({
        rel,
        ownership: f.ownership,
        action: skip ? "skip" : "update",
        reason: skip ? "user: never refresh" : "bundle updated",
        currentSha,
      });
    } else {
      // neither the expected nor the recorded hash -> user modified it. seed
      // and user edits are preserved (skip, non-blocking); only managed edits
      // surface as conflict (force-overwritable via --accept-conflicts).
      const conflict = f.ownership === "managed";
      out.push({
        rel,
        ownership: f.ownership,
        action: conflict ? "conflict" : "skip",
        reason: conflict ? "locally modified" : `${f.ownership}: local content kept`,
        currentSha,
      });
    }
  }
  // recorded but no longer in the bundle: an old seed copy that is unchanged
  // since it was applied can be cleaned up by upgrade (remove); a locally
  // modified one is preserved (stale, reported, never auto-deleted).
  for (const rel of Object.keys(deps.recorded)) {
    if (!manifest.files.some((f) => materializedRel(f.path) === rel)) {
      const cur = deps.readFile(join(root, rel));
      const unmodified = cur !== null && sha256Of(cur) === deps.recorded[rel]?.sha256;
      out.push({
        rel,
        ownership: "managed",
        action: unmodified ? "remove" : "stale",
        reason: unmodified ? "recorded copy no longer in bundle, unmodified; removed on upgrade" : "locally modified; kept",
      });
    }
  }
  return out;
}
