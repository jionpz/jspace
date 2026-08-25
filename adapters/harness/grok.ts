// adapters/harness/grok.ts — Grok Build harness adapter (bridge: gbrain stays authoritative).
// Hook file generation lands in P2; this adapter only owns the capability-driven
// argv + hook file path shape today.
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("grok");

export const grokAdapter: HarnessAdapter = {
  name: "grok",
  capability,
  headlessArgv(prompt, _platform, bin, tools) {
    const f = capability.argv_flags;
    // `-p` prefix from the capability-declared headless prefix (single source).
    const argv = [bin, ...(capability.headless ?? []).slice(1), prompt];
    if (f.output !== undefined) argv.push(f.output, f.output_value!);
    if (f.permission !== undefined) argv.push(f.permission, tools ?? f.tools_value!);
    return argv;
  },
  // jspace wires grok via .grok/hooks/jspace.json (Grok's native hooks dir; the
  // `.claude/settings.json` compat scan is a fallback, not a second write).
  hookFilePath(workbench) {
    return join(workbench, ".grok", "hooks", "jspace.json");
  },
};
