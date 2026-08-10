// scripts/check-manifest-integrity.ts — committed bundle source-integrity guard
// (issue #7 P1.5 + P1.6). Every path the committed cli/manifest.generated.ts
// declares must (1) exist on disk, (2) be git-tracked, and (3) NOT be gitignored.
// The git checks are the root-cause guard for issue #6: a source lost to
// gitignore keeps its bundle bytes until the next regen, and local guards pass
// because the file is still on disk — only a clean clone's CI reds. Checking
// tracked/ignored directly closes that gap locally and in CI.
//
// Run BEFORE any gen-assets (asserts the committed manifest), in CI and locally.
// Run: bun run scripts/check-manifest-integrity.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { manifestPaths } from "./asset-integrity.ts";

const ROOT = resolve(import.meta.dir, "..");

const manifestTs = readFileSync(join(ROOT, "cli/manifest.generated.ts"), "utf-8");
const paths = manifestPaths(manifestTs);
const failures: string[] = [];

for (const p of paths) {
  if (!existsSync(join(ROOT, p))) {
    failures.push(`missing on disk: ${p}`);
    continue;
  }
  // Must be git-tracked (exit 0 = tracked; a gitignored source that never made
  // it into the index has no entry and fails here even though it exists on disk).
  try {
    execSync(`git ls-files --error-unmatch -- ${JSON.stringify(p)}`, { cwd: ROOT, stdio: "pipe" });
  } catch {
    failures.push(`not git-tracked: ${p}`);
  }
  // Must NOT be gitignored (git check-ignore exits 0 when the path is ignored).
  try {
    execSync(`git check-ignore --no-index -q -- ${JSON.stringify(p)}`, { cwd: ROOT, stdio: "pipe" });
    failures.push(`gitignored: ${p}`);
  } catch {
    // exit 1 = not ignored — expected; anything else is also caught here as a
    // non-0 exit but the path is fine (git missing/errors treated as not-ignored
    // so the fs + tracked checks carry the verdict).
  }
}

if (failures.length > 0) {
  console.error("check-manifest-integrity: source-integrity failure(s):");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-manifest-integrity: ${paths.length} manifest path(s) exist on disk, git-tracked, not ignored`);
