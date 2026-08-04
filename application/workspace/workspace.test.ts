// application/workspace/workspace.test.ts — workspace diff/upgrade fixtures.
// Run: bun test application/workspace/workspace.test.ts
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "./init.ts";
import { workspaceDiff, workspaceUpgrade } from "./workspace.ts";
import { readMarker, writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { ASSETS } from "../../cli/assets.generated.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";

const initDeps = {
  resolvePath,
  expandTilde,
  isCompiled,
  devRoot,
  materialize: materializeTree,
  manifest: BUNDLE_MANIFEST,
};
const upgradeDeps = {
  manifest: BUNDLE_MANIFEST as DistributionManifestV1,
  assets: ASSETS,
  readFile: (p: string): string | null => {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      return null;
    }
  },
  writeFile: (p: string, c: string): void => writeBytesAtomic(p, c),
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jspace-ws-"));
}

function oldWorkbench(root: string, templateVersion = "0.9.0"): void {
  mkdirSync(join(root, ".jspace"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "marker.json"),
    JSON.stringify(
      { schema_version: 1, product: "JSpace", workbench_id: "wb-old", template_version: templateVersion, created_at: "2026-01-01" },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  writeFileSync(join(root, "AGENTS.md"), "OLD AGENTS CONTENT", "utf-8");
}

test("fresh init -> workspace diff is all no-op", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const entries = (data as { entries: { action: string }[] }).entries;
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((e) => e.action === "no-op")).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("modified managed file -> conflict, upgrade refuses by default", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  writeFileSync(join(root, "AGENTS.md"), "USER EDIT", "utf-8");
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const e = (data as { entries: { rel: string; action: string }[] }).entries.find((x) => x.rel === "AGENTS.md");
  expect(e?.action).toBe("conflict");
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, upgradeDeps)).toThrow(/conflict/);
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("USER EDIT");
  rmSync(root, { recursive: true, force: true });
});

test("old fixture (no journal) -> upgrade applies, user content preserved, marker bumped", () => {
  const root = tmp();
  oldWorkbench(root);
  writeFileSync(join(root, "user-note.md"), "keep me", "utf-8");
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(result.lines.some((l) => l.includes("upgraded"))).toBe(true);
  // managed file updated, hub.json created
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).not.toBe("OLD AGENTS CONTENT");
  expect(existsSync(join(root, ".jspace", "hub.json"))).toBe(true);
  // user-owned content untouched
  expect(readFileSync(join(root, "user-note.md"), "utf-8")).toBe("keep me");
  // marker bumped to the bundle version
  expect(readMarker(root).status).toBe("ok");
  if (readMarker(root).status === "ok") {
    expect(readMarker(root).value.template_version).toBe(BUNDLE_MANIFEST.bundle_version);
  }
  // second run is a no-op
  const again = workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(again.lines.some((l) => l.includes("up to date"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("dry-run reports the plan without mutating", () => {
  const root = tmp();
  oldWorkbench(root);
  const before = readFileSync(join(root, "AGENTS.md"), "utf-8");
  const r = workspaceUpgrade(root, { dryRun: true, acceptConflicts: true }, upgradeDeps);
  expect(r.lines.some((l) => l.includes("would upgrade"))).toBe(true);
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe(before);
  expect(existsSync(join(root, ".jspace", "hub.json"))).toBe(false);
  rmSync(root, { recursive: true, force: true });
});

test("modified workbench skill is never overwritten (managed, conflict preserved)", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  const skillRel = "skills/jspace-bootstrap/SKILL.md";
  writeFileSync(join(root, skillRel), "USER SKILL", "utf-8");
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const e = (data as { entries: { rel: string; action: string }[] }).entries.find((x) => x.rel === skillRel);
  expect(e?.action).toBe("conflict"); // visible in diff, never force-overwritten
  workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(readFileSync(join(root, skillRel), "utf-8")).toBe("USER SKILL");
  rmSync(root, { recursive: true, force: true });
});

test("failed apply leaves a journal that --rollback restores", () => {
  const root = tmp();
  oldWorkbench(root);
  const before = readFileSync(join(root, "AGENTS.md"), "utf-8");
  const failing = {
    ...upgradeDeps,
    writeFile: (p: string, c: string): void => {
      if (p.endsWith("AGENTS.md")) throw new Error("injected failure");
      writeBytesAtomic(p, c);
    },
  };
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, failing)).toThrow(/injected failure/);
  // upgrade journal exists with status failed
  const dir = join(root, ".jspace", "state", "upgrades");
  const ids = existsSync(dir) ? readdirSync(dir) : [];
  expect(ids.length).toBe(1);
  // rollback with normal deps restores the original managed content
  workspaceUpgrade(root, { rollbackId: ids[0] }, upgradeDeps);
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe(before);
  const journal = JSON.parse(readFileSync(join(dir, ids[0], "journal.json"), "utf-8"));
  expect(journal.status).toBe("rolled_back");
  rmSync(root, { recursive: true, force: true });
});
