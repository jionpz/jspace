// scripts/skill-doc-drift.test.ts — C5 doc↔manifest drift guard regression tests.
// Run: bun test scripts/skill-doc-drift.test.ts
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import {
  checkDocSkillListing,
  diffSkillNameSets,
  findSkillListingLine,
  loadManifestSkillSets,
  parseSkillListingLine,
} from "./skill-doc-drift.ts";

const ROOT = resolve(import.meta.dir, "..");

test("loadManifestSkillSets matches committed skills-manifest.json", () => {
  const sets = loadManifestSkillSets(ROOT);
  expect("error" in sets).toBe(false);
  if ("error" in sets) return;
  expect(sets.workbench).toEqual([
    "asset-ingest",
    "jspace-use",
    "memory-consolidate",
    "memory-recall",
    "memory-writeback",
    "weekly-report",
    "workbench-retro",
  ]);
  expect(sets.global).toEqual(["harness-config"]);
  expect(sets.total).toBe(8);
});

test("README and AGENTS listing lines include the full manifest skill set", () => {
  const sets = loadManifestSkillSets(ROOT);
  expect("error" in sets).toBe(false);
  if ("error" in sets) return;

  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");

  expect(checkDocSkillListing(readme, "README.md", sets)).toEqual([]);
  expect(checkDocSkillListing(agents, "AGENTS.md", sets)).toEqual([]);
});

test("parseSkillListingLine extracts slash-separated workbench names (README style)", () => {
  const line =
    "skills/` —— 官方技能源码（7 个 workbench 技能：jspace-use / asset-ingest / memory-recall；另有 global 段的 `harness-config` 机器级治理技能，manifest 合计 8 个）";
  const listing = parseSkillListingLine(line);
  expect([...listing.names].sort()).toEqual(["asset-ingest", "harness-config", "jspace-use", "memory-recall"]);
  expect(listing.totalClaimed).toBe(8);
});

test("parseSkillListingLine extracts backtick workbench names (AGENTS style)", () => {
  const line =
    "`skills/`：… 当前 7 个 workbench 技能——`jspace-use`（指南）、`asset-ingest`（入库）；另有 1 个 `scope: global` 的机器级治理技能 `harness-config`（…）。manifest 合计 8 个。";
  const listing = parseSkillListingLine(line);
  expect([...listing.names].sort()).toEqual(["asset-ingest", "harness-config", "jspace-use"]);
  expect(listing.totalClaimed).toBe(8);
});

test("diffSkillNameSets reports missing and extra names", () => {
  const expected = ["jspace-use", "asset-ingest", "harness-config"];
  const found = new Set(["jspace-use", "phantom-skill"]);
  const { missing, extra } = diffSkillNameSets(expected, found);
  expect(missing).toEqual(["asset-ingest", "harness-config"]);
  expect(extra).toEqual(["phantom-skill"]);
});

test("checkDocSkillListing fails when a manifest skill is omitted from prose", () => {
  const sets = loadManifestSkillSets(ROOT);
  expect("error" in sets).toBe(false);
  if ("error" in sets) return;

  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const drifted = readme.replace("memory-consolidate", "memory-consolidated");
  const failures = checkDocSkillListing(drifted, "README.md", sets);
  expect(failures.some((f) => f.includes("missing skill names") && f.includes("memory-consolidate"))).toBe(true);
});

test("checkDocSkillListing fails when prose claims the wrong manifest total", () => {
  const sets = loadManifestSkillSets(ROOT);
  expect("error" in sets).toBe(false);
  if ("error" in sets) return;

  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const drifted = readme.replace("manifest 合计 8 个", "manifest 合计 9 个");
  const failures = checkDocSkillListing(drifted, "README.md", sets);
  expect(failures.some((f) => f.includes("manifest 合计 claims 9"))).toBe(true);
});

test("findSkillListingLine ignores lines without manifest total", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");
  const line = findSkillListingLine(agents);
  expect(line).not.toBeNull();
  expect(line).toContain("manifest 合计");
});
