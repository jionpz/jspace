// core/contracts/paths.ts — pure portable-path helpers. No node:path, no
// filesystem access: decoders must stay platform-neutral and deterministic.
// Portable state uses `/` separators, relative paths, and forbids traversal.

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\/;

/** Absolute-path test covering POSIX and Windows forms without importing node:path. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || WINDOWS_DRIVE.test(p) || WINDOWS_UNC.test(p);
}

/** Normalize a portable path for writing: force `/` and collapse `//`. */
export function normalizePortablePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/** Human messages describing every portability violation in a path. */
export function portabilityIssues(p: string): string[] {
  const out: string[] = [];
  if (p.length === 0) out.push("must not be empty");
  if (isAbsolutePath(p)) out.push("must be a relative path");
  if (p.includes("\\")) out.push("must use / separators");
  if (p.split("/").some((s) => s === "." || s === "..")) {
    out.push("must not contain . or .. segments");
  }
  return out;
}
