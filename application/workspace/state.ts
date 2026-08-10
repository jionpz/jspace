// application/workspace/state.ts — typed workbench state access for use cases.
// Use cases consume core contracts + adapters here (moved out of the former cli
// compatibility facade, which has since been removed).
import { join } from "node:path";
import { fail, rejectErrors } from "../../core/shared/errors.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { HUB_FILE } from "../../core/contracts/files.ts";
import { decodeHub, type HubV1 } from "../../core/contracts/hub.ts";
import type { LocalStateV1 } from "../../core/contracts/local.ts";

/** Load the workbench hub as typed state; fails on missing or invalid registry. */
export function loadHub(root: string): HubV1 {
  const reads = readWorkbenchState(root);
  switch (reads.hub.status) {
    case "missing":
      fail(`registry not found: ${join(root, HUB_FILE)}`);
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
export function assertHubValid(hub: HubV1): void {
  const check = decodeHub(hub);
  if (!check.ok) rejectErrors(check.issues.map((i) => i.message));
}

/** Fresh machine-local state for a workbench that has none yet (e.g. a clone). */
export function freshLocal(): LocalStateV1 {
  return { schema_version: 1, installation_id: crypto.randomUUID(), bindings: {} };
}
