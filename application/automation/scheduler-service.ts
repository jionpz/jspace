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
import { type SchedulerAdapter, type SchedulerEnv } from "../../adapters/scheduler/types.ts";

export interface SchedulerInstallDeps {
  tag: string; // workbench tag from marker workbench_id
  adapter: SchedulerAdapter;
  env: SchedulerEnv;
  /** Optional: fail install/rehearsal before touching the scheduler when a
   *  skill-target cron's skill is unknown/missing/stale. Returns a fix message,
   *  or null when all target crons validate. */
  validateSkillTargets?: (enabled: CronDefinition[]) => string | null;
}

/** Build the desired task set for one workbench's enabled crons. Content
 *  compilation is adapter-internal (adapter.buildContent) — application never
 *  switches on platform to produce install content. */
export function buildDesired(crons: CronDefinition[], tag: string, root: string, env: SchedulerEnv, adapter: SchedulerAdapter): DesiredTask[] {
  return crons.map((c) => ({
    taskId: adapter.identity(tag, c.id).taskId, // canonical platform handle — single source
    cronId: c.id,
    schedule: c.schedule,
    // argv[0] is the jspace binary the scheduler will exec — part of the
    // comparison key so a stale/diverged path is repaired by install instead of
    // comparing equal forever (2026-10-13: inbox-tidy's plist pointed at a
    // months-old dev build and no install ever noticed).
    // `timeoutSec` rides the installed argv because that is the ONLY channel
    // launchd/cron/schtasks give a definition to reach the scheduled run: the
    // entry is argv `cron run --id <id> --dir <root>` and nothing is recomputed
    // at trigger time. Baking it here also puts it in the reconciliation key
    // (invocationArgv), so editing the budget produces an update op instead of
    // reporting "up to date" forever — the PATH (#50) and argv[0] failure mode
    // for the third time.
    argv: invocationArgv({ cronId: c.id, workbench: root, ...(c.timeoutSec !== undefined ? { timeoutSec: c.timeoutSec } : {}) }, env.jspaceBinary).join(" "),
    // A platform that ignores env.path declares so by not reading it back
    // (win32's schtasks); leaving the field undefined there keeps the
    // comparison from drifting on a value that was never written.
    envPath: adapter.platform === "win32" ? undefined : env.path,
    content: adapter.buildContent(c, tag, root, env),
  }));
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
  // How ops land is adapter-internal: darwin/win32 apply one op per cron, linux
  // re-derives the whole crontab block from the enabled set (applyBatch).
  const results = deps.adapter.applyBatch(ops, enabled, deps.tag, root, deps.env);
  return { lines: [`jspace: ok: cron install applied ${ops.length} change(s)`, ...results] };
}
