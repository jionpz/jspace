// cli/registry.ts — cli-side helpers still needed by legacy cli modules (cron
// until Child C). Business helpers moved to application/ (workspace/state + registry/helpers).
import { resolvePath } from "./paths.ts";
import { ID_PATTERN } from "../core/contracts/ids.ts";
import { readWorkbenchState } from "../adapters/fs/workbench-state.ts";
import { findIndex } from "../application/registry/helpers.ts";

export { ID_PATTERN };
export { readWorkbenchState };
export { findIndex };

export function workbenchRoot(): string {
  return resolvePath(process.cwd());
}
