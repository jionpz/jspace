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

// The cron enum is supplied by the caller at decode time. The production caller
// derives it from adapters/harness/capabilities.yaml (cronHarnessNames()), while
// this core contract stays free of an adapter import and remains testable with
// fixture enums. Do not reintroduce a parallel harness whitelist here.
export type Harness = string;

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
  /** Optional headless model for THIS cron. Unattended runs must not inherit the
   *  interactive default: a rate-limited user-level model makes `claude -p` hang
   *  until killed (observed: a 5h-window quota exhausted, every cron failed
   *  nightly), and the user's model choice for their own sessions is not
   *  jspace's to depend on. Absent = the harness's own resolution. */
  model?: string;
  /** Optional per-task execution budget in seconds. This is the DEFAULT for
   *  every scheduled run of this cron; `cron run --timeout N` still overrides
   *  it for a single run (manual troubleshooting must keep working).
   *
   *  It belongs here — not only on the CLI — because the planner (`planReconciliation`)
   *  is the only thing that can make a changed budget reach the installed
   *  entry. `--timeout` is a per-run flag the scheduler never sees: the plist
   *  argv is `cron run --id <id> --dir <root>`, so before this field the
   *  scheduled path always ate the 1800s default and two months of
   *  `server-status` timeouts (1915s / 2042s, exit 143) could not be fixed by
   *  editing cron.json at all.
   *
   *  Absent = DEFAULT_TIMEOUT_SEC (1800), byte-identical to pre-field behaviour. */
  timeoutSec?: number;
  /** No-output watchdog in seconds: kill the run when neither stdout nor stderr
   *  has produced new bytes for this long. `0` or absent disables it.
   *
   *  Opt-in by design: `claude -p --output-format text` emits its payload only
   *  when the run finishes, so "no output yet" cannot be told apart from a hung
   *  upstream. Enable it for harnesses/prompts whose output cadence is known.
   *
   *  Unlike `timeoutSec`, this never enters the scheduler argv: `cron run` reads
   *  it from cron.json at execution time, so existing launchd/crontab/schtasks
   *  entries stay byte-identical. */
  stallSec?: number;
  /** Hold an idle-sleep guard while the run executes (darwin only).
   *
   *  On by default when absent — the asymmetry with `stallSec` is deliberate:
   *  a wrong `stallSec` kills healthy long runs, while the guard only costs
   *  power. A scheduled run is unattended by definition: with `pmset sleep 1`
   *  on AC the Mac returns to sleep seconds after launchd's dark wake, the
   *  harness's open stream is suspended, and the run burns its whole budget
   *  waiting (2026-10-27: three crons, transcript gaps matching the pmset
   *  sleep windows second for second).
   *
   *  `false` opts out (closed-lid runs are unaffected either way, and a task
   *  that must not keep the machine awake can say so).
   *
   *  Like `stallSec`, read by `cron run` at execution time and never written
   *  into the scheduler argv. */
  preventSleep?: boolean;
  enabled: boolean;
}

/** Execution budget used when neither the cron definition nor `--timeout` names one. */
export const DEFAULT_TIMEOUT_SEC = 1800;

export interface CronsFile {
  schema_version: 1;
  crons: CronDefinition[];
}

/** The canonical unit both `cron run` and scheduler backends compile from. */
export interface CronRunInvocation {
  workbench: string; // workbench root (--dir)
  cronId: string;
  /** Per-run budget written into the scheduler entry. Sourced from the cron
   *  definition's `timeoutSec` (so a changed budget re-reconciles the entry);
   *  absent = hold at DEFAULT_TIMEOUT_SEC, and the installed argv then carries
   *  no `--timeout` — the same bytes a pre-field entry has, so adding this
   *  field never rewrites every existing schedule on its own. */
  timeoutSec?: number;
  force?: boolean; // skip today-success
}

export function decodeCrons(input: unknown, harnessEnum: readonly string[]): DecodeResult<CronsFile> {
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
      checkNoUnknownFields(item, ["id", "schedule", "harness", "prompt", "target", "tools", "model", "timeoutSec", "stallSec", "preventSleep", "enabled"], prefix, "cron.entry.unknown-field", issues);
      const id = readRequiredString(item, "id", prefix, "cron.id.invalid", issues);
      const schedule = readRequiredString(item, "schedule", prefix, "cron.schedule.invalid", issues);
      readEnum(issues, "cron.harness.invalid", `${prefix}.harness`, item.harness, harnessEnum);
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
      let model: string | undefined;
      if (item.model !== undefined) {
        if (typeof item.model === "string" && item.model.trim().length > 0) model = item.model;
        else issues.add("cron.model.invalid", `${prefix}.model`, "model must be a non-empty string (harness model id)");
      }
      let timeoutSec: number | undefined;
      if (item.timeoutSec !== undefined) {
        // A positive whole number of seconds. Reject 0/negative/NaN: a zero budget
        // kills every run instantly and a float carries no meaning for a wall-clock
        // kill, so both must fail loud rather than be silently coerced.
        const t = item.timeoutSec;
        if (typeof t === "number" && Number.isInteger(t) && t > 0) timeoutSec = t;
        else issues.add("cron.timeoutSec.invalid", `${prefix}.timeoutSec`, "timeoutSec must be a positive integer (seconds)");
      }
      let stallSec: number | undefined;
      if (item.stallSec !== undefined) {
        // 0 disables the watchdog; a negative/float/string value has no meaning.
        const s = item.stallSec;
        if (typeof s === "number" && Number.isInteger(s) && s >= 0) stallSec = s;
        else issues.add("cron.stallSec.invalid", `${prefix}.stallSec`, "stallSec must be a non-negative integer (seconds; 0 disables)");
      }
      let preventSleep: boolean | undefined;
      if (item.preventSleep !== undefined) {
        // Only a real boolean: `"false"` as a string must not silently read as true.
        if (typeof item.preventSleep === "boolean") preventSleep = item.preventSleep;
        else issues.add("cron.preventSleep.invalid", `${prefix}.preventSleep`, "preventSleep must be a boolean");
      }
      if (issues.issues.length === before) {
        crons.push({
          id: id as string,
          schedule: schedule as string,
          harness: item.harness as Harness,
          ...(prompt !== undefined ? { prompt } : {}),
          ...(target !== undefined ? { target } : {}),
          ...(tools !== undefined ? { tools } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(timeoutSec !== undefined ? { timeoutSec } : {}),
          ...(stallSec !== undefined ? { stallSec } : {}),
          ...(preventSleep !== undefined ? { preventSleep } : {}),
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
