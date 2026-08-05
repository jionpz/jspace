// scripts/clean-bun-build.ts — remove root-level .*.bun-build build residue.
// bun build --compile can leave these gitignored temp dirs behind on crash or
// interrupt; they accumulate. Run before every build so a build never starts
// from a polluted tree. Pure node:fs — safe on Windows (no shell globbing).
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
let removed = 0;
for (const name of readdirSync(repoRoot)) {
  if (name.startsWith(".") && name.endsWith(".bun-build")) {
    rmSync(resolve(repoRoot, name), { recursive: true, force: true });
    removed += 1;
  }
}
if (removed > 0) console.log(`clean-bun-build: removed ${removed} stale .bun-build entr${removed === 1 ? "y" : "ies"}`);
