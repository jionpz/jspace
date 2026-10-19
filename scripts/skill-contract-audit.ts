// scripts/skill-contract-audit.ts — pure, testable checks for the nine official
// skill contracts. Kept separate from check-skills.ts so tests can exercise the
// rules without regenerating embedded assets.
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const REQUIRED_SKILL_SECTIONS = [
  "## 触发 / 非目标",
  "## 输入与前置",
  "## 权威引用",
  "## 写集",
  "## 输出",
  "## 主流程",
  "## 完成证据",
  "## 失败与恢复",
  "## 转交",
] as const;

const NEW_REFERENCE = /`~\/\.agents\/skills\/([\w-]+)\/([\w/.-]+)`/g;
const OLD_RELATIVE_REFERENCE = /`(references\/[\w-]+\.md|\.\.\/[\w-]+\/(?:references\/[\w-]+\.md|SKILL\.md)|\.\.\/SKILL\.md)`/g;
const STRUCTURED_CALLS = new Set([
  "get_page",
  "list_pages",
  "put_page",
  "get_write_request",
  "get_backlinks",
]);

export interface SkillDocAuditOptions {
  repoRoot: string;
  exists?: (path: string) => boolean;
}

export interface SkillDocAuditResult {
  failures: string[];
  checkedReferences: number;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/");
}

function isEntrypoint(relPath: string): boolean {
  return /^skills\/[^/]+\/SKILL\.md$/.test(relPath);
}

function migrationContext(line: string): boolean {
  return /\b(legacy|migration|migrate)\b|迁移|旧根|旧版/i.test(line);
}

function auditReferences(
  relPath: string,
  body: string,
  opts: SkillDocAuditOptions,
  failures: string[],
): number {
  const skillsRoot = resolve(opts.repoRoot, "skills");
  const exists = opts.exists ?? existsSync;
  let checked = 0;
  body.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(NEW_REFERENCE)) {
      checked += 1;
      const skill = match[1]!;
      const rest = match[2]!;
      const source = resolve(skillsRoot, skill, rest);
      const relToSkills = relative(skillsRoot, source);
      if (relToSkills.startsWith("..") || isAbsolute(relToSkills)) {
        failures.push(
          `C1 invalid reference path at ${relPath}:${index + 1}: \`~/.agents/skills/${skill}/${rest}\` escapes the skills root`,
        );
      } else if (!exists(source)) {
        failures.push(
          `C1 broken reference at ${relPath}:${index + 1}: \`~/.agents/skills/${skill}/${rest}\` has no source skills/${skill}/${rest}`,
        );
      }
    }
    for (const match of line.matchAll(OLD_RELATIVE_REFERENCE)) {
      checked += 1;
      failures.push(
        `C1 stale relative reference at ${relPath}:${index + 1}: \`${match[1]}\`; use \`~/.agents/skills/<skill>/...\``,
      );
    }
  });
  return checked;
}

