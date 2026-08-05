// application/workspace/journal.test.ts — recovery-critical journal read
// policy: a damaged materialized / upgrade journal FAILS LOUD (never reads as
// "no base" / "nothing to roll back"); only a genuinely missing file is null.
// Run: bun test application/workspace/journal.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  JSON.stringify({ version: 1, asset_version: "v1.0.5", applied_at: "2026-08-04", files: { "AGENTS.md": { sha256: "abc" } } });

test("readMaterializedJournal: missing -> null (no known base); valid -> value; damaged -> fail loud", () => {
  const root = wb();
  expect(readMaterializedJournal(root)).toBeNull(); // absence is "no known base", not damage

  writeFile(join(root, MATERIALIZED_FILE), validJournal());
  expect(readMaterializedJournal(root)?.asset_version).toBe("v1.0.5");

  writeFile(join(root, MATERIALIZED_FILE), "{ not json");
  expect(() => readMaterializedJournal(root)).toThrow(CliError); // never silently null
  expect(() => readMaterializedJournal(root)).toThrow(/materialized\.json/);

  writeFile(join(root, MATERIALIZED_FILE), JSON.stringify({ version: 2, asset_version: "v2", applied_at: "x", files: {} }));
  expect(() => readMaterializedJournal(root)).toThrow(/damaged/);
  rmSync(root, { recursive: true, force: true });
});

function writeMarker(root: string): void {
  writeFile(
    join(root, ".jspace", "marker.json"),
    JSON.stringify({ schema_version: 1, product: "JSpace", workbench_id: "wb-1", template_version: "1.0.4", created_at: "2026-08-03" }),
  );
}

const emptyDeps = { manifest: { version: 1 as const, bundle_version: "v1.0.5", files: [] }, assets: {}, readFile: () => null, writeFile: () => {} };

test("workspace upgrade rollback: damaged/missing journal fails loud, never a silent no-op", () => {
  const root = wb();
  writeMarker(root);
  const journalPath = join(root, ".jspace", "state", "upgrades", "up-1", "journal.json");
  // missing -> explicit error
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: "up-1" }, emptyDeps)).toThrow(/no upgrade journal/);
  // damaged JSON -> explicit error
  writeFile(journalPath, "{ not json");
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: "up-1" }, emptyDeps)).toThrow(/not valid JSON/);
  // invalid shape (wrong version) -> explicit error
  writeFile(journalPath, JSON.stringify({ version: 9, id: "up-1", from_version: "v1", to_version: "v2", plan: [], status: "applied" }));
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false, rollbackId: "up-1" }, emptyDeps)).toThrow(/damaged/);
  rmSync(root, { recursive: true, force: true });
});

test("writeActualMaterializedJournal writes atomically and decodes back", () => {
  const root = wb();
  const manifest = {
    version: 1 as const,
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
