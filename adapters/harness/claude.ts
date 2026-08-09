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
  headlessArgv(prompt, _platform, bin) {
    const f = capability.argv_flags;
    const argv = [bin, "-p", prompt];
    if (f.output !== undefined) argv.push(f.output, f.output_value!);
    if (f.permission !== undefined) argv.push(f.permission, f.tools_value!);
    return argv;
  },
  hookFilePath(workbench) {
    return join(workbench, ".claude", "settings.json");
  },
};
