// application/automation/scheduler-service.ts — cron install orchestration.
// Single engine for dry-run and real install: builds desired tasks (platform
// identity + content compilation), inspects the platform scheduler, plans
// reconciliation, and applies. The CLI layer only composes adapter + env and
// validates skill targets; this service owns scheduler decisions.
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { loadCrons } from "./definitions.ts";
import { invocationArgv } from "./invocation.ts";
import { planReconciliation, type DesiredTask } from "./scheduler.ts";
import { buildPlist, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp } from "../../adapters/scheduler/types.ts";
import { crontabBlock } from "../../adapters/scheduler/linux.ts";
import { schtasksArgs } from "../../adapters/scheduler/win32.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";

export interface SchedulerInstallDeps {
  tag: string; // workbench tag from marker workbench_id
  adapter: SchedulerAdapter;
  env: SchedulerEnv;
  /** Optional: fail install/rehearsal before touching the scheduler when a
   *  skill-target cron's skill is unknown/missing/stale. Returns a fix message,
   *  or null when all target crons validate. */
  validateSkillTargets?: (enabled: CronDefinition[]) => string | null;
}

/** Platform content compilation — the only place platform task content is built.
 *  taskId always comes from adapter.identity (single source). */
function contentFor(cron: CronDefinition, tag: string, root: string, env: SchedulerEnv, adapter: SchedulerAdapter): string {
  if (adapter.platform === "darwin") {
    return buildPlist(cron.id, tag, parseSchedule(cron.schedule), root, env.jspaceBinary, env.home, env.path);
  }
  if (adapter.platform === "linux") {
    // content is rebuilt as the whole workbench block at apply time
    return cron.id;
  }
  // win32: args array JSON-encoded (schtasks; paths may contain spaces)
  const tn = adapter.identity(tag, cron.id).taskId;
  const args = schtasksArgs(cron, env.jspaceBinary, root, tn);
  if (!args) fail(`cron ${cron.id}: schedule "${cron.schedule}" not supported on Windows (MVP: DAILY/WEEKLY with month=*)`);
  return JSON.stringify(args);
}

/** Build the desired task set for one workbench's enabled crons. */
export function buildDesired(crons: CronDefinition[], tag: string, root: string, env: SchedulerEnv, adapter: SchedulerAdapter): DesiredTask[] {
  return crons.map((c) => ({
    taskId: adapter.identity(tag, c.id).taskId, // canonical platform handle — single source
    cronId: c.id,
    schedule: c.schedule,
    argv: invocationArgv({ cronId: c.id, workbench: root }).join(" "),
    content: contentFor(c, tag, root, env, adapter),
  }));
}

/** Linux applies as one whole-block write (crontab is whole-file); darwin/win32
 *  apply one op per cron. Rebuilt from the FULL enabled set — a delete-only op
 *  set must not wipe still-enabled crons. Empty desired -> empty block removes
 *  the workbench's managed block (all-disabled uninstalls). */
function applyOps(ops: SchedulerOp[], enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv, adapter: SchedulerAdapter): string[] {
  if (adapter.platform === "linux") {
    const block = enabled.length === 0 ? "" : crontabBlock(enabled, tag, root, env.jspaceBinary, env.path, env.home);
    return adapter.apply({ action: "create", taskId: adapter.identity(tag, enabled[0]?.id ?? "block").taskId, content: block }, tag, root, env);
  }
  return ops.flatMap((o) => adapter.apply(o, tag, root, env));
}

/** `cron install [--dry-run]`: reconcile desired (enabled crons, workbench-tagged)
 *  against what the platform scheduler has installed, then apply. */
export function cronInstall(root: string, dryRun: boolean, deps: SchedulerInstallDeps): CmdResult {
  const data = loadCrons(root);
  if (data.crons.length === 0) fail(`no crons defined (${root}/.jspace/cron.json empty/missing)`);
  const enabled = data.crons.filter((c) => c.enabled);
  // NOTE: no early-return when `enabled` is empty — reconciliation with an
  // empty desired set deliberately produces delete ops for anything installed,
  // so disabling every cron uninstalls the platform tasks (was: left stale).
  if (deps.validateSkillTargets) {
    const fix = deps.validateSkillTargets(enabled);
    if (fix !== null) fail(fix);
  }
  const desired = buildDesired(enabled, deps.tag, root, deps.env, deps.adapter);
  const installed = deps.adapter.inspect(deps.tag, deps.env);
  const ops = planReconciliation(desired, installed);
  if (dryRun) {
    return ops.length === 0
      ? { lines: ["jspace: ok: would install: nothing to do"] }
      : { lines: [`jspace: ok: would apply ${ops.length} change(s):`, ...ops.map((o) => `[${o.action}] ${o.taskId}`)] };
  }
  if (ops.length === 0) {
    return { lines: ["jspace: ok: cron install: up to date"] };
  }
  const results = applyOps(ops, enabled, deps.tag, root, deps.env, deps.adapter);
  return { lines: [`jspace: ok: cron install applied ${ops.length} change(s)`, ...results] };
}
