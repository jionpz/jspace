// application/workspace/journal.test.ts — recovery-critical journal read
// policy: a damaged materialized / upgrade journal FAILS LOUD (never reads as
// "no base" / "nothing to roll back"); only a genuinely missing file is null.
// Run: bun test application/workspace/journal.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMaterializedJournal, writeActualMaterializedJournal, MATERIALIZED_FILE } from "./journal.ts";
import { workspaceUpgrade } from "./workspace.ts";
import { CliError } from "../../core/shared/errors.ts";
import { sha256Of } from "./manifest.ts";

function wb(): string {
  return mkdtempSync(join(tmpdir(), "jspace-mat-"));
}

function writeFile(p: string, content: string): void {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf-8");
}

const validJournal = () =>
  JSON.stringify({ schema_version: 1, asset_version: "v1.0.5", applied_at: "2026-08-04", files: { "AGENTS.md": { sha256: "abc" } } });

test("readMaterializedJournal: missing -> null (no known base); valid -> value; damaged -> fail loud", () => {
  const root = wb();
  expect(readMaterializedJournal(root)).toBeNull(); // absence is "no known base", not damage

  writeFile(join(root, MATERIALIZED_FILE), validJournal());
  expect(readMaterializedJournal(root)?.asset_version).toBe("v1.0.5");

  writeFile(join(root, MATERIALIZED_FILE), "{ not json");
  expect(() => readMaterializedJournal(root)).toThrow(CliError); // never silently null
  expect(() => readMaterializedJournal(root)).toThrow(/materialized\.json/);

  writeFile(join(root, MATERIALIZED_FILE), JSON.stringify({ schema_version: 3, asset_version: "v3", applied_at: "x", files: {} }));
  expect(() => readMaterializedJournal(root)).toThrow(/damaged/);
  rmSync(root, { recursive: true, force: true });
});

function writeMarker(root: string): void {
  writeFile(
    join(root, ".jspace", "marker.json"),
    JSON.stringify({ schema_version: 1, product: "JSpace", workbench_id: "wb-1", template_version: "1.0.4", created_at: "2026-08-03" }),
  );
}

const emptyDeps = { manifest: { schema_version: 1 as const, bundle_version: "v1.0.5", files: [] }, assets: {}, readFile: () => null, writeFile: () => {} };

test("workspace upgrade rollback: damaged/missing journal fails loud, never a silent no-op", () => {
  const root = wb();
  writeMarker(root);
  const rid = "6f3c5a20-0000-4000-8000-000000000009"; // real rollback ids are UUIDs
  const journalPath = join(root, ".jspace", "state", "upgrades", rid, "journal.json");
  // missing -> explicit error
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: rid }, emptyDeps)).toThrow(/no upgrade journal/);
  // damaged JSON -> explicit error
  writeFile(journalPath, "{ not json");
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: rid }, emptyDeps)).toThrow(/not valid JSON/);
  // invalid shape (wrong version) -> explicit error
  writeFile(journalPath, JSON.stringify({ schema_version: 9, id: rid, from_version: "v1", to_version: "v2", plan: [], status: "applied" }));
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: rid }, emptyDeps)).toThrow(/damaged/);
  rmSync(root, { recursive: true, force: true });
});

test("writeActualMaterializedJournal writes atomically and decodes back", () => {
  const root = wb();
  const manifest = {
    schema_version: 1 as const,
    bundle_version: "v1.0.5",
    files: [{ path: "templates/workbench/AGENTS.md", sha256: "a".repeat(64), ownership: "managed" as const }],
  };
  writeFile(join(root, "AGENTS.md"), "# hi");
  writeActualMaterializedJournal(root, manifest);
  const j = readMaterializedJournal(root);
  expect(j?.asset_version).toBe("v1.0.5");
  expect(j?.files["AGENTS.md"]?.sha256).toBe(sha256Of("# hi"));
  // no temp siblings left by the atomic write (no partial JSON readable as state)
  const stateDir = join(root, ".jspace", "state");
  expect(readdirSync(stateDir).filter((n) => n.includes(".tmp."))).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("upgrade collapses legacy projection copies into dir links (thin-link, issue #39)", () => {
  const root = wb();
  writeMarker(root);
  const content = "skill-body-v2";
  const manifest = {
    schema_version: 1 as const,
    bundle_version: "v1.0.6",
    files: [{ path: "skills/jspace-use/SKILL.md", sha256: sha256Of(content), ownership: "seed" as const }],
  };
  const deps = {
    manifest,
    assets: { "skills/jspace-use/SKILL.md": content },
    readFile: (p: string) => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile: (p: string, c: string) => writeFile(p, c),
  };
  // legacy world: SSOT + a per-file .claude copy + a v1 journal recording both
  writeFile(join(root, ".jspace/skills/jspace-use/SKILL.md"), "old-body");
  mkdirSync(join(root, ".claude/skills/jspace-use"), { recursive: true });
  writeFile(join(root, ".claude/skills/jspace-use/SKILL.md"), "old-body");
  writeFile(
    join(root, MATERIALIZED_FILE),
    JSON.stringify({
      schema_version: 1,
      asset_version: "v1.0.5",
      applied_at: "2026-08-04",
      files: {
        ".jspace/skills/jspace-use/SKILL.md": { sha256: sha256Of("old-body") },
        ".claude/skills/jspace-use/SKILL.md": { sha256: sha256Of("old-body") },
      },
    }),
  );

  const r = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps);

  // SSOT refreshed; legacy copy collapsed into a dir link resolving to it
  expect(readFileSync(join(root, ".jspace/skills/jspace-use/SKILL.md"), "utf-8")).toBe(content);
  expect(realpathSync(join(root, ".claude/skills/jspace-use"))).toBe(realpathSync(join(root, ".jspace/skills/jspace-use")));
  // journal: per-file projection record gone from `files`, link recorded in `links`
  const j = readMaterializedJournal(root)!;
  expect(j.files[".jspace/skills/jspace-use/SKILL.md"]?.sha256).toBe(sha256Of(content));
  expect(j.files[".claude/skills/jspace-use/SKILL.md"]).toBeUndefined();
  expect(j.links[".claude/skills/jspace-use"]?.mode).toBe("link");
  expect(r.lines.some((l) => l.includes("skill projections") && l.includes("dir link"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("upgrade dry-run previews projection ops on a thin-linked workbench: nothing to do", () => {
  const root = wb();
  writeMarker(root);
  const content = "skill-body";
  const manifest = {
    schema_version: 1 as const,
    bundle_version: "v1.0.6",
    files: [{ path: "skills/jspace-use/SKILL.md", sha256: sha256Of(content), ownership: "seed" as const }],
  };
  const deps = {
    manifest,
    assets: { "skills/jspace-use/SKILL.md": content },
    readFile: (p: string) => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile: (_p: string, _c: string) => {},
  };
  writeFile(join(root, ".jspace/skills/jspace-use/SKILL.md"), content);
  for (const proj of [".agents/skills", ".claude/skills", ".grok/skills", ".opencode/skills"]) {
    mkdirSync(join(root, proj), { recursive: true });
    symlinkSync(join(root, ".jspace/skills/jspace-use"), join(root, proj, "jspace-use"), "dir");
  }
  const r = workspaceUpgrade(root, { dryRun: true, acceptConflicts: false }, deps);
  expect(r.lines).toEqual(["jspace: ok: would upgrade: nothing to do"]);
  rmSync(root, { recursive: true, force: true });
});
