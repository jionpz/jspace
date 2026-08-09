// adapters/harness/registry.ts — capabilities registry (single source of truth
// for harness support). Loads the generated module (embedded in the compiled
// binary via the import graph), resolves each capability's `name` from its key,
// validates it once at module load, and exposes lookups. `getCapability` fails
// on an unknown harness — the same "loud" contract the old argv switch had, so
// consumers never silently no-op on a typo.
import { fail } from "../../core/shared/errors.ts";
import { CAPABILITIES } from "./capabilities.generated.ts";
import type { HarnessCapabilitiesFile, HarnessCapability } from "./types.ts";

/** Resolve + validate the embedded capabilities file. `name` is derived from the
 *  harness key (single source, not duplicated in the yaml); a violation is a
 *  build-time bug (the file is generated from capabilities.yaml) and fails the
 *  process at module load rather than surfacing partial data. */
function resolveCaps(raw: HarnessCapabilitiesFile): Record<string, HarnessCapability> {
  const harnesses: Record<string, HarnessCapability> = {};
  for (const [name, data] of Object.entries(raw.harnesses)) {
    if (data.headless === null && data.cron_harness_enum_value !== null) {
      fail(`capabilities: ${name} has no headless CLI but declares a cron enum value`);
    }
    if (data.headless !== null && data.headless.length === 0) {
      fail(`capabilities: ${name} has an empty headless prefix`);
    }
    if (data.lifecycle === undefined) {
      fail(`capabilities: ${name} is missing lifecycle grades`);
    }
    harnesses[name] = { ...data, name };
  }
  return harnesses;
}

const HARNESSES = resolveCaps(CAPABILITIES);

export function loadCapabilities(): HarnessCapabilitiesFile {
  return CAPABILITIES;
}

export function getCapability(name: string): HarnessCapability {
  const cap = HARNESSES[name];
  if (!cap) fail(`unsupported harness: ${name}`);
  return cap;
}

/** All capability keys (claude/grok/opencode/pi/cursor/codex). */
export function harnessNames(): string[] {
  return Object.keys(HARNESSES);
}

/** Capability keys valid in cron.json `harness` (headless-capable only). */
export function cronHarnessNames(): string[] {
  return Object.values(HARNESSES)
    .filter((c) => c.cron_harness_enum_value !== null)
    .map((c) => c.cron_harness_enum_value as string);
}

/** Workbench-relative skill projection dirs (per-harness + shared). Derives
 *  application/workspace/manifest.ts SKILL_PROJECTIONS so new projections added
 *  to capabilities.yaml flow into materialization + doctor drift checks. */
export function workbenchProjectionDirs(): string[] {
  const dirs = new Set<string>(CAPABILITIES.shared_workbench_projection);
  for (const cap of Object.values(HARNESSES)) {
    for (const p of cap.workbench_projection) dirs.add(p);
  }
  return [...dirs];
}
