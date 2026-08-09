// adapters/harness/grok.ts — Grok Build harness adapter (T1; bridge per D1/B).
// Hook file generation lands in P2; this adapter only owns the capability-driven
// argv + hook file path shape today.
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("grok");

export const grokAdapter: HarnessAdapter = {
  name: "grok",
  capability,
  headlessArgv(prompt, _platform, bin) {
    const f = capability.argv_flags;
    const argv = [bin, "-p", prompt];
    if (f.output !== undefined) argv.push(f.output, f.output_value!);
    if (f.permission !== undefined) argv.push(f.permission, f.tools_value!);
    return argv;
  },
  // jspace wires grok via .grok/hooks/jspace.json (Grok's native hooks dir; the
  // `.claude/settings.json` compat scan is a fallback, not a second write).
  hookFilePath(workbench) {
    return join(workbench, ".grok", "hooks", "jspace.json");
  },
};
