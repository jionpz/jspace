// adapters/harness/registry.ts — capabilities registry (single source of truth
// for harness support). Loads the generated module (embedded in the compiled
// binary via the import graph), resolves each capability's `name` from its key,
// validates it once at module load, and exposes lookups. `getCapability` fails
// on an unknown harness — the same "loud" contract the old argv switch had, so
// consumers never silently no-op on a typo.
import { fail } from "../../core/shared/errors.ts";
import { CAPABILITIES } from "./capabilities.generated.ts";
import type { HarnessCapabilitiesFile, HarnessCapability } from "./types.ts";

const GLOBAL_CONTEXT_KINDS = ["symlink", "symlink-or-import", "manual", "unverified"] as const;
const FILE_GLOBAL_CONTEXT_KINDS = new Set<string>(["symlink", "symlink-or-import"]);

/** Resolve + validate the embedded capabilities file. `name` is derived from the
 *  harness key (single source, not duplicated in the yaml); a violation is a
 *  build-time bug (the file is generated from capabilities.yaml) and fails the
 *  process at module load rather than surfacing partial data. */
export function resolveCapabilities(raw: HarnessCapabilitiesFile): Record<string, HarnessCapability> {
  validateGlobalGovernance(raw);
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
    if (hasPermission && data.argv_flags?.tools_value === undefined) {
      fail(`capabilities: ${name} declares argv_flags.permission without argv_flags.tools_value`);
    }
    if (data.argv_flags?.output !== undefined && data.argv_flags.output_value === undefined) {
      fail(`capabilities: ${name} declares argv_flags.output without argv_flags.output_value`);
    }
    if (data.cron_env === undefined) {
      fail(`capabilities: ${name} is missing cron_env declaration`);
    }
    validateGlobalContext(name, data.global_context);
    const mcpConfig = data.mcp_config;
    if (mcpConfig !== null) {
      if (!(MCP_WRITERS as readonly string[]).includes(mcpConfig.writer)) {
        fail(`capabilities: ${name} has unknown mcp_config.writer: ${mcpConfig.writer}`);
      }
      const expectsToml = mcpConfig.writer === "existing-server-env-toml";
      if (expectsToml !== (mcpConfig.format === "toml")) {
        fail(`capabilities: ${name} mcp_config.writer ${mcpConfig.writer} is incompatible with format ${mcpConfig.format}`);
      }
    }
    harnesses[name] = { ...data, name };
  }
  return harnesses;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateGlobalGovernance(raw: HarnessCapabilitiesFile): void {
  const governance: unknown = raw.global_governance;
  if (!isRecord(governance)) {
    fail("capabilities: missing global_governance declaration");
  }
  if (typeof governance.source !== "string" || governance.source.trim() === "") {
    fail("capabilities: global_governance.source must be a non-empty string");
  }
  if (
    !Array.isArray(governance.required_headings) ||
    governance.required_headings.length === 0 ||
    governance.required_headings.some((heading) => typeof heading !== "string" || heading.trim() === "")
  ) {
    fail("capabilities: global_governance.required_headings must be a non-empty string array");
  }
}

function validateGlobalContext(name: string, value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    fail(`capabilities: ${name} global_context must be an object`);
  }
  if (typeof value.kind !== "string" || !(GLOBAL_CONTEXT_KINDS as readonly string[]).includes(value.kind)) {
    fail(`capabilities: ${name} has unknown global_context.kind: ${String(value.kind)}`);
  }
  const fileBased = FILE_GLOBAL_CONTEXT_KINDS.has(value.kind);
  if (fileBased && (typeof value.path !== "string" || value.path.trim() === "")) {
    fail(`capabilities: ${name} global_context kind ${value.kind} requires a non-empty path`);
  }
  if (!fileBased && value.path !== undefined) {
    fail(`capabilities: ${name} global_context kind ${value.kind} must not declare a path`);
  }
  if (value.override_path !== undefined && (typeof value.override_path !== "string" || value.override_path.trim() === "")) {
    fail(`capabilities: ${name} global_context.override_path must be a non-empty string when declared`);
  }
}

const MCP_WRITERS = [
  "existing-server-env-json",
  "existing-server-env-toml",
  "merge-json-server",
  "merge-opencode-local",
] as const;

const HARNESSES = resolveCapabilities(CAPABILITIES);

export function loadCapabilities(): HarnessCapabilitiesFile {
  return CAPABILITIES;
}

/** Wire-capable harness keys, derived from the declared machine MCP config.
 *  Codex is cron-only because it has no `mcp_config`; cursor remains wire-capable
 *  even though it is not headless-capable. Order follows capabilities.yaml. */
export function wireHarnessNamesFrom(caps: HarnessCapabilitiesFile): string[] {
  return Object.entries(caps.harnesses)
    .filter(([, cap]) => cap.mcp_config !== null)
    .map(([name]) => name);
}

/** Cron-capable harness enum values, sorted for stable CLI help. The value is
 *  declared explicitly because cron.json names may differ from capability keys. */
export function cronHarnessNamesFrom(caps: HarnessCapabilitiesFile): string[] {
  return Object.values(caps.harnesses)
    .map((cap) => cap.cron_harness_enum_value)
    .filter((name): name is string => name !== null)
    .sort();
}

/** Harness keys with human-facing harness docs. */
export function documentedHarnessNamesFrom(caps: HarnessCapabilitiesFile): string[] {
  return Object.entries(caps.harnesses)
    .filter(([, cap]) => cap.documented)
    .map(([name]) => name);
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

/** Session harness keys accepted by `harness wire` (declared MCP config only). */
export function wireHarnessNames(): string[] {
  return wireHarnessNamesFrom(CAPABILITIES);
}

/** Cron harness keys valid in cron.json `harness` (headless-capable only). */
export function cronHarnessNames(): string[] {
  return cronHarnessNamesFrom(CAPABILITIES);
}

/** Harness keys that have a human-facing harness-<name>.md reference. */
export function documentedHarnessNames(): string[] {
  return documentedHarnessNamesFrom(CAPABILITIES);
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
