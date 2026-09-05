// core/contracts/skills.test.ts — pure decode tests for the SkillsManifest
// contract. Only the typed contract is covered here; bundling/materialization
// belongs to the skill-target feature's gen-assets + init integration.
// Run: bun test core/contracts/skills.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeSkillsManifest, type SkillEntry, type SkillsManifestV1 } from "./skills.ts";

function entry(name: string, scope: SkillEntry["scope"]): SkillEntry {
  return {
    name,
    version: "1",
    scope,
    dependencies: [],
    description: `skill ${name}`,
    ...(scope === "global" ? { install_path: `~/.agents/skills/${name}` } : {}),
  };
}

function validManifest(): SkillsManifestV1 {
  return {
    schema_version: 1,
    workbench: [
      entry("jspace-use", "workbench"),
      entry("asset-ingest", "workbench"),
      entry("memory-recall", "workbench"),
      entry("memory-writeback", "workbench"),
    ],
    global: [entry("harness-config", "global")],
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeSkillsManifest(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid manifest decodes ok and round-trips", () => {
  const manifest = validManifest();
  const result = decodeSkillsManifest(JSON.parse(JSON.stringify(manifest)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(manifest);
});

test("version must be 1 and arrays required", () => {
  expectIssue({ ...validManifest(), schema_version: 2 }, "skills.version.unsupported");
  expectIssue({ schema_version: 1, workbench: "nope", global: [] }, "skills.workbench.type");
  expectIssue({ schema_version: 1, workbench: [], global: {} }, "skills.global.type");
});

test("skill name must be a valid id and unique", () => {
  expectIssue({ ...validManifest(), workbench: [entry("Bad Name", "workbench")] }, "skills.entry.name.invalid");
  const dup = validManifest();
  dup.workbench = [entry("asset-ingest", "workbench"), entry("asset-ingest", "workbench")];
  expectIssue(dup, "skills.entry.name.duplicate");
});

test("scope must be workbench|global and fields required", () => {
  const bad = validManifest();
  bad.workbench = [{ ...entry("x", "workbench"), scope: "system" as SkillEntry["scope"] }];
  expectIssue(bad, "skills.entry.scope.invalid");
  expectIssue({ ...validManifest(), workbench: [{ scope: "workbench", version: "1", dependencies: [], description: "" }] }, "skills.entry.name.invalid");
  expectIssue({ ...validManifest(), workbench: [{ name: "x", scope: "workbench", dependencies: [], description: "" }] }, "skills.entry.version.invalid");
});

test("dependencies must be an array of valid ids", () => {
  const bad = validManifest();
  bad.workbench = [{ ...entry("x", "workbench"), dependencies: "asset-ingest" as unknown as string[] }];
  expectIssue(bad, "skills.entry.dependencies.type");
  const badId = validManifest();
  badId.workbench = [{ ...entry("x", "workbench"), dependencies: ["Bad Id"] }];
  expectIssue(badId, "skills.entry.dependencies.invalid");
});

test("install_path constrained by scope", () => {
  // workbench must NOT carry install_path
  const wb = validManifest();
  wb.workbench = [{ ...entry("x", "workbench"), install_path: "~/.agents/x" }];
  expectIssue(wb, "skills.entry.install_path.invalid");
  // global MUST carry install_path
  const g = validManifest();
  g.global = [{ ...entry("x", "global") as SkillEntry, install_path: undefined }];
  expectIssue(g, "skills.entry.install_path.missing");
});

test("skill names are unique across workbench + global", () => {
  // the same name in both scopes would install twice (issue #37 follow-up)
  const g = validManifest();
  g.workbench = [entry("dup", "workbench")];
  g.global = [entry("dup", "global")];
  expectIssue(g, "skills.entry.name.duplicate");
});

test("unknown fields are rejected", () => {
  expectIssue({ ...validManifest(), extra: 1 }, "skills.unknown-field");
  expectIssue({ ...validManifest(), workbench: [{ ...entry("x", "workbench"), entrypoint: "skills/x/SKILL.md" }] }, "skills.entry.unknown-field");
});
