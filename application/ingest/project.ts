// application/ingest/project.ts — resolve a stable project id for asset-ingest.
// Uses a registered hub project id when the caller names one; otherwise derives
// a stable id and signals it was not registered (caller should prompt to
// register). This keeps filehub path, index and gbrain slug on one id.
import type { HubV4 } from "../../core/contracts/hub.ts";
import { sha256Of } from "../workspace/manifest.ts";

export interface ProjectResolution {
  id: string;
  registered: boolean;
}

/** Derive a stable id from a freeform name. Latin names kebab-case cleanly;
 *  non-ASCII names (e.g. CJK) get a stable content-hash suffix so distinct
 *  names never collide on the fallback owner id. Empty falls back to "jspace". */
export function deriveProjectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug) return slug;
  if (name.trim().length === 0) return "jspace";
  return `p-${sha256Of(name).slice(0, 8)}`;
}

/** Registered id when hub declares a project with that id; else derived. */
export function resolveProjectId(hub: HubV4 | null, name: string): ProjectResolution {
  const id = (name ?? "").trim();
  if (id && hub && Array.isArray(hub.projects) && hub.projects.some((p) => p.id === id)) {
    return { id, registered: true };
  }
  return { id: deriveProjectId(id || "jspace"), registered: false };
}
