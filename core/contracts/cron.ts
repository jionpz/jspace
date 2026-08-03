// core/contracts/cron.ts — typed cron definition + run invocation contracts.
//
// cron.json owns portable cron definitions; CronRunInvocation is the single
// contract shared by the CLI codec and every scheduler backend (backend argv is
// serialized from it and must parse back through the real parser — closes audit
// F1). Decoder mirrors the diagnostics pattern from hub/local.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { ID_PATTERN, isId } from "./ids.ts";

export const HARNESSES = ["claude", "codex", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface CronDefinition {
  id: string;
  schedule: string;
  harness: Harness;
  prompt: string;
  enabled: boolean;
}

export interface CronsFile {
  version: 1;
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
  checkNoUnknownFields(input, ["version", "crons"], "cron", "cron.unknown-field", issues);
  if (input.version !== 1) {
    issues.add("cron.version.unsupported", "cron.version", "version must be 1");
  }
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
      checkNoUnknownFields(item, ["id", "schedule", "harness", "prompt", "enabled"], prefix, "cron.entry.unknown-field", issues);
      const id = readRequiredString(item, "id", prefix, "cron.id.invalid", issues);
      const schedule = readRequiredString(item, "schedule", prefix, "cron.schedule.invalid", issues);
      const harness = readRequiredString(item, "harness", prefix, "cron.harness.invalid", issues);
      const prompt = readRequiredString(item, "prompt", prefix, "cron.prompt.invalid", issues);
      if (id !== undefined && !isId(id)) {
        issues.add("cron.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
      }
      if (harness !== undefined && !(HARNESSES as readonly string[]).includes(harness)) {
        issues.add("cron.harness.invalid", `${prefix}.harness`, `harness must be one of ${HARNESSES.join(", ")}`);
      }
      if (typeof item.enabled !== "boolean") {
        issues.add("cron.enabled.invalid", `${prefix}.enabled`, "enabled must be a boolean");
      }
      if (issues.issues.length === before) {
        crons.push({
          id: id as string,
          schedule: schedule as string,
          harness: harness as Harness,
          prompt: prompt as string,
          enabled: item.enabled as boolean,
        });
      }
    });
  }
  if (!issues.ok) return failure(issues.issues);
  return success({ version: 1, crons });
}
