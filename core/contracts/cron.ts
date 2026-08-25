// core/contracts/cron.ts — typed cron definition + run invocation contracts.
//
// cron.json owns portable cron definitions; CronRunInvocation is the single
// contract shared by the CLI codec and every scheduler backend (backend argv is
// serialized from it and must parse back through the real parser — closes audit
// (batch-run identity). Decoder mirrors the diagnostics pattern from hub/local.
//
// schema_version stays 1: the optional `target` field is additive, so existing
// v1 files (with `prompt`) decode unchanged. A pre-Child-D binary reading a
// cron.json that uses `target` rejects it via unknown-field — upgrade the CLI
// first (no silent misinterpretation).
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readBool,
  readEnum,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { ID_PATTERN, isId } from "./ids.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";

// The cron enum is the headless-cron-capable subset of capabilities.yaml
// (adapters/harness/capabilities.yaml). cursor is a session harness with no
// headless CLI and is intentionally absent here — it can never run a cron.
export const HARNESSES = ["claude", "codex", "grok", "opencode", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface CronSkillTarget {
  kind: "skill"; // fixed: a skill target references a manifest-declared workbench skill
  skill: string; // manifest.workbench skill name (e.g. "asset-ingest")
  entrypoint: string; // skill-internal semantic entry (e.g. "batch")
  input: string; // semantic input compiled into the headless prompt
}

export interface CronDefinition {
  id: string;
  schedule: string;
  harness: Harness;
  prompt?: string; // custom escape hatch (exactly one of prompt | target)
  target?: CronSkillTarget; // versioned skill target (exactly one of prompt | target)
  /** Optional override of the harness's default headless tools for THIS cron —
   *  e.g. drop Bash for write-only skills so a prompt-injected run cannot shell.
   *  Absent = the harness capability default (argv_flags.tools_value). */
  tools?: string;
  enabled: boolean;
}

export interface CronsFile {
  schema_version: 1;
  crons: CronDefinition[];
}

/** The canonical unit both `cron run` and scheduler backends compile from. */
export interface CronRunInvocation {
  workbench: string; // workbench root (--dir)
  cronId: string;
  timeoutSec?: number; // default 1800
  force?: boolean; // skip today-success
}

export function decodeCrons(input: unknown): DecodeResult<CronsFile> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("cron.root.type", "cron", "cron.json root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "crons"], "cron", "cron.unknown-field", issues);
  readVersion(issues, "cron.version.unsupported", "cron.version", input.schema_version, [1]);
  const crons: CronDefinition[] = [];
  if (!Array.isArray(input.crons)) {
    issues.add("cron.crons.type", "cron.crons", "crons must be an array");
  } else {
    input.crons.forEach((item, i) => {
      const prefix = `cron.crons[${i}]`;
      if (!isRecord(item)) {
        issues.add("cron.entry.type", prefix, "cron entry must be an object");
        return;
      }
      const before = issues.issues.length;
      checkNoUnknownFields(item, ["id", "schedule", "harness", "prompt", "target", "tools", "enabled"], prefix, "cron.entry.unknown-field", issues);
      const id = readRequiredString(item, "id", prefix, "cron.id.invalid", issues);
      const schedule = readRequiredString(item, "schedule", prefix, "cron.schedule.invalid", issues);
      readEnum(issues, "cron.harness.invalid", `${prefix}.harness`, item.harness, HARNESSES);
      // schedule is validated here, not deferred to cronAdd/doctor: a hand-edited
      // cron.json with a bad schedule must fail decode (visible, not silent).
      if (schedule !== undefined) {
        try {
          parseSchedule(schedule);
        } catch {
          issues.add("cron.schedule.invalid", `${prefix}.schedule`, `invalid schedule: ${schedule}`);
        }
      }
      // exactly one of prompt | target; prompt remains the custom escape hatch.
      const hasPrompt = item.prompt !== undefined;
      const hasTarget = item.target !== undefined;
      let prompt: string | undefined;
      if (hasPrompt) {
        if (typeof item.prompt === "string") prompt = item.prompt;
        else issues.add("cron.prompt.invalid", `${prefix}.prompt`, "prompt must be a string");
      }
      const target = hasTarget ? decodeSkillTarget(item.target, `${prefix}.target`, issues) : undefined;
      if (hasPrompt === hasTarget) {
        issues.add("cron.entry.prompt_or_target", `${prefix}.target`, "exactly one of prompt or target must be set");
      }
      if (id !== undefined && !isId(id)) {
        issues.add("cron.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
      }
      readBool(issues, "cron.enabled.invalid", `${prefix}.enabled`, item.enabled);
      let tools: string | undefined;
      if (item.tools !== undefined) {
        if (typeof item.tools === "string" && item.tools.trim().length > 0) tools = item.tools;
        else issues.add("cron.tools.invalid", `${prefix}.tools`, "tools must be a non-empty string (harness tool-list syntax)");
      }
      if (issues.issues.length === before) {
        crons.push({
          id: id as string,
          schedule: schedule as string,
          harness: item.harness as Harness,
          ...(prompt !== undefined ? { prompt } : {}),
          ...(target !== undefined ? { target } : {}),
          ...(tools !== undefined ? { tools } : {}),
          enabled: item.enabled as boolean,
        });
      }
    });
  }
  if (!issues.ok) return failure(issues.issues);
  return success({ schema_version: 1, crons });
}

/** Decode a CronSkillTarget object. Returns undefined when invalid (issues added). */
function decodeSkillTarget(raw: unknown, prefix: string, issues: IssueCollector): CronSkillTarget | undefined {
  if (!isRecord(raw)) {
    issues.add("cron.target.type", prefix, "target must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(raw, ["kind", "skill", "entrypoint", "input"], prefix, "cron.target.unknown-field", issues);
  const kind = readRequiredString(raw, "kind", prefix, "cron.target.kind.invalid", issues);
  const skill = readRequiredString(raw, "skill", prefix, "cron.target.skill.invalid", issues);
  const entrypoint = readRequiredString(raw, "entrypoint", prefix, "cron.target.entrypoint.invalid", issues);
  const input = readRequiredString(raw, "input", prefix, "cron.target.input.invalid", issues);
  if (kind !== undefined && kind !== "skill") {
    issues.add("cron.target.kind.invalid", `${prefix}.kind`, 'kind must be "skill"');
  }
  if (skill !== undefined && !isId(skill)) {
    issues.add("cron.target.skill.invalid", `${prefix}.skill`, `skill must match ${ID_PATTERN}`);
  }
  if (issues.issues.length === before) {
    return { kind: "skill", skill: skill as string, entrypoint: entrypoint as string, input: input as string };
  }
  return undefined;
}
