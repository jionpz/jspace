// application/automation/use-cases.ts — cron definition management use cases
// (moved from cli/cron.ts cmdCronAdd/List/Remove). Installed-task checks are
// injected (launchd plist inspection lands with the scheduler adapters in M5).
import { fail } from "../errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { HARNESSES, type CronDefinition, type Harness } from "../../core/contracts/cron.ts";
import { isId } from "../../core/contracts/ids.ts";
import { findIndex } from "../registry/helpers.ts";
import { ackIncidents } from "./incidents.ts";
import { loadCrons, parseSchedule, saveCrons } from "./definitions.ts";
import {
  planReconciliation,
  type DesiredTask,
  type InstalledTask,
  type SchedulerOp,
} from "./scheduler.ts";

export interface CronInstalledCheck {
  isInstalled: (cronId: string) => boolean;
}

export function cronAdd(
  root: string,
  id: string,
  schedule: string,
  harness: string,
  prompt: string,
  disabled: boolean,
  deps: CronInstalledCheck,
): CmdResult {
  const data = loadCrons(root);
  if (!isId(id)) fail(`invalid cron id: ${id} (lowercase letters, digits, hyphens)`);
  if (findIndex(data.crons, id) !== null) fail(`duplicate cron id: ${id}`);
  if (!(HARNESSES as readonly string[]).includes(harness)) {
    fail(`invalid harness: ${harness} (choose from ${HARNESSES.join(", ")})`);
  }
  if (!prompt.trim()) fail("prompt must be non-empty");
  parseSchedule(schedule); // validate
  data.crons.push({ id, schedule, harness: harness as Harness, prompt, enabled: !disabled });
  saveCrons(root, data);
  const lines = [`jspace: ok: added cron: ${id} (${schedule}, ${harness}, ${disabled ? "disabled" : "enabled"})`];
  if (deps.isInstalled(id)) {
    lines.push(`jspace: hint: cron ${id} is installed; re-run "jspace cron install" to apply changes`);
  }
  return { lines };
}

export function cronList(root: string, json: boolean): CmdResult {
  const data = loadCrons(root);
  if (json) {
    return { lines: [], data: { version: data.version, crons: data.crons } };
  }
  if (data.crons.length === 0) {
    return { lines: ["jspace: ok: no crons defined (add one with: jspace cron add <id> --schedule ... )"] };
  }
  return { lines: data.crons.map((c) => `${c.enabled ? "" : "[disabled] "}${c.id}  ${c.schedule}  ${c.harness}`) };
}

export function cronRemove(root: string, id: string, deps: CronInstalledCheck): CmdResult {
  const data = loadCrons(root);
  const index = findIndex(data.crons, id);
  if (index === null) fail(`no such cron: ${id}`);
  data.crons.splice(index, 1);
  saveCrons(root, data);
  const lines = [`jspace: ok: removed cron: ${id}`];
  if (deps.isInstalled(id)) {
    lines.push(`jspace: hint: cron ${id} is installed; re-run "jspace cron install" (or uninstall) to apply`);
  }
  return { lines };
}

export function cronSetEnabled(root: string, id: string, enabled: boolean): CmdResult {
  const data = loadCrons(root);
  const index = findIndex(data.crons, id);
  if (index === null) fail(`no such cron: ${id}`);
  data.crons[index].enabled = enabled;
  saveCrons(root, data);
  const action = enabled ? "enabled" : "disabled";
  return { lines: [`jspace: ok: ${action} cron: ${id} (run "jspace cron install" to apply)`] };
}

/** Acknowledge open incidents (all, or just one cron); evidence is retained. */
export function cronAck(root: string, id: string | undefined): CmdResult {
  const n = ackIncidents(root, id);
  const scope = id !== undefined ? ` for ${id}` : "";
  return { lines: [`jspace: ok: acknowledged ${n} incident(s)${scope}`] };
}

export interface CronInstallDeps {
  tag: string; // workbench tag from marker workbench_id
  buildDesired: (enabled: CronDefinition[]) => DesiredTask[];
  inspect: (tag: string) => InstalledTask[];
  apply: (ops: SchedulerOp[]) => string[];
  /** Optional: fail install/rehearsal before touching the scheduler when a
   *  skill-target cron's skill is unknown/missing/stale (Child D, AC-D4).
   *  Returns a fix message, or null when all target crons validate. */
  validateSkillTargets?: (enabled: CronDefinition[]) => string | null;
}

/** `cron install [--dry-run]`: reconcile desired (enabled crons, workbench-tagged)
 *  against what the platform scheduler has installed, then apply. */
export function cronInstall(root: string, dryRun: boolean, deps: CronInstallDeps): CmdResult {
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
  const desired = deps.buildDesired(enabled);
  const installed = deps.inspect(deps.tag);
  const ops = planReconciliation(desired, installed);
  if (dryRun) {
    return ops.length === 0
      ? { lines: ["jspace: ok: would install: nothing to do"] }
      : { lines: [`jspace: ok: would apply ${ops.length} change(s):`, ...ops.map((o) => `[${o.action}] ${o.taskId}`)] };
  }
  if (ops.length === 0) {
    return { lines: ["jspace: ok: cron install: up to date"] };
  }
  const results = deps.apply(ops);
  return { lines: [`jspace: ok: cron install applied ${ops.length} change(s)`, ...results] };
}
