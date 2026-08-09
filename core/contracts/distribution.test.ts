// core/contracts/distribution.test.ts — pure decode tests for the distribution
// manifest schema; see core/contracts/distribution.ts for the contract.
// Run: bun test core/contracts/distribution.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeDistributionManifest, type DistributionManifestV1 } from "./distribution.ts";

function validManifest(): DistributionManifestV1 {
  return {
    schema_version: 1,
    bundle_version: "1.0.3",
    files: [
      { path: "cli/main.ts", sha256: "a".repeat(64), ownership: "managed" },
      { path: "templates/workbench/README.md", sha256: "b".repeat(64), ownership: "seed" },
      { path: "workspace/notes.md", sha256: "c".repeat(64), ownership: "user" },
    ],
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeDistributionManifest(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid manifest decodes ok and round-trips", () => {
  const manifest = validManifest();
  const result = decodeDistributionManifest(JSON.parse(JSON.stringify(manifest)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(manifest);
});

test("version must be 1 and bundle_version required", () => {
  expectIssue({ ...validManifest(), schema_version: 2 }, "manifest.version.unsupported");
  expectIssue({ schema_version: 1, files: [] }, "manifest.bundle_version.invalid");
});

test("files must be an array", () => {
  expectIssue({ ...validManifest(), files: "nope" }, "manifest.files.type");
});

test("file path is a portable relative path", () => {
  expectIssue({ ...validManifest(), files: [{ path: "/abs", sha256: "a".repeat(64), ownership: "managed" }] }, "manifest.file.path.invalid");
  expectIssue({ ...validManifest(), files: [{ path: "../up", sha256: "a".repeat(64), ownership: "managed" }] }, "manifest.file.path.invalid");
  expectIssue({ ...validManifest(), files: [{ path: "a\\b", sha256: "a".repeat(64), ownership: "managed" }] }, "manifest.file.path.invalid");
});

test("sha256 must be a 64-char hex digest", () => {
  expectIssue({ ...validManifest(), files: [{ path: "x", sha256: "short", ownership: "managed" }] }, "manifest.file.sha256.invalid");
  expectIssue({ ...validManifest(), files: [{ path: "x", sha256: "z".repeat(64), ownership: "managed" }] }, "manifest.file.sha256.invalid");
});

test("ownership must be one of managed|seed|user", () => {
  expectIssue({ ...validManifest(), files: [{ path: "x", sha256: "a".repeat(64), ownership: "system" }] }, "manifest.file.ownership.invalid");
});

test("unknown fields are rejected", () => {
  expectIssue({ ...validManifest(), extra: 1 }, "manifest.unknown-field");
  expectIssue({ ...validManifest(), files: [{ path: "x", sha256: "a".repeat(64), ownership: "managed", size: 4 }] }, "manifest.file.unknown-field");
});
