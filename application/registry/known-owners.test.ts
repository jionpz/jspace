// application/registry/known-owners.test.ts — which project/domain ids a
// workbench can vouch for. The distinction this file pins is null vs empty:
// "registry unreadable" (unknown) must never collapse into "no owners", or a
// broken hub.json would turn every knowledge page's project into a finding.
// Run: bun test application/registry/known-owners.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKnownOwners } from "./known-owners.ts";

function workbench(hub: unknown): string {
  const wb = mkdtempSync(join(tmpdir(), "jspace-owners-"));
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(join(wb, ".jspace", "hub.json"), JSON.stringify(hub));
  return wb;
}

test("resolveKnownOwners returns registered project and domain ids", () => {
  const wb = workbench({
    schema_version: 1,
    domains: [{ id: "files", path: "workspace/files" }],
    resources: [],
    projects: [
      { id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" },
      { id: "retired", domain: "files", asset_rel_path: "projects/retired", status: "archived" },
    ],
  });
  const owners = resolveKnownOwners(wb);
  expect(owners?.domains).toEqual(["files"]);
  // Archived projects stay valid owners: knowledge from a finished project is
  // still that project's knowledge, so "known" is not "currently active".
  expect(owners?.projects.sort()).toEqual(["acme", "retired"]);
  rmSync(wb, { recursive: true, force: true });
});

test("resolveKnownOwners returns an empty set for a workbench with nothing registered", () => {
  const wb = workbench({ schema_version: 1, domains: [], resources: [], projects: [] });
  expect(resolveKnownOwners(wb)).toEqual({ projects: [], domains: [] });
  rmSync(wb, { recursive: true, force: true });
});

test("resolveKnownOwners returns null when the registry is missing or unreadable", () => {
  const empty = mkdtempSync(join(tmpdir(), "jspace-owners-none-"));
  expect(resolveKnownOwners(empty)).toBeNull();

  const broken = mkdtempSync(join(tmpdir(), "jspace-owners-broken-"));
  mkdirSync(join(broken, ".jspace"), { recursive: true });
  writeFileSync(join(broken, ".jspace", "hub.json"), "{ not json");
  expect(resolveKnownOwners(broken)).toBeNull();

  rmSync(empty, { recursive: true, force: true });
  rmSync(broken, { recursive: true, force: true });
});
