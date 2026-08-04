// application/registry/filehub-lookup.ts — shared filehub root resolution.
// The one place that reads the effective registry and answers "where is the
// registered filehub root"; every consumer (inbox, cron pending scan, ingest
// use cases) uses it instead of inlining the same resolution.
import { existsSync } from "node:fs";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../core/registry/effective.ts";

/** Resolve the registered filehub root (type:filehub resource primary path), or
 *  null when unregistered / unbound. */
export function resolveFilehubRoot(root: string): string | null {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok") return null;
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  return primaryPathForResourceType(effective, "filehub");
}
