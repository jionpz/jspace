// scripts/manifest-integrity.test.ts — committed bundle source-integrity net
// (issue #7 P1.8): local `bun test` must catch the issue-#6 bug class (a
// manifest-declared template source that went missing / got dropped) without
// waiting for a CI run. Pure filesystem checks only — the git-tracked half
// (git ls-files / check-ignore) needs a git context and lives in
// scripts/check-manifest-integrity.ts (CI runs it before gen-assets).
// Run: bun test scripts/manifest-integrity.test.ts
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect } from "bun:test";
import { manifestPaths } from "./asset-integrity.ts";
import { ASSETS } from "../cli/assets.generated.ts";
import { BUNDLE_MANIFEST } from "../cli/manifest.generated.ts";
import { sha256Of } from "../application/workspace/manifest.ts";

const ROOT = resolve(import.meta.dir, "..");

test("every manifest path exists on disk (issue #6 bug class)", () => {
  const ts = readFileSync(join(ROOT, "cli/manifest.generated.ts"), "utf-8");
  const paths = manifestPaths(ts);
  expect(paths.length).toBeGreaterThan(0);
  for (const p of paths) {
    expect(existsSync(join(ROOT, p)), p).toBe(true);
  }
});

test("ASSETS keys and manifest file paths are the same set (no drift)", () => {
  const assetKeys = Object.keys(ASSETS).sort();
  const manifestKeys = BUNDLE_MANIFEST.files.map((f) => f.path).sort();
  expect(manifestKeys).toEqual(assetKeys);
});

test("manifest sha256 matches the embedded asset content", () => {
  for (const f of BUNDLE_MANIFEST.files) {
    expect(f.sha256, f.path).toBe(sha256Of(ASSETS[f.path]));
  }
});
