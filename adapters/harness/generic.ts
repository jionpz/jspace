// adapters/harness/generic.ts — capability-driven harness adapter.
//
// Every behavior here is derived from HarnessCapabilityData. Harness-specific
// adapter files are only justified when a harness has behavior that cannot be
// represented safely in capabilities.yaml; the current support set does not.
import { join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { HarnessAdapter, HarnessCapability } from "./types.ts";

/** Build the production adapter for one declared capability. */
export function createAdapter(capability: HarnessCapability): HarnessAdapter {
  const adapter: HarnessAdapter = {
    name: capability.name,
    capability,
    headlessArgv(prompt, _platform, bin, tools) {
      if (capability.headless === null) {
        fail(`${capability.name} has no headless CLI (IDE session harness); cron cannot run headlessly with ${capability.name}`);
      }
      const flags = capability.argv_flags;
      const argv = [bin, ...capability.headless.slice(1), prompt];
      if (flags.output !== undefined) argv.push(flags.output, flags.output_value!);
      if (flags.permission !== undefined) argv.push(flags.permission, tools ?? flags.tools_value!);
      return argv;
    },
  };

  const sessionStartPath = capability.session_start?.path;
  if (sessionStartPath !== undefined && !sessionStartPath.startsWith("~") && !sessionStartPath.startsWith("/")) {
    adapter.hookFilePath = (workbench) => join(workbench, sessionStartPath);
  }
  return adapter;
}
