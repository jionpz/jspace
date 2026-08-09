// adapters/harness/pi.ts — Pi harness adapter. Pi has no Claude-style hooks
// (hook_format: none); gbrain access goes through the CLI or the pi-mcp-adapter
// extension (P4 documents the install path + honest boundaries). Only the
// headless argv is implemented here.
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("pi");

export const piAdapter: HarnessAdapter = {
  name: "pi",
  capability,
  headlessArgv(prompt, _platform, bin) {
    return [bin, "-p", prompt];
  },
};
