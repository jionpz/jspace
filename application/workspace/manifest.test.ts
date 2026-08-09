// application/workspace/manifest.test.ts — bundle manifest ownership/path/freshness.
// Run: bun test application/workspace/manifest.test.ts
import { expect, test } from "bun:test";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { JSPACE_BLOCK_END, JSPACE_BLOCK_START } from "./agents-block.ts";
import { diffBundle, materializedRels, ownershipFor, recreateOnMissing, sha256Of, skillRel, skillRoot } from "./manifest.ts";

// AGENTS.md is a JSPACE block template: the bundle file IS the managed block.
// Fixture files carry the block markers so diff/upgrade exercise block semantics.
export const AGENTS_BLOCK = `${JSPACE_BLOCK_START}
# JSpace 工作台 - fixture block body
${JSPACE_BLOCK_END}`;
export const AGENTS_BUNDLE = AGENTS_BLOCK; // template = block (no user content in bundle)

const manifest: DistributionManifestV1 = {
  schema_version: 1,
  bundle_version: "1.0.2",
  files: [
    { path: "templates/workbench/AGENTS.md", sha256: sha256Of(AGENTS_BUNDLE), ownership: "seed" },
    { path: "templates/workbench/README.md", sha256: sha256Of("new-readme"), ownership: "seed" },
    { path: "templates/workbench/.jspace/hub.json", sha256: sha256Of("new-hub"), ownership: "user" },
    { path: "templates/workbench/.jspace/cron.json", sha256: sha256Of("new-cron"), ownership: "user" },
    { path: "skills/jspace-use/SKILL.md", sha256: sha256Of("new-skill"), ownership: "seed" },
    { path: "templates/filehub/README.md", sha256: sha256Of("fh"), ownership: "managed" },
  ],
};

function deps(
  files: Record<string, string>,
  recorded: Record<string, { sha256: string }> = {},
  bundleContent?: (key: string) => string | null,
) {
  return {
    // diffBundle reads join(root, rel); the fixture keys are root-relative.
    readFile: (p: string) => files[p] ?? files[p.replace("/wb/", "")] ?? null,
    recorded,
    bundleContent:
      bundleContent ??
      ((key: string) => (key === "templates/workbench/AGENTS.md" ? AGENTS_BUNDLE : null)),
  };
}

function byRel(entries: ReturnType<typeof diffBundle>): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.rel, e.action]));
}

test("ownershipFor maps bundle keys to the three ownership tiers", () => {
  expect(ownershipFor("templates/workbench/AGENTS.md")).toBe("seed");
  expect(ownershipFor("templates/workbench/README.md")).toBe("seed");
  expect(ownershipFor("templates/workbench/.gitignore")).toBe("seed");
  expect(ownershipFor("templates/workbench/.claude/settings.json")).toBe("seed");
  expect(ownershipFor("templates/workbench/.jspace/hub.json")).toBe("user");
  expect(ownershipFor("templates/workbench/.jspace/cron.json")).toBe("user");
  expect(ownershipFor("skills/jspace-use/SKILL.md")).toBe("seed");
  expect(ownershipFor("templates/filehub/README.md")).toBe("managed"); // not materialized, reserved class
});

test("recreateOnMissing: hub.json recovers, cron.json deletion respected", () => {
  expect(recreateOnMissing(".jspace/hub.json")).toBe(true);
  expect(recreateOnMissing(".jspace/cron.json")).toBe(false);
  expect(recreateOnMissing("AGENTS.md")).toBe(true);
});

test("materializedRels maps workbench + skills to source + harness projections, skips filehub", () => {
  expect(materializedRels("templates/workbench/AGENTS.md")).toEqual(["AGENTS.md"]);
  // projection dirs derive from capabilities.yaml (shared + per-harness); the
  // set now includes grok/opencode projections declared there (P2/P3 wiring).
  expect(materializedRels("skills/jspace-use/SKILL.md").sort()).toEqual([
    ".agents/skills/jspace-use/SKILL.md",
    ".claude/skills/jspace-use/SKILL.md",
    ".grok/skills/jspace-use/SKILL.md",
    `${skillRel("jspace-use")}/SKILL.md`,
    ".opencode/skills/jspace-use/SKILL.md",
  ]);
  expect(materializedRels("templates/filehub/README.md")).toEqual([]); // on-demand, not in workbench
});

