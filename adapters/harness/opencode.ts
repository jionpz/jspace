// adapters/harness/opencode.ts — OpenCode harness adapter (T2.5; plugin-driven).
// Plugin file materialization lands in P3; this adapter owns the capability-
// driven argv (headless = `opencode run <prompt>`, positional) + plugin path.
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("opencode");

export const opencodeAdapter: HarnessAdapter = {
  name: "opencode",
  capability,
  headlessArgv(prompt, _platform, bin) {
    return [bin, prompt];
  },
  hookFilePath(workbench) {
    return join(workbench, ".opencode", "plugins", "jspace.ts");
  },
};