function auditLegacyContracts(relPath: string, body: string, failures: string[]): void {
  body.split(/\r?\n/).forEach((line, index) => {
    const at = `${relPath}:${index + 1}`;
    if (/\bgbrain\s+(?:get|put|list|tags)\b/.test(line)) {
      failures.push(`C7 old gbrain text command at ${at}; use structured \`gbrain call\``);
    }
    for (const match of line.matchAll(/\bgbrain\s+call\s+([\w-]+)/g)) {
      if (!STRUCTURED_CALLS.has(match[1]!)) {
        failures.push(`C7 unsupported structured call at ${at}: \`${match[1]}\``);
      }
    }
    if (/\bjspace\s+gbrain\s+wire\b/.test(line)) {
      failures.push(`C7 removed gbrain wire alias at ${at}; use \`jspace harness wire --harness <name> --dir <wb>\``);
    }
    if (/\bjspace\s+cron\s+check\b|\bcron\s+check\b/.test(line)) {
      failures.push(`C7 retired cron check alias at ${at}; use \`jspace cron failures\``);
    }
    if (/\.jspace-logs\/[^\s`]*APPLY\.json/.test(line) && !migrationContext(line)) {
      failures.push(`C7 old pending root at ${at}; current root is \`.jspace/state/pending/<id>.APPLY.json\``);
    }
    const supersedesNegated = /(?:不得|禁止|不要|不能|不可)/.test(line);
    if (
      !supersedesNegated &&
      (/从旧页[^\n]*(?:读正文|读取?|查看)\s*`?Supersedes/i.test(line) ||
        /旧页正文[^\n]*Supersedes[^\n]*(?:跟随|找|回退)/i.test(line))
    ) {
      failures.push(`C7 reversed Supersedes direction at ${at}; backlinks lead from old page to new-page candidates, and only the candidate body may declare \`Supersedes: [[old]]\``);
    }
    if (
      /\btype\b[^\n]*(?:必须|统一|一律)[^\n]*(?:note|reference)/i.test(line) ||
      /(?<!不)按\s*`?type`?\s*(?:路由|判断|过滤|审计)/i.test(line) ||
      /--type\s+reference|pages_by_type/i.test(line)
    ) {
      failures.push(`C7 type used as routing/validation authority at ${at}; route by slug + tags and keep type descriptive`);
    }
    if (/运行日/.test(line) && !/(?:不按|不得|禁止|不是|而不是|不能|不可|不自行)/.test(line)) {
      failures.push(`C7 runtime date used as period identity at ${at}; use the local Monday + observed_through`);
    }
    if (/\bdatetime\.now\(|\bdate\.today\(\)|timedelta\([^)]*\.weekday\(\)/.test(line)) {
      failures.push(`C7 duplicated local clock math at ${at}; run \`jspace memory period --json\` and consume its window`);
    }
    if (
      !/(?:不得|不能|不可|不是)/.test(line) &&
      /上一轮\s*consolidate[^\n]*(?:权威|事实)|consolidate[^\n]*(?:是|作为)[^\n]*权威/i.test(line)
    ) {
      failures.push(`C7 consolidate treated as authoritative source at ${at}; current facts must come from in-window source pages`);
    }
  });
}

/** Audit one skill Markdown file. `relPath` must be repo-relative with forward
 *  slashes (for stable test messages). */
export function auditSkillDoc(
  relPathInput: string,
  body: string,
  opts: SkillDocAuditOptions,
): SkillDocAuditResult {
  const relPath = normalizeRel(relPathInput);
  const failures: string[] = [];
  const checkedReferences = auditReferences(relPath, body, opts, failures);
  auditLegacyContracts(relPath, body, failures);
  if (isEntrypoint(relPath)) {
    for (const section of REQUIRED_SKILL_SECTIONS) {
      if (!body.includes(section)) {
        failures.push(`C8 missing unified section at ${relPath}: ${section}`);
      }
    }
  }
  return { failures, checkedReferences };
}

export interface WeeklyCronConfigLike {
  id?: unknown;
  tools?: unknown;
  target?: { kind?: unknown; input?: unknown } | null;
}

/** Check the three weekly cron definitions rendered into a fresh workbench.
 *  Inputs may delegate detail to the skill, but must name the local-Monday
 *  window and observed_through so headless runs cannot silently use run time. */
export function auditWeeklyCronConfig(crons: readonly WeeklyCronConfigLike[]): string[] {
  const failures: string[] = [];
  const weekly = new Set(["weekly-report", "memory-consolidate", "workbench-retro"]);
  for (const cron of crons) {
    if (typeof cron.id !== "string" || !weekly.has(cron.id)) continue;
    if (cron.target?.kind !== "skill") {
      failures.push(`C9 ${cron.id} target must be a skill target`);
    }
    if (typeof cron.tools !== "string" || !cron.tools.split(",").map((v) => v.trim()).includes("Bash")) {
      failures.push(`C9 ${cron.id} tools must include Bash`);
    }
    const input = typeof cron.target?.input === "string" ? cron.target.input : "";
    if (!input.includes("jspace memory period")) {
      failures.push(`C9 ${cron.id} input must run \`jspace memory period --json\` instead of recalculating the week`);
    }
    if (!input.includes("周一") || !input.includes("observed_through")) {
      failures.push(`C9 ${cron.id} input must state the local-Monday window and observed_through`);
    }
    if (/上一轮\s*consolidate|consolidate[^\n]*(?:是|作为)[^\n]*权威|运行日/.test(input)) {
      failures.push(`C9 ${cron.id} input contains a retired period/authority contract`);
    }
  }
  return failures;
}
