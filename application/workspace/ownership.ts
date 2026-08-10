// application/workspace/ownership.ts — bundle ownership rules (pure).
// Split out of manifest.ts so scripts/gen-assets.ts can consume ownership
// without importing the harness registry / capabilities.generated.ts — that
// import chain was a bootstrap loop: with capabilities.generated.ts deleted or
// corrupt, gen-assets could not run to regenerate it (issue #8 #17).
import type { AssetOwnership } from "../../core/contracts/distribution.ts";

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
