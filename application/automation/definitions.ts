// application/automation/definitions.ts — cron definition repository + schedule
// validation (moved from cli/cron.ts). Typed via core/contracts/cron.ts. Also
// hosts skill-target compilation/validation for cron definitions (Child D).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { decodeCrons, type CronDefinition, type CronSkillTarget, type CronsFile } from "../../core/contracts/cron.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";
import { diffBundle } from "../workspace/manifest.ts";
import { isFile } from "../fs.ts";

export const CRON_FILE = join(CONFIG_DIR, "cron.json");

export function loadCrons(root: string): CronsFile {
  const p = join(root, CRON_FILE);
  if (!isFile(p)) return { version: 1, crons: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    fail(`${CRON_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  const decoded = decodeCrons(data);
  if (!decoded.ok) {
    fail(decoded.issues.map((i) => `${i.message} (${i.code})`).join("; "));
  }
  return decoded.value;
}

export function saveCrons(root: string, data: CronsFile): void {
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  writeFileSync(join(root, CRON_FILE), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---- schedule validation (restricted subset -> launchd dict) ----

export interface ScheduleDict {
  Minute: number;
  Hour: number;
  Day?: number;
  Month?: number;
  Weekday?: number;
}

/** Parse a restricted 5-field cron expression. `*` omits the launchd key (any).
 *  Rejects lists/ranges/steps and day-of-month+day-of-week both set (launchd
 *  AND/OR semantics differ across macOS versions — refuse instead of guessing). */
export function parseSchedule(schedule: string): ScheduleDict {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) fail(`invalid schedule: ${schedule} (expected 5 fields)`);
  const [minute, hour, dom, month, dow] = fields;
  const num = (v: string, lo: number, hi: number, label: string): number | undefined => {
    if (v === "*") return undefined;
    if (!/^\d+$/.test(v)) {
      fail(`invalid ${label} in schedule: ${schedule} (MVP supports single values or *; lists/ranges/steps rejected)`);
    }
    const n = Number(v);
    if (n < lo || n > hi) fail(`invalid ${label} in schedule: ${schedule} (range ${lo}-${hi})`);
    return n;
  };
  const m = num(minute, 0, 59, "minute");
  const h = num(hour, 0, 23, "hour");
  const d = num(dom, 1, 31, "day-of-month");
  const mo = num(month, 1, 12, "month");
  const w = num(dow, 0, 7, "weekday");
  if (m === undefined) fail(`invalid schedule: ${schedule} (minute cannot be * for launchd; use e.g. "0 * * * *")`);
  if (h === undefined) fail(`invalid schedule: ${schedule} (hour cannot be * for launchd; use e.g. "0 21 * * *")`);
  if (d !== undefined && w !== undefined) {
    fail(`invalid schedule: ${schedule} (day-of-month and day-of-week cannot both be set in MVP; launchd semantics differ)`);
  }
  return { Minute: m, Hour: h, ...(d !== undefined && { Day: d }), ...(mo !== undefined && { Month: mo }), ...(w !== undefined && { Weekday: w }) };
}

// ---- skill-target cron compilation / validation (Child D, RD5) ----

/** Everything validate/compile needs about the workbench; injected by the cli
 *  layer so application never imports the generated cli/*.generated.ts. */
export interface SkillTargetContext {
  skillsManifest: SkillsManifestV1; // which skills are required + entrypoints
  bundleManifest: DistributionManifestV1; // current bundle (diff target)
  readFile: (p: string) => string | null; // workbench file reader (null when missing)
  recorded: Record<string, { sha256: string }>; // materialization journal (applied base)
}

export type SkillTargetResult = { ok: true; prompt: string } | { ok: false; fix: string };

/** Validate a cron skill target against the workbench and compile its headless
 *  prompt. Pure (manifest/journal/fs injected). Fails before execution when the
 *  skill is unknown, its SKILL.md is missing, the entrypoint is not declared,
 *  or the materialized skill is stale vs the running bundle (diffBundle action
 *  is anything but no-op — update/conflict/create/stale, all fixable by
 *  `workspace upgrade` because skills are managed since Child D). */
export function compileSkillTarget(target: CronSkillTarget, wbRoot: string, ctx: SkillTargetContext): SkillTargetResult {
  const entry = ctx.skillsManifest.workbench.find((s) => s.name === target.skill);
  if (!entry) {
    return { ok: false, fix: `run jspace update (unknown skill ${target.skill} in cron target)` };
  }
  const skillRoot = join(wbRoot, "skills", target.skill);
  if (!ctx.readFile(join(skillRoot, "SKILL.md"))) {
    return { ok: false, fix: `re-run jspace init or jspace workspace upgrade to restore bundled skill ${target.skill} (missing skills/${target.skill}/SKILL.md)` };
  }
  if (entry.entrypoints !== undefined && entry.entrypoints.length > 0 && !entry.entrypoints.includes(target.entrypoint)) {
    return { ok: false, fix: `skill ${target.skill} has no entrypoint ${target.entrypoint} (choose from: ${entry.entrypoints.join(", ")})` };
  }
  const diff = diffBundle(wbRoot, ctx.bundleManifest, { readFile: ctx.readFile, recorded: ctx.recorded });
  if (diff.some((e) => e.rel.startsWith(`skills/${target.skill}/`) && e.action !== "no-op")) {
    return { ok: false, fix: `run jspace workspace upgrade (skill ${target.skill} is out of date; a local edit is preserved as conflict)` };
  }
  return {
    ok: true,
    prompt: `在工作台 ${wbRoot} 按 AGENTS.md 路由。阅读并执行 ${join(skillRoot, "SKILL.md")} 的 ${target.entrypoint} 流程：${target.input}`,
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
