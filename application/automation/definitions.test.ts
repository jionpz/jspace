// application/automation/definitions.test.ts — skill-target cron compilation &
// validation (Child D, RD5/AC-D4). Pure: manifest/bundle/fs are injected.
// Run: bun test application/automation/definitions.test.ts
import { expect, test } from "bun:test";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";
import { sha256Of } from "../workspace/manifest.ts";
import { compileSkillTarget, resolveCronPrompt, type SkillTargetContext } from "./definitions.ts";

const NEW_SKILL = "asset-ingest NEW content";
const OLD_SKILL = "asset-ingest OLD content";

const skillsManifest: SkillsManifestV1 = {
  version: 1,
  workbench: [
    { name: "asset-ingest", version: "1", scope: "workbench", dependencies: [], entrypoints: ["batch"], description: "" },
  ],
  global: [],
};

const bundleManifest: DistributionManifestV1 = {
  version: 1,
  bundle_version: "1.0.0",
  files: [{ path: "skills/asset-ingest/SKILL.md", sha256: sha256Of(NEW_SKILL), ownership: "managed" }],
};

function ctx(overrides: { current?: string | null; recorded?: string } = {}): SkillTargetContext {
  const current = overrides.current !== undefined ? overrides.current : NEW_SKILL;
  return {
    skillsManifest,
    bundleManifest,
    readFile: (p) => (p.endsWith("skills/asset-ingest/SKILL.md") ? current : null),
    recorded: overrides.recorded !== undefined ? { "skills/asset-ingest/SKILL.md": { sha256: sha256Of(overrides.recorded) } } : {},
  };
}

function targetCron(): CronDefinition {
  return {
    id: "inbox-tidy",
    schedule: "0 21 * * *",
    harness: "claude",
    target: { kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "整理 inbox" },
    enabled: true,
  };
}

test("valid up-to-date skill target compiles a prompt with the skill path", () => {
  const r = compileSkillTarget(targetCron().target!, "/wb", ctx());
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.prompt).toContain("/wb/skills/asset-ingest/SKILL.md");
    expect(r.prompt).toContain("batch");
    expect(r.prompt).toContain("整理 inbox");
  }
});

test("unknown skill fails with a jspace update fix", () => {
  const r = compileSkillTarget({ ...targetCron().target!, skill: "nope" }, "/wb", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fix).toContain("jspace update");
});

test("missing SKILL.md fails with an init/upgrade fix", () => {
  const r = compileSkillTarget(targetCron().target!, "/wb", ctx({ current: null }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fix).toContain("workspace upgrade");
});

test("undeclared entrypoint fails with a choose-from fix", () => {
  const r = compileSkillTarget({ ...targetCron().target!, entrypoint: "single" }, "/wb", ctx());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fix).toContain("no entrypoint single");
});

test("stale materialized skill fails with a workspace upgrade fix", () => {
  // workbench has the OLD skill; bundle moved forward; recorded == old applied.
  const r = compileSkillTarget(targetCron().target!, "/wb", ctx({ current: OLD_SKILL, recorded: OLD_SKILL }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fix).toContain("workspace upgrade");
});

test("resolveCronPrompt passes prose prompts through unchanged", () => {
  const prose: CronDefinition = { id: "weekly-report", schedule: "0 21 * * 0", harness: "claude", prompt: "生成本周周报", enabled: true };
  expect(resolveCronPrompt(prose, "/wb", ctx())).toBe("生成本周周报");
});

test("resolveCronPrompt throws (fail) on an invalid skill target", () => {
  const stale = { ...targetCron(), target: { ...targetCron().target!, skill: "nope" } };
  expect(() => resolveCronPrompt(stale, "/wb", ctx())).toThrow(/jspace update/);
});
