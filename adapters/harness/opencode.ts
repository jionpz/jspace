// adapters/harness/opencode.ts — OpenCode harness adapter (plugin-driven).
// Plugin file materialization lands in P3; this adapter owns the capability-
// driven argv (headless = `opencode run <prompt>`, positional) + plugin path.
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("opencode");

export const opencodeAdapter: HarnessAdapter = {
  name: "opencode",
  capability,
  // Consume the capability-declared headless prefix (["opencode", "run"]) so the
  // yaml stays the single source of truth; opencode takes the prompt positionally.
  headlessArgv(prompt, _platform, bin) {
    // headless is non-null for headless-capable harnesses (registry validates);
    // ?? [] guards the null type (cursor) even though cursor never reaches here.
    return [bin, ...(capability.headless ?? []).slice(1), prompt];
  },
  hookFilePath(workbench) {
    return join(workbench, ".opencode", "plugins", "jspace.ts");
  },
};
