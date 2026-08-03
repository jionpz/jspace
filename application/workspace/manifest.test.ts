// application/workspace/manifest.test.ts — bundle manifest ownership/path/freshness.
// Run: bun test application/workspace/manifest.test.ts
import { expect, test } from "bun:test";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { diffBundle, materializedRel, ownershipFor, sha256Of } from "./manifest.ts";

const manifest: DistributionManifestV1 = {
  version: 1,
  bundle_version: "1.0.2",
  files: [
    { path: "templates/workbench/AGENTS.md", sha256: sha256Of("new-agents"), ownership: "managed" },
    { path: "templates/workbench/README.md", sha256: sha256Of("new-readme"), ownership: "managed" },
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

test("ownershipFor and materializedRel map bundle keys", () => {
  expect(ownershipFor("skills/x/SKILL.md")).toBe("seed");
  expect(ownershipFor("templates/workbench/AGENTS.md")).toBe("managed");
  expect(materializedRel("templates/workbench/AGENTS.md")).toBe("AGENTS.md");
  expect(materializedRel("skills/jspace-bootstrap/SKILL.md")).toBe("skills/jspace-bootstrap/SKILL.md");
  expect(materializedRel("templates/filehub/README.md")).toBeNull(); // on-demand, not in workbench
});

test("freshness: matching -> no-op; missing -> create; filehub skipped", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({
      "AGENTS.md": "new-agents",
      "README.md": "new-readme",
      "skills/jspace-bootstrap/SKILL.md": "new-skill",
    }),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("no-op");
  expect(map["README.md"]).toBe("no-op");
  expect(map["skills/jspace-bootstrap/SKILL.md"]).toBe("no-op");
  expect(entries.some((e) => e.rel === "templates/filehub/README.md")).toBe(false);
});

test("recorded base -> update (managed) / skip (seed)", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps(
      { "AGENTS.md": "old-agents", "skills/jspace-bootstrap/SKILL.md": "old-skill" },
      {
        "AGENTS.md": { sha256: sha256Of("old-agents") },
        "skills/jspace-bootstrap/SKILL.md": { sha256: sha256Of("old-skill") },
      },
    ),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("update");
  expect(map["skills/jspace-bootstrap/SKILL.md"]).toBe("skip");
});

test("unrecorded modification -> conflict (managed) / skip (seed)", () => {
  const entries = diffBundle(
    "/wb",
    manifest,
    deps({ "AGENTS.md": "user-edit", "skills/jspace-bootstrap/SKILL.md": "user-edit-skill" }, {}),
  );
  const map = byRel(entries);
  expect(map["AGENTS.md"]).toBe("conflict");
  expect(map["skills/jspace-bootstrap/SKILL.md"]).toBe("skip");
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
