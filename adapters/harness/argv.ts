// adapters/harness/argv.ts — headless harness argv generation (registry-driven).
// The old claude/codex/pi switch is replaced by capabilities.yaml + per-harness
// adapters; the export surface (harnessArgv / resolveHarnessBin) stays stable for
// execute.ts and adapters/harness/argv.test.ts.
import { resolveHarnessBin } from "./bin.ts";
import { getAdapter } from "./index.ts";

export { resolveHarnessBin } from "./bin.ts";

export function harnessArgv(harness: string, prompt: string, platform: string, bin?: string): string[] {
  const resolved = bin ?? resolveHarnessBin(harness, platform);
  return getAdapter(harness).headlessArgv(prompt, platform, resolved);
}