test("skillRel / skillRoot resolve official skills under .jspace/skills/", () => {
  expect(skillRel("jspace-use")).toBe(".jspace/skills/jspace-use");
  expect(skillRoot("/wb", "asset-ingest")).toBe("/wb/.jspace/skills/asset-ingest");
  expect(materializedRels("skills/jspace-use/SKILL.md")[0]).toBe(`${skillRel("jspace-use")}/SKILL.md`);
});

test("freshness: matching -> no-op; missing -> create; filehub skipped; both projections no-op", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({
      "AGENTS.md": AGENTS_BLOCK,
      "README.md": "new-readme",
      ".jspace/skills/jspace-use/SKILL.md": "new-skill",
      ".claude/skills/jspace-use/SKILL.md": "new-skill", // projection copy, byte-identical
      ".agents/skills/jspace-use/SKILL.md": "new-skill", // agents projection, byte-identical
      ".jspace/hub.json": "new-hub",
      ".jspace/cron.json": "new-cron",
    }),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("no-op");
  expect(map["README.md"]).toBe("no-op");
  expect(map[".jspace/skills/jspace-use/SKILL.md"]).toBe("no-op");
  expect(map[".claude/skills/jspace-use/SKILL.md"]).toBe("no-op");
  expect(map[".agents/skills/jspace-use/SKILL.md"]).toBe("no-op");
  expect(map[".jspace/hub.json"]).toBe("no-op");
  expect(map[".jspace/cron.json"]).toBe("no-op");
  expect(entries.some((e) => e.rel === "templates/filehub/README.md")).toBe(false);
});

test("recorded base + bundle forward -> seed refreshes (update), both projections", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      {
        "AGENTS.md": "old-agents",
        ".jspace/skills/jspace-use/SKILL.md": "old-skill",
        ".claude/skills/jspace-use/SKILL.md": "old-skill",
        ".agents/skills/jspace-use/SKILL.md": "old-skill",
      },
      {
        "AGENTS.md": { sha256: sha256Of("old-agents") },
        ".jspace/skills/jspace-use/SKILL.md": { sha256: sha256Of("old-skill") },
        ".claude/skills/jspace-use/SKILL.md": { sha256: sha256Of("old-skill") },
        ".agents/skills/jspace-use/SKILL.md": { sha256: sha256Of("old-skill") },
      },
    ),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("block-update"); // legacy file has no block -> embed only, never whole-file refresh
  expect(map[".jspace/skills/jspace-use/SKILL.md"]).toBe("update");
  expect(map[".claude/skills/jspace-use/SKILL.md"]).toBe("update");
  expect(map[".agents/skills/jspace-use/SKILL.md"]).toBe("update");
});

test("harness projection drift: editing one copy never hides the other", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      {
        ".jspace/skills/jspace-use/SKILL.md": "new-skill",
        ".claude/skills/jspace-use/SKILL.md": "user-edit",
        ".agents/skills/jspace-use/SKILL.md": "new-skill",
      },
      {
        ".jspace/skills/jspace-use/SKILL.md": { sha256: sha256Of("new-skill") },
        ".claude/skills/jspace-use/SKILL.md": { sha256: sha256Of("new-skill") },
        ".agents/skills/jspace-use/SKILL.md": { sha256: sha256Of("new-skill") },
      },
    ),
  );
  const map = byRel(entries);
  expect(map[".jspace/skills/jspace-use/SKILL.md"]).toBe("no-op");
  expect(map[".claude/skills/jspace-use/SKILL.md"]).toBe("skip"); // edited copy preserved, source unaffected
  expect(map[".agents/skills/jspace-use/SKILL.md"]).toBe("no-op");
});

