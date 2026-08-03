// cli/update.test.ts — pure-function unit tests for self-update logic
// (version comparison, asset mapping, checksum parsing).
// Run: bun test cli/update.test.ts
import { expect, test } from "bun:test";
import {
  compareVersions,
  isDevVersion,
  assetFor,
  sha256Of,
  expectedHash,
} from "./update.ts";

test("compareVersions compares numeric X.Y.Z", () => {
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  expect(compareVersions("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexicographic
  expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
});

test("compareVersions handles v prefix and missing parts", () => {
  expect(compareVersions("v1.0.2", "1.0.2")).toBe(0);
  expect(compareVersions("v1.0.2", "1.0.2")).toBe(0);
  expect(compareVersions("1.0", "1.0.0")).toBe(0); // missing patch = 0
  expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0); // prerelease tail ignored
});

test("isDevVersion detects the build placeholder", () => {
  expect(isDevVersion("0.0.0-dev")).toBe(true);
  expect(isDevVersion("0.0.0")).toBe(true);
  expect(isDevVersion("v1.0.2")).toBe(false);
});

test("assetFor maps platform/arch to release asset names", () => {
  expect(assetFor("darwin", "arm64")).toBe("jspace-macos-arm64");
  expect(assetFor("darwin", "x64")).toBe("jspace-macos-x64");
  expect(assetFor("linux", "arm64")).toBe("jspace-linux-arm64");
  expect(assetFor("linux", "x64")).toBe("jspace-linux-x64");
  expect(assetFor("win32", "arm64")).toBe("jspace-windows-arm64.exe");
  expect(assetFor("win32", "x64")).toBe("jspace-windows-x64.exe");
  expect(() => assetFor("freebsd", "x64")).toThrow();
  expect(() => assetFor("linux", "ia32")).toThrow();
});

test("expectedHash matches the asset column (with * prefix and case)", () => {
  const checksums =
    "aaaa  jspace-linux-x64\nBBBB *jspace-macos-arm64\n";
  expect(expectedHash(checksums, "jspace-linux-x64")).toBe("aaaa");
  expect(expectedHash(checksums, "jspace-macos-arm64")).toBe("bbbb"); // lowercased
  expect(expectedHash(checksums, "jspace-windows-x64.exe")).toBeNull();
});

test("sha256Of produces a 64-hex digest", () => {
  expect(sha256Of(new TextEncoder().encode("jspace"))).toMatch(/^[0-9a-f]{64}$/);
});
