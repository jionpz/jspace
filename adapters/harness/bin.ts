// adapters/harness/bin.ts — headless harness binary resolution on PATH.
// win32 uses `where`, POSIX uses `which`; missing binaries fall back to the bare
// harness name (the spawn will fail with a clear error from the OS).
import { spawnSync } from "node:child_process";

/** Resolve a harness binary on PATH (win32 uses `where`, else `which`). */
export function resolveHarnessBin(harness: string, platform: string): string {
  const cmd = platform === "win32" ? "where" : "which";
  const w = spawnSync(cmd, [harness], { encoding: "utf-8" });
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
