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
import { sha256Of } from "./manifest.ts";
import type { UpgradeDeps } from "./workspace.ts";

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

/** A workbench with just a marker (no materialized journal), so upgrade treats
 *  unknown content as locally-owned and only applies create paths. */
function markerOnlyWorkbench(root: string, templateVersion = "0.9.0"): void {
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
}

/** Synthetic bundle over explicit paths; exercises the reserved `managed`
 *  force-overwrite path and hub-schema migration, which the real (all-seed/
 *  user) bundle does not cover. */
function syntheticDeps(
  spec: { path: string; content: string; ownership: "managed" | "seed" | "user" }[],
  bundleVersion = "2.0.0",
): UpgradeDeps {
  const manifest: DistributionManifestV1 = {
    version: 1,
    bundle_version: bundleVersion,
    files: spec.map((f) => ({ path: f.path, sha256: sha256Of(f.content), ownership: f.ownership })),
  };
  const assets: Record<string, string> = {};
  for (const f of spec) assets[f.path] = f.content;
  return {
    manifest,
    assets,
    readFile: (p: string): string | null => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile: (p: string, c: string): void => writeBytesAtomic(p, c),
  };
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

test("modified seed file (AGENTS.md) -> skip, upgrade proceeds, edit preserved", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  writeFileSync(join(root, "AGENTS.md"), "USER EDIT", "utf-8");
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const e = (data as { entries: { rel: string; action: string }[] }).entries.find((x) => x.rel === "AGENTS.md");
  expect(e?.action).toBe("skip"); // seed: preserved, non-blocking
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, upgradeDeps);
  expect(result.lines.some((l) => l.includes("up to date"))).toBe(true); // not blocked by the edit
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("USER EDIT");
  rmSync(root, { recursive: true, force: true });
});

test("modified hub.json (user data) -> skip, upgrade proceeds, registry preserved", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  const userHub =
    JSON.stringify(
      { version: "4", domains: [{ id: "dev", path: "workspace/dev", tags: [] }], resources: [], projects: [] },
      null,
      2,
    ) + "\n";
  writeFileSync(join(root, ".jspace", "hub.json"), userHub, "utf-8");
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const e = (data as { entries: { rel: string; action: string }[] }).entries.find((x) => x.rel === ".jspace/hub.json");
  expect(e?.action).toBe("skip"); // user data: never overwritten
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, upgradeDeps);
  expect(result.lines.some((l) => l.includes("up to date"))).toBe(true);
  expect(readFileSync(join(root, ".jspace", "hub.json"), "utf-8")).toBe(userHub);
  rmSync(root, { recursive: true, force: true });
});

test("deleted cron.json is not recreated by upgrade; deleted hub.json is (recovery)", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  rmSync(join(root, ".jspace", "cron.json"));
  rmSync(join(root, ".jspace", "hub.json"));
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(existsSync(join(root, ".jspace", "cron.json"))).toBe(false); // deletion respected
  expect(existsSync(join(root, ".jspace", "hub.json"))).toBe(true); // recovery: empty registry recreated
  expect(result.lines.some((l) => l.includes("upgraded"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("seed edit preserved across successive upgrades (never refreshed once edited)", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  writeFileSync(join(root, "AGENTS.md"), "USER EDIT", "utf-8");
  rmSync(join(root, ".jspace", "hub.json")); // force a plan so the journal updates
  workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, upgradeDeps);
  workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, upgradeDeps);
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("USER EDIT");
  rmSync(root, { recursive: true, force: true });
});

test("--accept-conflicts force-overwrites managed edits, seed edits preserved", () => {
  const root = tmp();
  markerOnlyWorkbench(root);
  writeFileSync(join(root, ".gitignore"), "USER GITIGNORE", "utf-8"); // managed (synthetic)
  writeFileSync(join(root, "AGENTS.md"), "USER AGENTS", "utf-8"); // seed (synthetic)
  const deps = syntheticDeps([
    { path: "templates/workbench/.gitignore", content: "NEW GITIGNORE", ownership: "managed" },
    { path: "templates/workbench/AGENTS.md", content: "NEW AGENTS", ownership: "seed" },
  ]);
  // default: a managed conflict blocks the upgrade
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps)).toThrow(/conflict/);
  // --accept-conflicts: managed overwritten, seed preserved
  workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, deps);
  expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe("NEW GITIGNORE");
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("USER AGENTS");
  rmSync(root, { recursive: true, force: true });
});

test("hub schema gap with no registered migration -> upgrade fails, hub.json untouched", () => {
  const root = tmp();
  markerOnlyWorkbench(root);
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ version: "4", domains: [{ id: "d", path: "workspace/d" }], resources: [], projects: [] }, null, 2) + "\n",
    "utf-8",
  );
  const deps = syntheticDeps([
    {
      path: "templates/workbench/.jspace/hub.json",
      content: JSON.stringify({ version: "5", domains: [], resources: [], projects: [] }),
      ownership: "user",
    },
    { path: "templates/workbench/AGENTS.md", content: "NEW AGENTS", ownership: "seed" },
  ]);
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, deps)).toThrow(/no registered migration/);
  expect(readFileSync(join(root, ".jspace", "hub.json"), "utf-8")).toContain('"version": "4"');
  expect(readFileSync(join(root, ".jspace", "hub.json"), "utf-8")).toContain('"id": "d"'); // user data untouched
  rmSync(root, { recursive: true, force: true });
});

