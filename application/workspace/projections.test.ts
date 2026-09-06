// application/workspace/projections.test.ts — thin-link projection engine
// (issue #39): plan/apply classification over a real temp tree — create,
// idempotent no-op, collapse of identical legacy copies, keep-divergent,
// Windows git-checkout remnants, dangling links, user-entry safety, and the
// user-level ensureUserSkillLink primitive.
// Run: bun test application/workspace/projections.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProjectionLinks, ensureUserSkillLink, manifestSkillNames, planProjectionLinks } from "./projections.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { sha256Of } from "./manifest.ts";

const PROJECTIONS = [".agents/skills", ".claude/skills"] as const;

function manifestWithSkill(content: string): DistributionManifestV1 {
  return {
    schema_version: 1,
    bundle_version: "1",
    files: [{ path: "skills/jspace-use/SKILL.md", sha256: sha256Of(content), ownership: "seed" }],
  };
}

function makeTree(ssotContent: string): string {
  const root = mkdtempSync(join(tmpdir(), "jspace-proj-"));
  mkdirSync(join(root, ".jspace/skills/jspace-use"), { recursive: true });
  writeFileSync(join(root, ".jspace/skills/jspace-use/SKILL.md"), ssotContent);
  return root;
}

const OPTS = (m: DistributionManifestV1) => ({ skillNames: manifestSkillNames(m), projectionDirs: PROJECTIONS });

test("manifestSkillNames derives the managed set from bundle keys", () => {
  const m = manifestWithSkill("x");
  expect(manifestSkillNames(m)).toEqual(["jspace-use"]);
});

test("fresh workbench: plan is all create; apply creates dir links resolving to SSOT; second run is no-op", () => {
  const root = makeTree("v1");
  const opts = OPTS(manifestWithSkill("v1"));
  const plan = planProjectionLinks(root, opts);
  expect(plan.map((o) => o.action)).toEqual(["create", "create"]);
  expect(plan[0].target).toBe("../../.jspace/skills/jspace-use");

  const r1 = applyProjectionLinks(root, opts);
  expect(Object.keys(r1.links).sort()).toEqual([".agents/skills/jspace-use", ".claude/skills/jspace-use"]);
  expect(r1.lines).toEqual([]); // nothing to report on the happy path
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  expect(readFileSync(join(root, ".claude/skills/jspace-use/SKILL.md"), "utf-8")).toBe("v1");

  const r2 = applyProjectionLinks(root, opts);
  expect(Object.values(r2.links).every((l) => l.mode === "link")).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("legacy identical copy collapses into a link; divergent copy is kept and reported", () => {
  const root = makeTree("v1");
  // identical legacy copy (the pre-thin-link world)
  mkdirSync(join(root, ".claude/skills/jspace-use"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/jspace-use/SKILL.md"), "v1");
  // divergent legacy copy (user edit / stale refresh)
  mkdirSync(join(root, ".agents/skills/jspace-use"), { recursive: true });
  writeFileSync(join(root, ".agents/skills/jspace-use/SKILL.md"), "user-edit");

  const plan = planProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(plan.find((o) => o.rel === ".claude/skills/jspace-use")?.action).toBe("collapse");
  expect(plan.find((o) => o.rel === ".agents/skills/jspace-use")?.action).toBe("keep-divergent");

  const r = applyProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  expect(r.links[".agents/skills/jspace-use"]?.mode).toBe("copy");
  expect(r.lines.some((l) => l.includes(".agents/skills/jspace-use") && l.includes("kept as copy"))).toBe(true);
  // the divergent copy's content is untouched on disk
  expect(readFileSync(join(root, ".agents/skills/jspace-use/SKILL.md"), "utf-8")).toBe("user-edit");
  rmSync(root, { recursive: true, force: true });
});

test("copy with an unmanaged extra file is kept (never collapses user files away)", () => {
  const root = makeTree("v1");
  mkdirSync(join(root, ".claude/skills/jspace-use"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/jspace-use/SKILL.md"), "v1");
  writeFileSync(join(root, ".claude/skills/jspace-use/my-notes.md"), "user content");
  const plan = planProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(plan.find((o) => o.rel === ".claude/skills/jspace-use")?.action).toBe("keep-divergent");
  rmSync(root, { recursive: true, force: true });
});

test("a regular file where the link belongs (Windows git-checkout remnant) is replaced", () => {
  const root = makeTree("v1");
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/jspace-use"), "../../.jspace/skills/jspace-use");
  const r = applyProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  expect(r.links[".claude/skills/jspace-use"]).toBeDefined();
  rmSync(root, { recursive: true, force: true });
});

test("dangling symlink classifies as relink and is repaired", () => {
  const root = makeTree("v1");
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  symlinkSync("../../.jspace/skills/gone-skill", join(root, ".claude/skills/jspace-use"), "dir");
  const plan = planProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(plan.find((o) => o.rel === ".claude/skills/jspace-use")?.action).toBe("relink");
  applyProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  rmSync(root, { recursive: true, force: true });
});

test("user-created entries in a projection root are untouched; empty retired dirs are swept", () => {
  const root = makeTree("v1");
  mkdirSync(join(root, ".claude/skills/my-own"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/my-own/SKILL.md"), "user skill");
  mkdirSync(join(root, ".claude/skills/jspace-bootstrap"), { recursive: true }); // empty residue
  applyProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(readFileSync(join(root, ".claude/skills/my-own/SKILL.md"), "utf-8")).toBe("user skill");
  const leftovers = readdirSync(join(root, ".claude/skills"));
  expect(leftovers).toContain("my-own");
  expect(leftovers).not.toContain("jspace-bootstrap");
  rmSync(root, { recursive: true, force: true });
});

test("an emptied legacy copy dir (post remove-machinery) is adopted as a link, not kept as divergent", () => {
  const root = makeTree("v1");
  mkdirSync(join(root, ".claude/skills/jspace-use"), { recursive: true }); // empty residue
  const plan = planProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(plan.find((o) => o.rel === ".claude/skills/jspace-use")?.action).toBe("collapse");
  const r = applyProjectionLinks(root, OPTS(manifestWithSkill("v1")));
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  expect(r.lines).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("ensureUserSkillLink: create, no-op, and divergent keep (never destroyed)", () => {
  const ssot = join(mkdtempSync(join(tmpdir(), "jspace-ul-")), "wb", ".jspace/skills/jspace-use");
  mkdirSync(ssot, { recursive: true });
  writeFileSync(join(ssot, "SKILL.md"), "v1");
  const home = mkdtempSync(join(tmpdir(), "jspace-ul-home-"));
  const entry = join(home, ".agents/skills/jspace-use");

  const r1 = ensureUserSkillLink(entry, ssot);
  expect(r1.mode).toBe("link");
  expect(r1.changed).toBe(true);
  expect(realpathSync(entry)).toBe(realpathSync(ssot));

  const r2 = ensureUserSkillLink(entry, ssot);
  expect(r2).toEqual({ mode: "link", changed: false, divergent: false });

  // divergent real dir where the link belongs: kept, reported, never deleted
  rmSync(entry);
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, "SKILL.md"), "user-edit");
  const r3 = ensureUserSkillLink(entry, ssot);
  expect(r3.divergent).toBe(true);
  expect(readFileSync(join(entry, "SKILL.md"), "utf-8")).toBe("user-edit");
  rmSync(home, { recursive: true, force: true });
});
