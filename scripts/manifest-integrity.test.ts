// scripts/manifest-integrity.test.ts — committed bundle source-integrity net
// (issue #7 P1.8): local `bun test` must catch the issue-#6 bug class (a
// manifest-declared template source that went missing / got dropped) without
// waiting for a CI run. Reads the pure-JSON twin cli/manifest.json (issue #7
// P3.16) and cross-checks it against the embedded TS BUNDLE_MANIFEST so the
// two never drift. The git-tracked half (git ls-files / check-ignore) needs a
// git context and lives in scripts/check-manifest-integrity.ts (CI runs it
// before gen-assets).
// Run: bun test scripts/manifest-integrity.test.ts
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect } from "bun:test";
import { readManifestJson } from "./asset-integrity.ts";
import { ASSETS } from "../cli/assets.generated.ts";
import { BUNDLE_MANIFEST } from "../cli/manifest.generated.ts";
import { sha256Of } from "../application/workspace/manifest.ts";

const ROOT = resolve(import.meta.dir, "..");

const jsonManifest = readManifestJson(join(ROOT, "cli/manifest.json"));
const jsonPaths = jsonManifest.files.map((f) => f.path);

test("every manifest path exists on disk (issue #6 bug class)", () => {
  expect(jsonPaths.length).toBeGreaterThan(0);
  for (const p of jsonPaths) {
    expect(existsSync(join(ROOT, p)), p).toBe(true);
  }
});

test("manifest.json and the embedded TS BUNDLE_MANIFEST agree (no drift)", () => {
  const tsFiles = BUNDLE_MANIFEST.files.map((f) => ({ path: f.path, sha256: f.sha256, ownership: f.ownership }));
  const jsonFiles = jsonManifest.files.map((f) => ({ ...f, ownership: (f as { ownership?: string }).ownership ?? "seed" }));
  expect(jsonFiles).toEqual(tsFiles);
});

test("manifest paths and ASSETS keys are the same set (no drift)", () => {
  const assetKeys = Object.keys(ASSETS).sort();
  const manifestKeys = [...jsonPaths].sort();
  expect(manifestKeys).toEqual(assetKeys);
});

test("manifest sha256 matches the embedded asset content", () => {
  for (const f of jsonManifest.files) {
    expect(f.sha256, f.path).toBe(sha256Of(ASSETS[f.path]));
  }
});
