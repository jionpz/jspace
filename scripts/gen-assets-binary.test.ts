// scripts/gen-assets-binary.test.ts — gen-assets must fail loud on binary assets.
import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const pngPath = join(repoRoot, "skills/jspace-use/_gen-assets-test-binary.png");

afterEach(() => {
  if (existsSync(pngPath)) rmSync(pngPath);
});

test("gen-assets exits non-zero when skills tree contains a binary png fixture", async () => {
  writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "binary");
  const proc = Bun.spawn(["bun", "run", join(repoRoot, "scripts/gen-assets.ts")], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  expect(code).not.toBe(0);
  expect(stderr).toContain("binary assets not supported");
});
