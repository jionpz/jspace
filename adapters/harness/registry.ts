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
    // Every session harness that declares a session-start event must say where
    // the briefing hook is materialized (issue #13). codex is the compatibility
    // exception — it has no session-start event.
    const hasSessionStart = data.sessions.some((s) => /session.?start/i.test(s.name));
    if (hasSessionStart && data.session_start === undefined) {
      fail(`capabilities: ${name} declares a session-start event but no session_start materialization path`);
    }
    const hasPermission = data.argv_flags?.permission !== undefined;
    if (data.supports_tool_restriction !== hasPermission) {
      fail(`capabilities: ${name} supports_tool_restriction must match argv_flags.permission presence`);
    }
    if (data.cron_env === undefined) {
      fail(`capabilities: ${name} is missing cron_env declaration`);
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

/** Cron harness keys valid in cron.json `harness` (headless-capable only). */
export function cronHarnessNames(): string[] {
  return Object.values(HARNESSES)
    .filter((c) => c.cron_harness_enum_value !== null)
    .map((c) => c.cron_harness_enum_value as string);
}

/** Whether a harness supports per-cron tool restriction (`--tools` / cron.json `tools`). */
export function supportsToolRestriction(harness: string): boolean {
  return getCapability(harness).supports_tool_restriction;
}

/** Fail loud when `tools` is set but the harness cannot honor tool restriction. */
export function assertHarnessSupportsTools(harness: string, tools?: string): void {
  if (tools === undefined || tools.trim() === "") return;
  if (!supportsToolRestriction(harness)) {
    fail(`harness ${harness} does not support --tools (tool restriction is not available for this harness)`);
  }
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