test("dry-run with a no-migration hub gap reports [manual], not a fake [migrate]", () => {
  const root = tmp();
  markerOnlyWorkbench(root);
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ version: "4", domains: [{ id: "d", path: "workspace/d" }], resources: [], projects: [] }, null, 2) + "\n",
    "utf-8",
  );
  const deps = syntheticDeps([
    {
      path: "templates/workbench/.jspace/hub.json",
      content: JSON.stringify({ version: "5", domains: [], resources: [], projects: [] }),
      ownership: "user",
    },
  ]);
  // no deps.migrations registered -> no-migration gap; dry-run must not pretend
  // it would auto-migrate (the real upgrade refuses).
  const result = workspaceUpgrade(root, { dryRun: true, acceptConflicts: true }, deps);
  expect(result.lines.some((l) => l.includes("[manual] .jspace/hub.json"))).toBe(true);
  expect(result.lines.some((l) => l.includes("[migrate]"))).toBe(false);
  expect(result.lines.some((l) => l.includes("no registered migration"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("hub schema migration writes the migrated document, user data preserved, marker bumped", () => {
  const root = tmp();
  markerOnlyWorkbench(root);
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ version: "4", domains: [{ id: "d", path: "workspace/d" }], resources: [], projects: [] }, null, 2) + "\n",
    "utf-8",
  );
  const deps = syntheticDeps([
    {
      path: "templates/workbench/.jspace/hub.json",
      content: JSON.stringify({ version: "5", domains: [], resources: [], projects: [] }),
      ownership: "user",
    },
    { path: "templates/workbench/AGENTS.md", content: "NEW AGENTS", ownership: "seed" },
  ]);
  deps.migrations = {
    "4": (raw: Record<string, unknown>) => ({ ...raw, version: "5", migrated_by: "v5" }),
  };
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, deps);
  expect(result.lines.some((l) => l.includes("upgraded"))).toBe(true);
  const hub = JSON.parse(readFileSync(join(root, ".jspace", "hub.json"), "utf-8"));
  expect(hub.version).toBe("5");
  expect(hub.domains).toEqual([{ id: "d", path: "workspace/d" }]); // user data preserved
  expect(hub.migrated_by).toBe("v5"); // transform applied
  const m = readMarker(root);
  expect(m.status).toBe("ok");
  if (m.status === "ok") {
    expect(m.value.template_version).toBe("2.0.0");
  }
  rmSync(root, { recursive: true, force: true });
});

test("old fixture (no journal) -> upgrade creates missing files, seed content preserved, marker bumped", () => {
  const root = tmp();
  oldWorkbench(root);
  writeFileSync(join(root, "user-note.md"), "keep me", "utf-8");
  const result = workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(result.lines.some((l) => l.includes("upgraded"))).toBe(true);
  // without a materialization journal, existing seed content is treated as
  // locally-owned and preserved (safe default); missing files are created
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("OLD AGENTS CONTENT");
  expect(existsSync(join(root, "README.md"))).toBe(true);
  expect(existsSync(join(root, ".jspace", "hub.json"))).toBe(true); // recovery: empty registry created
  // user-owned content untouched
  expect(readFileSync(join(root, "user-note.md"), "utf-8")).toBe("keep me");
  // marker bumped to the bundle version
  const m = readMarker(root);
  expect(m.status).toBe("ok");
  if (m.status === "ok") {
    expect(m.value.template_version).toBe(BUNDLE_MANIFEST.bundle_version);
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

test("modified workbench skill is never overwritten (seed, skip preserved)", () => {
  const root = tmp();
  initWorkbench(root, false, initDeps);
  const skillRel = "skills/jspace-bootstrap/SKILL.md";
  writeFileSync(join(root, skillRel), "USER SKILL", "utf-8");
  const { data } = workspaceDiff(root, BUNDLE_MANIFEST, true);
  const e = (data as { entries: { rel: string; action: string }[] }).entries.find((x) => x.rel === skillRel);
  expect(e?.action).toBe("skip"); // seed: preserved, non-blocking
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
      if (p.endsWith("README.md")) throw new Error("injected failure");
      writeBytesAtomic(p, c);
    },
  };
  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: true }, failing)).toThrow(/injected failure/);
  // upgrade journal exists with status failed
  const dir = join(root, ".jspace", "state", "upgrades");
  const ids = existsSync(dir) ? readdirSync(dir) : [];
  expect(ids.length).toBe(1);
  // rollback with normal deps restores the original content
  workspaceUpgrade(root, { rollbackId: ids[0], dryRun: false, acceptConflicts: true }, upgradeDeps);
  expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe(before);
  const journal = JSON.parse(readFileSync(join(dir, ids[0], "journal.json"), "utf-8"));
  expect(journal.status).toBe("rolled_back");
  rmSync(root, { recursive: true, force: true });
});
