// core/contracts/skills.ts — typed skill distribution contract.
//
// skills-manifest.json is the single source for which workbench skills get
// bundled (gen-assets embeds every `workbench` entry) and how machine-global
// skills (harness-config) are installed. Decoder mirrors the diagnostics
// pattern from hub/local/cron: side-effect free, strict unknown-field.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readOptionalString,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { ID_PATTERN, isId } from "./ids.ts";

export const SKILL_SCOPES = ["workbench", "global"] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export interface SkillEntry {
  name: string; // ID_PATTERN; unique across workbench+global
  version: string; // declarative version (R6); staleness is detected by content diff at runtime
  scope: SkillScope; // workbench = bundled + materialized; global = machine-level, not bundled
  dependencies: string[]; // cross-skill references (e.g. memory-recall -> asset-ingest)
  entrypoints?: string[]; // semantic entries a cron skill target may invoke (e.g. asset-ingest: batch)
  install_source?: string; // global only: install/upgrade source (e.g. ~/.agents/skills/harness-config)
  description?: string; // optional; single source for descriptions is SKILL.md frontmatter (gen-assets renders from it)
}

export interface SkillsManifestV1 {
  schema_version: 1;
  workbench: SkillEntry[]; // 4 required workbench skills
  global: SkillEntry[]; // machine-global optional skills (harness-config)
}

const ENTRY_FIELDS = ["name", "version", "scope", "dependencies", "entrypoints", "install_source", "description"] as const;

export function decodeSkillsManifest(input: unknown): DecodeResult<SkillsManifestV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("skills.root.type", "skills", "skills-manifest.json root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "workbench", "global"], "skills", "skills.unknown-field", issues);
  readVersion(issues, "skills.version.unsupported", "skills.version", input.schema_version, [1]);
  const workbench = decodeEntries(input.workbench, "workbench", issues);
  const global = decodeEntries(input.global, "global", issues);
  if (!issues.ok) return failure(issues.issues);
  return success({ schema_version: 1, workbench, global });
}

function decodeEntries(raw: unknown, group: string, issues: IssueCollector): SkillEntry[] {
  const out: SkillEntry[] = [];
  if (!Array.isArray(raw)) {
    issues.add(`skills.${group}.type`, `skills.${group}`, `${group} must be an array`);
    return out;
  }
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const prefix = `skills.${group}[${i}]`;
    if (!isRecord(item)) {
      issues.add("skills.entry.type", prefix, "skill entry must be an object");
      return;
    }
    const before = issues.issues.length;
    checkNoUnknownFields(item, ENTRY_FIELDS, prefix, "skills.entry.unknown-field", issues);
    const name = readRequiredString(item, "name", prefix, "skills.entry.name.invalid", issues);
    const version = readRequiredString(item, "version", prefix, "skills.entry.version.invalid", issues);
    const scope = readRequiredString(item, "scope", prefix, "skills.entry.scope.invalid", issues);
    const description = readOptionalString(item, "description", prefix, "skills.entry.description.invalid", issues);
    if (name !== undefined && !isId(name)) {
      issues.add("skills.entry.name.invalid", `${prefix}.name`, `name must match ${ID_PATTERN}`);
    }
    if (name !== undefined) {
      if (seen.has(name)) {
        issues.add("skills.entry.name.duplicate", `${prefix}.name`, `duplicate skill name: ${name}`);
      }
      seen.add(name);
    }
    if (scope !== undefined && !(SKILL_SCOPES as readonly string[]).includes(scope)) {
      issues.add("skills.entry.scope.invalid", `${prefix}.scope`, `scope must be one of ${SKILL_SCOPES.join(", ")}`);
    }
    if (item.dependencies !== undefined) {
      if (!Array.isArray(item.dependencies)) {
        issues.add("skills.entry.dependencies.type", `${prefix}.dependencies`, "dependencies must be an array");
      } else {
        item.dependencies.forEach((d, j) => {
          if (typeof d !== "string" || !isId(d)) {
            issues.add("skills.entry.dependencies.invalid", `${prefix}.dependencies[${j}]`, `dependency must match ${ID_PATTERN}`);
          }
        });
      }
    }
    let entrypoints: string[] | undefined;
    if (item.entrypoints !== undefined) {
      if (!Array.isArray(item.entrypoints)) {
        issues.add("skills.entry.entrypoints.type", `${prefix}.entrypoints`, "entrypoints must be an array");
      } else {
        entrypoints = item.entrypoints as string[];
        item.entrypoints.forEach((e, j) => {
          if (typeof e !== "string" || !/^[a-z0-9-]+$/.test(e)) {
            issues.add("skills.entry.entrypoints.invalid", `${prefix}.entrypoints[${j}]`, "entrypoint must be a kebab-case token");
          }
        });
      }
    }
    // scope constraint: install_source only for global, and required for global.
    const hasInstall = item.install_source !== undefined;
    if (scope === "workbench" && hasInstall) {
      issues.add("skills.entry.install_source.invalid", `${prefix}.install_source`, "install_source is only valid for global skills");
    }
    if (scope === "global" && !hasInstall) {
      issues.add("skills.entry.install_source.missing", `${prefix}.install_source`, "global skills must declare install_source");
    }
    if (issues.issues.length === before) {
      out.push({
        name: name as string,
        version: version as string,
        scope: scope as SkillScope,
        dependencies: Array.isArray(item.dependencies) ? (item.dependencies as string[]) : [],
        ...(entrypoints !== undefined ? { entrypoints } : {}),
        ...(hasInstall ? { install_source: item.install_source as string } : {}),
        ...(description !== undefined ? { description } : {}),
      });
    }
  });
  return out;
}
