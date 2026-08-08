// application/skills/install.test.ts — user-level skills install (idempotent, no overwrite).
// Run: bun test application/skills/install.test.ts
import { expect, test } from "bun:test";
import type { InstallDeps } from "./install.ts";
import { installSkills } from "./install.ts";

const FILES: Record<string, string> = {
  "skills/jspace-use/SKILL.md": "# jspace-use",
  "skills/jspace-use/references/gbrain.md": "# gbrain",
  "skills/asset-ingest/SKILL.md": "# asset-ingest",
  "skills/asset-ingest/scripts/extract.py": "print('x')",
  // runtime artifacts that must never be materialized
  "skills/asset-ingest/scripts/__pycache__/extract.cpython-312.pyc": "bc",
};

function mkDeps(over: Partial<InstallDeps> = {}): { deps: InstallDeps; written: Map<string, string>; existed: Set<string> } {
  const written = new Map<string, string>();
  const existed = new Set<string>();
  const deps: InstallDeps = {
    assetKeys: () => Object.keys(FILES),
    assetContent: (k) => FILES[k],
    userSkillsRoot: () => "/home/u/.agents/skills",
    writeFile: (p, c) => written.set(p, c),
    exists: (p) => existed.has(p),
    ...over,
  };
  return { deps, written, existed };
}

test("install: creates all skill files under ~/.agents/skills/<name>/, skips pycache", () => {
  const { deps, written } = mkDeps();
  const r = installSkills(deps, ["jspace-use", "asset-ingest"]);
  expect(r.ok).toBe(true);
  expect(written.has("/home/u/.agents/skills/jspace-use/SKILL.md")).toBe(true);
  expect(written.has("/home/u/.agents/skills/jspace-use/references/gbrain.md")).toBe(true);
  expect(written.has("/home/u/.agents/skills/asset-ingest/scripts/extract.py")).toBe(true);
  // runtime artifacts excluded
  expect([...written.keys()].some((k) => k.includes("__pycache__"))).toBe(false);
  expect([...written.keys()].some((k) => k.endsWith(".pyc"))).toBe(false);
  // per-skill breakdown
  expect(r.skills.find((s) => s.name === "jspace-use")?.created).toContain("references/gbrain.md");
});

test("install: idempotent — existing files skipped, never overwritten", () => {
  const { deps, written, existed } = mkDeps();
  existed.add("/home/u/.agents/skills/jspace-use/SKILL.md");
  const r = installSkills(deps, ["jspace-use"]);
  expect(written.has("/home/u/.agents/skills/jspace-use/SKILL.md")).toBe(false); // not overwritten
  expect(written.has("/home/u/.agents/skills/jspace-use/references/gbrain.md")).toBe(true); // gap filled
  const s = r.skills.find((x) => x.name === "jspace-use");
  expect(s?.skipped).toContain("SKILL.md");
  expect(s?.created).toContain("references/gbrain.md");
});

test("install: dry-run computes without writing", () => {
  const { deps, written } = mkDeps({ dryRun: true });
  const r = installSkills(deps, ["jspace-use"]);
  expect(written.size).toBe(0);
  expect(r.skills[0].created).toContain("SKILL.md"); // would-be created listed
});

test("install: unknown skill contributes nothing", () => {
  const { deps, written } = mkDeps();
  const r = installSkills(deps, ["nope"]);
  expect(r.skills).toHaveLength(1);
  expect(r.skills[0].created).toHaveLength(0);
  expect(written.size).toBe(0);
});
