// application/automation/use-cases.ts — cron definition management use cases
// (moved from cli/cron.ts cmdCronAdd/List/Remove). Installed-task checks are
// injected (launchd plist inspection lands with the scheduler adapters).
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { HARNESSES, type Harness } from "../../core/contracts/cron.ts";
import { isId } from "../../core/contracts/ids.ts";
import { findIndex } from "../registry/helpers.ts";
import { ackIncidents } from "./incidents.ts";
import { loadCrons, parseSchedule, saveCrons } from "./definitions.ts";
import { isWindowsInstallable } from "../../core/shared/schedule.ts";

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
  platform: NodeJS.Platform = process.platform,
): CmdResult {
  const data = loadCrons(root);
  if (!isId(id)) fail(`invalid cron id: ${id} (lowercase letters, digits, hyphens)`);
  if (findIndex(data.crons, id) !== null) fail(`duplicate cron id: ${id}`);
  if (!(HARNESSES as readonly string[]).includes(harness)) {
    fail(`invalid harness: ${harness} (choose from ${HARNESSES.join(", ")})`);
  }
  if (!prompt.trim()) fail("prompt must be non-empty");
  parseSchedule(schedule); // validate
  // Same boundary as `cron install`: win32 only schedules DAILY/WEEKLY (month=*).
  // Reject at add time instead of letting a non-installable cron through to a
  // later install failure (PLATFORMS.md over-sell fix, issue #9 #9-05).
  if (platform === "win32" && !isWindowsInstallable(schedule)) {
    fail(`cron ${id}: schedule "${schedule}" not supported on Windows (MVP: DAILY/WEEKLY with month=*); "jspace cron install" cannot create it`);
  }
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
    return { lines: [], data: { schema_version: data.schema_version, crons: data.crons } };
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