test("unrecorded modification -> seed skip (preserved), managed conflict", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      {
        "AGENTS.md": "user-edit",
        ".jspace/skills/jspace-use/SKILL.md": "user-edit-skill",
        ".claude/skills/jspace-use/SKILL.md": "user-edit-skill",
        ".agents/skills/jspace-use/SKILL.md": "user-edit-skill",
      },
      {},
    ),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("block-update"); // no block -> embedded on upgrade, user content preserved
  expect(map[".jspace/skills/jspace-use/SKILL.md"]).toBe("skip");
  expect(map[".claude/skills/jspace-use/SKILL.md"]).toBe("skip");
  expect(map[".agents/skills/jspace-use/SKILL.md"]).toBe("skip");

  // the reserved managed class still surfaces edits as conflict
  const managedManifest: DistributionManifestV1 = {
    schema_version: 1,
    bundle_version: "1",
    files: [{ path: "templates/workbench/.gitignore", sha256: sha256Of("new"), ownership: "managed" }],
  };
  const managed = byRel(diffBundle("/wb", managedManifest, deps({ ".gitignore": "user-edit" }, {})));
  expect(managed[".gitignore"]).toBe("conflict");
});

test("user data: edits and bundle drift are preserved (skip), never refreshed", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      {
        ".jspace/hub.json": "user-hub-data", // edit (differs from bundle + recorded)
        ".jspace/cron.json": "old-cron-data", // matches recorded -> bundle moved forward
      },
      {
        ".jspace/hub.json": { sha256: sha256Of("new-hub") },
        ".jspace/cron.json": { sha256: sha256Of("old-cron-data") },
      },
    ),
  );
  const map = byRel(entries);
  expect(map[".jspace/hub.json"]).toBe("skip"); // user: local content kept
  expect(map[".jspace/cron.json"]).toBe("skip"); // user: never refresh
});

test("user data deletion: hub.json recreated (recovery), cron.json respected", () => {
  const entries = diffBundle("/wb", manifest, deps({}, {}));
  const map = byRel(entries);
  expect(map[".jspace/hub.json"]).toBe("create"); // empty registry recovery
  expect(map[".jspace/cron.json"]).toBe("skip"); // deliberate "no cron" stays deleted
  expect(map["AGENTS.md"]).toBe("create"); // seed template re-created when missing
});

test("AGENTS.md: same block with user edits outside -> no-op (block untouched)", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({
      "AGENTS.md": `# My own header\n\n${AGENTS_BLOCK}\n\n## My notes\n`,
    }),
  );
  expect(byRel(entries)["AGENTS.md"]).toBe("no-op"); // outside-the-block edits never trigger
});

test("AGENTS.md: block differs -> block-update (block only, outside preserved)", () => {
  const staleBlock = AGENTS_BLOCK.replace("# JSpace 工作台 - fixture block body", "# old body");
  const entries = diffBundle("/wb", manifest, deps({ "AGENTS.md": staleBlock }));
  expect(byRel(entries)["AGENTS.md"]).toBe("block-update");
});

test("AGENTS.md: malformed single marker -> skip, never mutated", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({ "AGENTS.md": `# user file\n${JSPACE_BLOCK_START}\nbroken` }),
  );
  expect(byRel(entries)["AGENTS.md"]).toBe("skip");
  expect(entries.find((e) => e.rel === "AGENTS.md")?.reason).toContain("malformed");
});

test("AGENTS.md: bundleContent unavailable -> conservative skip, never whole-file refresh", () => {
  const entries = diffBundle("/wb", manifest, deps({ "AGENTS.md": "user content, no block" }, {}, () => null));
  expect(byRel(entries)["AGENTS.md"]).toBe("skip");
  expect(entries.find((e) => e.rel === "AGENTS.md")?.reason).toContain("unavailable");
});

test("recorded but no longer in bundle -> remove when unmodified, stale when modified", () => {
  // old-file.md: disk content matches the recorded hash (pristine legacy seed) -> remove
  // modified-old.md: disk content differs from recorded (user touched it) -> stale
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      {
        "old-file.md": "OLD",
        "modified-old.md": "USER EDIT",
      },
      {
        "old-file.md": { sha256: sha256Of("OLD") },
        "modified-old.md": { sha256: sha256Of("OLD") },
      },
    ),
  );
  expect(entries.find((e) => e.rel === "old-file.md")?.action).toBe("remove");
  expect(entries.find((e) => e.rel === "modified-old.md")?.action).toBe("stale");
});

test("recorded but no longer in bundle and missing on disk -> stale (nothing to remove)", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      { "AGENTS.md": "new-agents" },
      { "AGENTS.md": { sha256: sha256Of("new-agents") }, "old-file.md": { sha256: "x" } },
    ),
  );
  expect(entries.some((e) => e.rel === "old-file.md" && e.action === "stale")).toBe(true);
});
