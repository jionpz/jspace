// adapters/harness/harness.ts — harness adapter set barrel.
// P2–P5 import adapters / registry / types from here; argv.ts stays the thin
// headless-cron entry consumed by execute.ts.
export { harnessArgv } from "./argv.ts";
export { resolveHarnessBin, binaryOnPath } from "./bin.ts";
export * from "./registry.ts";
export * from "./index.ts";
export type {
  HarnessAdapter,
  HarnessCapabilitiesFile,
  HarnessCapability,
  HarnessLifecycle,
  HarnessSession,
  LifecycleGrade,
  McpBinding,
  NativeMemory,
  SessionSource,
} from "./types.ts";
