// adapters/harness/types.ts — HarnessCapability contract.
//
// Field names mirror adapters/harness/capabilities.yaml exactly (snake_case),
// so scripts/gen-assets.ts can render the yaml into
// adapters/harness/capabilities.generated.ts with no key remapping. The compiled
// binary embeds that generated module via the import graph — no yaml at runtime.

export type LifecycleGrade = "automated" | "best_effort" | "manual" | "unsupported";

export type SessionSource = "hook" | "plugin" | "extension";

export interface HarnessSession {
  name: string;
  source: SessionSource;
}

/** Where the session-start briefing hook is materialized. `path` may be a
 *  workbench-relative path (checked under the workbench root) or a `~`-expanded
 *  machine-level path (e.g. Pi extension). `format: file` means file presence is
 *  the wiring signal; `json`/`toml` use `key` as the dot-path/TOML section. */
export interface HarnessSessionStart {
  path: string;
  format: "json" | "toml" | "file";
  key?: string;
}

/** `{ native: true }` (harness-native MCP) or `{ via: "<adapter>" }` (third-party
 *  extension channel, e.g. pi_mcp_adapter). */
export type McpBinding = { native: true } | { via: string };

/** Where a harness keeps its gbrain MCP server config (issue #8 #16 — single
 *  source for `harness wire`/`gbrain wire` and doctor's wiring check; all five
 *  session harnesses have a real wire today). `env_key` overrides the env field
 *  name inside the server object (default "env"; opencode's local-server shape
 *  uses "environment"). `path` may start with `~` (expanded per home dir). */
export type McpConfig = { path: string; format: "json" | "toml"; server_key: string; env_key?: string } | null;

export type NativeMemory = "none" | "full";

export interface HarnessLifecycle {
  session_start: LifecycleGrade;
  session_end: LifecycleGrade;
  fallback: LifecycleGrade;
  crash_recovery: LifecycleGrade;
}

/** Raw capability data as it appears in capabilities.yaml / the generated module
 *  (`name` is the harness key, derived at registry load — not duplicated here). */
export interface HarnessCapabilityData {
  /** Headless invocation prefix; `null` for IDE-only harnesses (no CLI). */
  headless: string[] | null;
  /** Extra flags appended by the adapter (order owned by adapter code). */
  argv_flags: { permission?: string; tools_value?: string; output?: string; output_value?: string };
  /** Session events jspace wires (or plans to wire); source = channel kind. */
  sessions: HarnessSession[];
  /** Where the session-start briefing hook is materialized (optional for
   *  compatibility-only entries such as codex). */
  session_start?: HarnessSessionStart;
  mcp: McpBinding;
  mcp_config: McpConfig;
  /** Workbench-relative skill projection dirs materialized by init/upgrade. */
  workbench_projection: string[];
  /** User-level install paths (doctor reports existence only). */
  user_install: string[];
  /** Hook/plugin channel type, or `none`. */
  hook_format: string | null;
  native_memory: NativeMemory;
  lifecycle: HarnessLifecycle;
  /** Value valid in cron.json `harness`; null for IDE-only harnesses. */
  cron_harness_enum_value: string | null;
  /** false for compatibility-only entries (codex) with no harness-<name>.md doc. */
  documented: boolean;
}

/** A capability with `name` resolved from the harness key (registry output). */
export type HarnessCapability = HarnessCapabilityData & { name: string };

export interface HarnessCapabilitiesFile {
  schema_version: 1;
  shared_workbench_projection: string[];
  harnesses: Record<string, HarnessCapabilityData>;
}

/** Per-harness behavior built on the declared capability. */
export interface HarnessAdapter {
  name: string;
  capability: HarnessCapability;
  /** Assemble the headless argv. `bin` is the resolved binary (override or PATH
   *  resolution); fails for harnesses without a headless CLI. `tools` is an
   *  optional per-cron override of the capability-declared tools (absent → the
   *  harness default). */
  headlessArgv: (prompt: string, platform: string, bin: string, tools?: string) => string[];
  /** Workbench-relative hook/plugin file, or null when hook_format is none. */
  hookFilePath?: (workbench: string) => string | null;
}
