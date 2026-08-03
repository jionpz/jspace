// cli/registry.ts — compatibility facade for existing commands. Schema, decode
// and repository logic live in core/contracts + adapters/fs; this file re-exports
// the typed operations commands need and defines no second schema.
import { isAbsolute, join, relative } from "node:path";
import { fail, rejectErrors } from "./errors.ts";
import { resolvePath } from "./paths.ts";
import { REGISTRY_FILE } from "../core/contracts/files.ts";
export { REGISTRY_FILE };
import { ID_PATTERN, isId } from "../core/contracts/ids.ts";
export { ID_PATTERN, isId };
import { decodeHub, type HubV4 } from "../core/contracts/hub.ts";
import type { LocalStateV1 } from "../core/contracts/local.ts";
import {
  readWorkbenchState,
  PairedWriteError,
  writeHubAndLocal,
  writeHubAtomic,
} from "../adapters/fs/workbench-state.ts";
export { readWorkbenchState, PairedWriteError, writeHubAndLocal, writeHubAtomic };
export type { WorkbenchStateReads } from "../adapters/fs/workbench-state.ts";

export function workbenchRoot(): string {
  return resolvePath(process.cwd());
}

/** Mirrors pathlib child.relative_to(parent) succeeding. */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function cleanTags(tags: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const s = (t ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function findIndex<T extends { id: string }>(records: readonly T[], id: string): number | null {
  for (let i = 0; i < records.length; i++) {
    if (records[i].id === id) return i;
  }
  return null;
}

/** Load the workbench hub as typed state; fails on missing or invalid registry. */
export function loadHub(root: string): HubV4 {
  const reads = readWorkbenchState(root);
  switch (reads.hub.status) {
    case "missing":
      fail(`registry not found: ${join(root, REGISTRY_FILE)}`);
      break;
    case "invalid":
      rejectErrors(reads.hub.issues.map((i) => `${i.message} (${i.code})`));
      break;
    case "ok":
      return reads.hub.value;
  }
  throw new Error("unreachable");
}

/** Load machine-local state, or null when absent (fresh clone). Invalid is blocking. */
export function loadLocal(root: string): LocalStateV1 | null {
  const reads = readWorkbenchState(root);
  switch (reads.local.status) {
    case "missing":
      return null;
    case "invalid":
      rejectErrors(reads.local.issues.map((i) => `${i.message} (${i.code})`));
      break;
    case "ok":
      return reads.local.value;
  }
  throw new Error("unreachable");
}

/** Assert an in-memory typed hub still decodes before a hub-only write. */
export function assertHubValid(hub: HubV4): void {
  const check = decodeHub(hub);
  if (!check.ok) rejectErrors(check.issues.map((i) => i.message));
}
