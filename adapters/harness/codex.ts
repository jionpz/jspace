// adapters/harness/codex.ts — Codex harness adapter (cron compatibility entry).
// Not part of the four/five deep-align session harnesses (documented: false);
// kept so the existing cron contract keeps working unchanged.
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("codex");

export const codexAdapter: HarnessAdapter = {
  name: "codex",
  capability,
  headlessArgv(prompt, _platform, bin) {
    return [bin, "exec", prompt];
  },
};
