// application/automation/definitions.ts — cron definition repository + schedule
// validation (moved from cli/cron.ts). Typed via core/contracts/cron.ts. Also
// hosts skill-target compilation/validation for cron definitions.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { SCHEMA_VERSION_REPAIR_HINT } from "../../core/contracts/diagnostics.ts";
import { decodeCrons, type CronDefinition, type CronSkillTarget, type CronsFile } from "../../core/contracts/cron.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";
import { skillRel, skillRoot } from "../fs.ts";
import { isFile } from "../fs.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { parseSchedule, type ScheduleDict } from "../../core/shared/schedule.ts";

// Re-export schedule parsing (shared kernel — core/shared/schedule.ts).
// Existing consumers import from here.
export { parseSchedule };
export type { ScheduleDict };

export const CRON_FILE = join(CONFIG_DIR, "cron.json");

export function loadCrons(root: string): CronsFile {
  const p = join(root, CRON_FILE);
  if (!isFile(p)) return { schema_version: 1, crons: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    fail(`${CRON_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  const decoded = decodeCrons(data);
  if (!decoded.ok) {
    // version.unsupported (pre-1.0.11 cron.json) carries the repair path; other
    // decoder issues pass through unchanged.
    const msg = decoded.issues
      .map((i) => `${i.message} (${i.code})${i.code.endsWith(".version.unsupported") ? `; ${SCHEMA_VERSION_REPAIR_HINT}` : ""}`)
      .join("; ");
    fail(msg);
  }
  return decoded.value;
}

export function saveCrons(root: string, data: CronsFile): void {
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  writeBytesAtomic(join(root, CRON_FILE), JSON.stringify(data, null, 2) + "\n");
}

// ---- skill-target cron compilation / validation ----

/** Everything validate/compile needs about the workbench; injected by the cli
 *  layer so application never imports the generated cli/*.generated.ts and
 *  automation never imports workspace/* (breaks the workspace↔automation ring). */
export interface SkillTargetContext {
  skillsManifest: SkillsManifestV1; // which skills are required + entrypoints
  bundleManifest: DistributionManifestV1; // current bundle (diff target)
  readFile: (p: string) => string | null; // workbench file reader (null when missing)
  recorded: Record<string, { sha256: string }>; // materialization journal (applied base)
  /** Freshness diff (materialized workbench vs bundle). Injected so automation
   *  never imports workspace/manifest. */
  diffBundle: (
    root: string,
    manifest: DistributionManifestV1,
    deps: { readFile: (p: string) => string | null; recorded: Record<string, { sha256: string }> },
  ) => { rel: string; action: string }[];
}

export type SkillTargetResult = { ok: true; prompt: string } | { ok: false; fix: string };

/** Validate a cron skill target against the workbench and compile its headless
 *  prompt. Pure (manifest/journal/fs injected). Fails before execution when the
 *  skill is unknown, its SKILL.md is missing, the entrypoint is not declared,
 *  or the materialized skill is stale vs the running bundle (diffBundle action
 *  is anything but no-op — update/conflict/create/stale, all fixable by
 *  `workspace upgrade` because skills are managed). */
export function compileSkillTarget(target: CronSkillTarget, wbRoot: string, ctx: SkillTargetContext): SkillTargetResult {
  const entry = ctx.skillsManifest.workbench.find((s) => s.name === target.skill);
  if (!entry) {
    return { ok: false, fix: `run jspace update (unknown skill ${target.skill} in cron target)` };
  }
  const skillRootPath = skillRoot(wbRoot, target.skill);
  if (!ctx.readFile(join(skillRootPath, "SKILL.md"))) {
    return { ok: false, fix: `re-run jspace init or jspace workspace upgrade to restore bundled skill ${target.skill} (missing ${skillRel(target.skill)}/SKILL.md)` };
  }
  if (entry.entrypoints !== undefined && entry.entrypoints.length > 0 && !entry.entrypoints.includes(target.entrypoint)) {
    return { ok: false, fix: `skill ${target.skill} has no entrypoint ${target.entrypoint} (choose from: ${entry.entrypoints.join(", ")})` };
  }
  const diff = ctx.diffBundle(wbRoot, ctx.bundleManifest, { readFile: ctx.readFile, recorded: ctx.recorded });
  if (diff.some((e) => e.rel.startsWith(`${skillRel(target.skill)}/`) && e.action !== "no-op")) {
    return { ok: false, fix: `run jspace workspace upgrade (skill ${target.skill} is out of date; a local edit is preserved as conflict)` };
  }
  return {
    ok: true,
    prompt: `在工作台 ${wbRoot} 按 AGENTS.md 路由。阅读并执行 ${join(skillRootPath, "SKILL.md")} 的 ${target.entrypoint} 流程：${target.input}`,
  };
}

/** Resolve a cron definition's headless prompt: a skill target is validated and
 *  compiled (fail() on invalid target with a fix action); a prose prompt passes
 *  through unchanged (custom escape hatch). */
export function resolveCronPrompt(cron: CronDefinition, wbRoot: string, ctx: SkillTargetContext): string {
  if (cron.target) {
    const r = compileSkillTarget(cron.target, wbRoot, ctx);
    if (!r.ok) fail(r.fix);
    return r.prompt;
  }
  return cron.prompt ?? "";
}
