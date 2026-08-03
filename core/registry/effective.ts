// core/registry/effective.ts — combine already-decoded hub + local into a typed
// effective registry. Path entrypoints are projected to resolved | unbound | missing.
// A path-existence callback is injectable so resolution is deterministic in tests.
import { existsSync } from "node:fs";
import type { Domain, Entrypoint, HubV4, Project, Resource, UrlEntrypoint } from "../contracts/hub.ts";
import type { LocalStateV1 } from "../contracts/local.ts";

export type PathExists = (p: string) => boolean;

export type PathResolution = "resolved" | "unbound" | "missing";

export interface EffectivePathEntrypoint {
  id: string;
  kind: "path";
  binding: string;
  primary?: boolean;
  resolved_path: string | null;
  resolution: PathResolution;
}

export interface EffectiveResource {
  id: string;
  type: string;
  domain: string;
  entrypoints: (EffectivePathEntrypoint | UrlEntrypoint)[];
  tags?: string[];
  notes?: string;
}

export interface EffectiveProject extends Project {}

export interface EffectiveRegistry {
  hub: HubV4;
  local: LocalStateV1 | null;
  domains: Domain[];
  resources: EffectiveResource[];
  projects: EffectiveProject[];
  /** Local binding keys referenced by no resource path entrypoint. */
  unusedBindings: string[];
}

export interface ResolveOptions {
  pathExists?: PathExists;
}

export function resolveEffectiveRegistry(
  hub: HubV4,
  local: LocalStateV1 | null,
  opts: ResolveOptions = {},
): EffectiveRegistry {
  const exists: PathExists = opts.pathExists ?? existsSync;

  const resources: EffectiveResource[] = hub.resources.map((r: Resource) => {
    const entrypoints = r.entrypoints.map((ep: Entrypoint) => {
      if (ep.kind === "url") return ep;
      const value = local?.bindings[ep.binding];
      if (value === undefined) {
        return { ...ep, resolved_path: null, resolution: "unbound" as const };
      }
      return {
        ...ep,
        resolved_path: value,
        resolution: (exists(value) ? "resolved" : "missing") as PathResolution,
      };
    });
    return { ...r, entrypoints };
  });

  const referenced = new Set<string>();
  for (const r of resources) {
    for (const ep of r.entrypoints) {
      if (ep.kind === "path") referenced.add(ep.binding);
    }
  }
  const unusedBindings = local
    ? Object.keys(local.bindings).filter((key) => !referenced.has(key))
    : [];

  return { hub, local, domains: hub.domains, resources, projects: hub.projects, unusedBindings };
}

/**
 * Configured primary path for a resource type, or null when none is usable by a
 * consumer. Resolved and bound-but-missing both return the configured value
 * (consumers existence-check themselves); unbound returns null.
 */
export function primaryPathForResourceType(reg: EffectiveRegistry, type: string): string | null {
  for (const r of reg.resources) {
    if (r.type !== type) continue;
    for (const ep of r.entrypoints) {
      if (ep.kind === "path" && ep.primary === true) {
        return ep.resolution === "unbound" ? null : ep.resolved_path;
      }
    }
  }
  return null;
}

/** Only a path that actually exists on this machine; used for verification. */
export function resolvedPrimaryPathForResourceType(reg: EffectiveRegistry, type: string): string | null {
  for (const r of reg.resources) {
    if (r.type !== type) continue;
    for (const ep of r.entrypoints) {
      if (ep.kind === "path" && ep.primary === true && ep.resolution === "resolved") {
        return ep.resolved_path;
      }
    }
  }
  return null;
}
