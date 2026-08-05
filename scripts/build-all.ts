// scripts/build-all.ts — build all 6 platform binaries (3 OS x x64/arm64) into
// bin/. Mirrors the GitHub Actions matrix. x64 uses `-baseline` (AVX-less) EXCEPT
// Windows: the baseline bun runtime download is blocked on GH Windows runners, so
// the released windows-x64 binary is the non-baseline `bun-windows-x64` target —
// build-all must produce the SAME target as CI (single authority, AC9).
// Run after `bun run scripts/gen-assets.ts`, or use `bun run build:all`.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

// Remove stale root-level .*.bun-build residue before compiling (same step the
// single-platform build scripts run).
const clean = spawnSync(process.execPath, ["run", "scripts/clean-bun-build.ts"], {
  cwd: repoRoot,
  stdio: ["ignore", "inherit", "inherit"],
});
if (clean.status !== 0) {
  console.error("FAIL clean-bun-build");
  process.exit(1);
}

// Ensure version.generated.ts is fresh (binary must report the current tag).
const gen = spawnSync(process.execPath, ["run", "scripts/gen-version.ts"], {
  cwd: repoRoot,
  stdio: ["ignore", "inherit", "inherit"],
});
if (gen.status !== 0) {
  console.error("FAIL gen-version (cannot determine build version)");
  process.exit(1);
}

// [bun target, output file relative to repo root]
const MATRIX: Array<[string, string]> = [
  ["bun-linux-x64-baseline", "bin/jspace-linux-x64"],
  ["bun-linux-arm64", "bin/jspace-linux-arm64"],
  ["bun-darwin-arm64", "bin/jspace-macos-arm64"],
  ["bun-darwin-x64-baseline", "bin/jspace-macos-x64"],
  ["bun-windows-x64", "bin/jspace-windows-x64.exe"],
  ["bun-windows-arm64", "bin/jspace-windows-arm64.exe"],
];

for (const [target, out] of MATRIX) {
  const res = spawnSync(
    process.execPath,
    [
      "build",
      "--compile",
      resolve(repoRoot, "cli/main.ts"),
      "--minify",
      `--target=${target}`,
      `--outfile=${resolve(repoRoot, out)}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (res.status !== 0) {
    console.error(`FAIL ${target} (exit ${res.status})`);
    process.exitCode = 1;
  } else {
    console.log(`ok ${out}`);
  }
}

// bun build --compile leaves one staging .bun-build per build; remove residue so
// a successful build leaves the repo root clean.
const after = spawnSync(process.execPath, ["run", "scripts/clean-bun-build.ts"], {
  cwd: repoRoot,
  stdio: ["ignore", "inherit", "inherit"],
});
if (after.status !== 0) {
  console.error("FAIL clean-bun-build (post)");
  process.exitCode = 1;
}
