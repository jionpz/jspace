// application/registry/known-owners.ts — which project/domain ids this
// workbench actually owns. One place answers "is this id real", so a check that
// validates an owner field cannot silently invent a registry of its own.
import { existsSync } from "node:fs";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { resolveEffectiveRegistry } from "../../core/registry/effective.ts";

export interface KnownOwners {
  projects: string[];
  domains: string[];
}

/** Registered project + domain ids, or null when the registry is unreadable.
 *  Null is "unknown", never "no owners": a broken hub.json must not turn every
 *  owner into a finding. */
export function resolveKnownOwners(root: string): KnownOwners | null {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok") return null;
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  return {
    projects: effective.projects.map((project) => project.id),
    domains: effective.domains.map((domain) => domain.id),
  };
}
