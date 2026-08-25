// adapters/harness/claude.ts — Claude Code harness adapter (reference wiring).
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("claude");

export const claudeAdapter: HarnessAdapter = {
  name: "claude",
  capability,
  // Shape is pinned by adapters/harness/argv.test.ts (the "automated" claim for
  // claude in the lifecycle/argv matrices): never bypassPermissions, and the
  // whitelist covers the cron batch needs (Bash/Read/Write/Edit + gbrain MCP).
  // The `-p` prefix comes from the capability-declared headless prefix, not a
  // hardcode, so the yaml stays the single source of truth.
  headlessArgv(prompt, _platform, bin, tools) {
    const f = capability.argv_flags;
    // headless non-null for headless-capable harnesses (registry validates).
    const argv = [bin, ...(capability.headless ?? []).slice(1), prompt];
    if (f.output !== undefined) argv.push(f.output, f.output_value!);
    if (f.permission !== undefined) argv.push(f.permission, tools ?? f.tools_value!);
    return argv;
  },
  hookFilePath(workbench) {
    return join(workbench, ".claude", "settings.json");
  },
};
