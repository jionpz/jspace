// scripts/asset-integrity.ts — pure helpers for the gen-assets source-integrity
// guard (issue #6). A committed generated manifest whose path has no source on
// disk means the bundle holds stale bytes that a fresh clone's gen-assets would
// silently drop — the exact .opencode-plugin-loss bug. These are pure so the
// guard is unit-testable without running the gen-assets side effects.
//
// Intentional removals (e.g. dropping a skill) hit the guard too; rerun with
// GEN_ASSETS_ALLOW_MISSING=1 to regenerate-and-drop the stale entries, then
// commit the regenerated files.

/** Extract the file paths from a committed cli/manifest.generated.ts
 *  (BUNDLE_MANIFEST.files[].path literals). The file is TypeScript, not JSON,
 *  so paths are matched from the generated `{ path: "...", ... }` rows. */
export function manifestPaths(manifestTs: string): string[] {
  const out: string[] = [];
  const re = /\bpath:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(manifestTs)) !== null) out.push(m[1]);
  return out;
}

/** Paths the previous generated manifest declared that the current walk cannot
 *  produce. Non-empty = source files were deleted without regenerating
 *  (silent decay). Deduplicated; order follows the manifest. */
export function staleManifestPaths(oldPaths: string[], newPaths: Iterable<string>): string[] {
  const have = new Set(newPaths);
  return [...new Set(oldPaths)].filter((p) => !have.has(p));
}
