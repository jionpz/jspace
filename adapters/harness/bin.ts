// adapters/harness/bin.ts — headless harness binary resolution on PATH.
// win32 uses `where`, POSIX uses `which`; missing binaries fall back to the bare
// harness name (the spawn will fail with a clear error from the OS).
import { spawnSync } from "node:child_process";

/** Cap `which`/`where` so a hung PATH lookup cannot stall doctor / cron argv. */
const RESOLVE_BIN_TIMEOUT_MS = 5_000;

/** Resolve a harness binary on PATH (win32 uses `where`, else `which`). */
export function resolveHarnessBin(harness: string, platform: string): string {
  const cmd = platform === "win32" ? "where" : "which";
  const w = spawnSync(cmd, [harness], { encoding: "utf-8", timeout: RESOLVE_BIN_TIMEOUT_MS });
  return (w.stdout ?? "").trim().split(/\r?\n/)[0] || harness; // win: first line only
}

/** True when the harness binary resolves to a real PATH entry (not the bare-name
 *  fallback). Used by doctor's checkHarness for active headless harnesses. */
export function binaryOnPath(harness: string, platform: string): boolean {
  const resolved = resolveHarnessBin(harness, platform);
  // The fallback returns the bare name (no path separator / no dir); a real
  // `which` result is an absolute or relative path that differs from the name.
  return resolved !== harness;
}
