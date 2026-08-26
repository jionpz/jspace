// application/diagnostics/checks/crons.ts — cron config + scheduler health.
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { readIncidents } from "../../automation/incidents.ts";
import type { CronsDeps, CronLike } from "../deps.ts";

/** Cron configuration + scheduler health: schedule parse, linux daemon, enabled
 *  but not installed, stale installed tasks, open/damaged incidents. */
export function checkCrons(root: string, cron: CronsDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  let crons: CronLike[];
  try {
    crons = cron.loadCrons(root).crons;
  } catch (e) {
    diags.push({ severity: "warning", code: "cron.file_unreadable", path: "cron", message: `cron.json unreadable: ${e instanceof Error ? e.message : String(e)}` });
    crons = [];
  }
  let installedCheckable = true;
  let installedIds = new Set<string>();
  if ((cron.platform ?? process.platform) === "linux") {
    const health = cron.linuxCronHealth();
    if (health.crontab === "missing-cmd") {
      diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "crontab command not found on this system; jspace cron cannot install tasks" });
    } else if (health.crontab === "missing") {
      diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "no crontab installed for this user; jspace cron cannot install tasks (run crontab -e to create one)" });
    } else if (health.crontab === "unverifiable") {
      diags.push({ severity: "info", code: "cron.crontab_unverifiable", path: "cron", message: "cron install state cannot be verified here (sandbox/namespace isolation hides the host crontab); check crontab -l on the host" });
    }
    if (health.service === "stopped") {
      diags.push({ severity: "warning", code: "cron.daemon_stopped", path: "cron", message: "cron daemon not running; scheduled tasks won't fire until it starts" });
    } else if (health.service === "unverifiable") {
      diags.push({ severity: "info", code: "cron.daemon_unverifiable", path: "cron", message: "cron daemon status cannot be verified here (sandbox/namespace isolation hides the host process); check on the host" });
    }
    if (health.crontab === "ok") {
      installedIds = new Set(cron.installedCronIds(root));
    } else if (health.crontab === "missing" || health.crontab === "missing-cmd") {
      installedIds = new Set();
    }
    installedCheckable = health.crontab !== "unverifiable";
  } else {
    installedIds = new Set(cron.installedCronIds(root));
  }
  if (crons.length > 0) {
    const officialSkills = new Set(cron.officialSkillNames());
    for (const c of crons) {
      if (!c.target && officialSkills.has(c.id)) {
        diags.push({
          severity: "info",
          code: "cron.inline_prompt_legacy",
          path: `cron.${c.id}`,
          message: `cron ${c.id} carries an inline prompt while bundled skill ${c.id} owns the same contract; switch to target: {kind: "skill", skill: "${c.id}", entrypoint: "weekly"} so the contract follows jspace workspace upgrade`,
        });
      }
    }
    if (installedCheckable) {
      for (const c of crons) {
        if (c.enabled && !installedIds.has(c.id)) {
          diags.push({ severity: "warning", code: "cron.not_installed", path: `cron.${c.id}`, message: `cron ${c.id} enabled but not installed (run jspace cron install)` });
        }
      }
      for (const id of installedIds) {
        if (!crons.some((c) => c.id === id)) {
          diags.push({ severity: "warning", code: "cron.stale_task", path: `cron.${id}`, message: `stale scheduled task ${id} (cron removed; run jspace cron uninstall)` });
        }
      }
    }
  }
  const incRead = readIncidents(root);
  const openCron = incRead.records.filter((i) => i.status === "open");
  if (openCron.length > 0) {
    diags.push({
      severity: "warning",
      code: "cron.open_incidents",
      path: "cron",
      message: `${openCron.length} open cron incident(s): ${openCron.map((i) => `${i.cronId}[${i.failureClass}]`).join(", ")} (check with jspace cron failures)`,
    });
  }
  for (const issue of incRead.issues) {
    diags.push({
      severity: "warning",
      code: "cron.incident_decode",
      path: `incidents.${issue.path}`,
      message: `incident record unreadable: ${issue.message}`,
    });
  }
  return diags;
}
