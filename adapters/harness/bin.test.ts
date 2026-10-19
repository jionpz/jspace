// adapters/harness/bin.test.ts — executability probe used to validate an
// explicit $GBRAIN_BIN override before it is written into a harness config.
// Run: bun test adapters/harness/bin.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExecutableFile } from "./bin.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jspace-bin-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("isExecutableFile accepts an existing executable file", () => {
  const bin = join(dir, "gbrain");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  expect(isExecutableFile(bin, process.platform)).toBe(true);
});

test("isExecutableFile rejects a non-executable file on POSIX", () => {
  const plain = join(dir, "not-executable");
  writeFileSync(plain, "content\n");
  chmodSync(plain, 0o644);
  // win32 has no execute bit in stat: a regular file is accepted there.
  expect(isExecutableFile(plain, process.platform)).toBe(process.platform === "win32");
});

test("isExecutableFile rejects a missing path and a directory", () => {
  expect(isExecutableFile(join(dir, "absent"), process.platform)).toBe(false);
  const sub = join(dir, "subdir");
  mkdirSync(sub);
  expect(isExecutableFile(sub, process.platform)).toBe(false);
});

test("isExecutableFile does not follow a symlink to a directory", () => {
  const target = join(dir, "target-dir");
  mkdirSync(target);
  const link = join(dir, "link-to-dir");
  try {
    symlinkSync(target, link, "dir");
  } catch {
    return; // symlink creation can be unavailable (Windows without privileges)
  }
  expect(isExecutableFile(link, process.platform)).toBe(false);
});
