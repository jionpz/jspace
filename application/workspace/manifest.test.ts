// application/workspace/manifest.test.ts — bundle manifest ownership/path/freshness.
// Run: bun test application/workspace/manifest.test.ts
import { expect, test } from "bun:test";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { diffBundle, materializedRel, ownershipFor, recreateOnMissing, sha256Of } from "./manifest.ts";

const manifest: DistributionManifestV1 = {
  version: 1,
  bundle_version: "1.0.2",
  files: [
    { path: "templates/workbench/AGENTS.md", sha256: sha256Of("new-agents"), ownership: "seed" },
    { path: "templates/workbench/README.md", sha256: sha256Of("new-readme"), ownership: "seed" },
    { path: "templates/workbench/.jspace/hub.json", sha256: sha256Of("new-hub"), ownership: "user" },
    { path: "templates/workbench/.jspace/cron.json", sha256: sha256Of("new-cron"), ownership: "user" },
    { path: "skills/jspace-bootstrap/SKILL.md", sha256: sha256Of("new-skill"), ownership: "seed" },
    { path: "templates/filehub/README.md", sha256: sha256Of("fh"), ownership: "managed" },
  ],
};

function deps(
  files: Record<string, string>,
  recorded: Record<string, { sha256: string }> = {},
) {
  return {
    // diffBundle reads join(root, rel); the fixture keys are root-relative.
    readFile: (p: string) => files[p] ?? files[p.replace("/wb/", "")] ?? null,
    recorded,
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
  expect(ownershipFor("skills/jspace-bootstrap/SKILL.md")).toBe("seed");
  expect(ownershipFor("templates/filehub/README.md")).toBe("managed"); // not materialized, reserved class
});

test("recreateOnMissing: hub.json recovers, cron.json deletion respected", () => {
  expect(recreateOnMissing(".jspace/hub.json")).toBe(true);
  expect(recreateOnMissing(".jspace/cron.json")).toBe(false);
  expect(recreateOnMissing("AGENTS.md")).toBe(true);
});

test("materializedRel maps workbench + skills to .jspace/skills, skips filehub", () => {
  expect(materializedRel("templates/workbench/AGENTS.md")).toBe("AGENTS.md");
  expect(materializedRel("skills/jspace-bootstrap/SKILL.md")).toBe(".jspace/skills/jspace-bootstrap/SKILL.md");
  expect(materializedRel("templates/filehub/README.md")).toBeNull(); // on-demand, not in workbench
});

test("freshness: matching -> no-op; missing -> create; filehub skipped", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({
      "AGENTS.md": "new-agents",
      "README.md": "new-readme",
      ".jspace/skills/jspace-bootstrap/SKILL.md": "new-skill",
      ".jspace/hub.json": "new-hub",
      ".jspace/cron.json": "new-cron",
    }),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("no-op");
  expect(map["README.md"]).toBe("no-op");
  expect(map[".jspace/skills/jspace-bootstrap/SKILL.md"]).toBe("no-op");
  expect(map[".jspace/hub.json"]).toBe("no-op");
  expect(map[".jspace/cron.json"]).toBe("no-op");
  expect(entries.some((e) => e.rel === "templates/filehub/README.md")).toBe(false);
});

test("recorded base + bundle forward -> seed refreshes (update)", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      { "AGENTS.md": "old-agents", ".jspace/skills/jspace-bootstrap/SKILL.md": "old-skill" },
      {
        "AGENTS.md": { sha256: sha256Of("old-agents") },
        ".jspace/skills/jspace-bootstrap/SKILL.md": { sha256: sha256Of("old-skill") },
      },
    ),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("update"); // seed: unmodified -> refreshed
  expect(map[".jspace/skills/jspace-bootstrap/SKILL.md"]).toBe("update");
});

test("unrecorded modification -> seed skip (preserved), managed conflict", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({ "AGENTS.md": "user-edit", ".jspace/skills/jspace-bootstrap/SKILL.md": "user-edit-skill" }, {}),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("skip"); // seed: local content kept, non-blocking
  expect(map[".jspace/skills/jspace-bootstrap/SKILL.md"]).toBe("skip");

  // the reserved managed class still surfaces edits as conflict
  const managedManifest: DistributionManifestV1 = {
    version: 1,
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

test("recorded but no longer in bundle -> stale", () => {
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
