// application/workspace/doctor.ts — `jspace doctor` use case.
// Business logic moved out of cli/cmds.ts cmdDoctor. Cron checks are injected
// (cli/cron.ts still owns the scheduler surface until Child C); everything here
// is read-only diagnostics with severity-tagged output. JSON output carries the
// full diagnostics (code/severity/path) so scripts can classify errors.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import type { RegistryDiagnostic } from "../../core/contracts/diagnostics.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { inspectWorkbench, type InspectEnv } from "../../core/registry/inspect.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../core/registry/effective.ts";
import { openIncidents } from "../automation/incidents.ts";
import { readEnvelopes } from "../pending/envelope.ts";
import { isFile } from "../fs.ts";

/** Minimal cron view consumed by doctor; full cron surface lives in Child C. */
export interface CronLike {
  id: string;
  schedule: string;
  enabled: boolean;
}

export interface CronHealthDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  parseSchedule: (schedule: string) => unknown;
  installedCronIds: (root: string) => string[];
  linuxCronHealth: () => { crontab: boolean; service: boolean };
}

function countFiles(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

export function doctorWorkbench(root: string, cron: CronHealthDeps): CmdResult {
  const reads = readWorkbenchState(root);
  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: existsSync,
    isFile,
    readJson: (p) => JSON.parse(readFileSync(p, "utf-8")),
  };
  const diags: RegistryDiagnostic[] = [...inspectWorkbench(env)];

  // filehub asset-layer checks (warnings only, never blocking).
  if (reads.hub.status === "ok") {
    const local = reads.local.status === "ok" ? reads.local.value : null;
    const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
    const fhRoot = primaryPathForResourceType(effective, "filehub");
    if (!fhRoot) {
      diags.push({
        severity: "warning",
        code: "filehub.unregistered",
        path: "resources",
        message: "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
      });
    } else {
      const inboxDir = join(fhRoot, "_inbox");
      if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
        diags.push({ severity: "warning", code: "filehub.inbox_missing", path: `filehub.${fhRoot}`, message: `filehub: _inbox missing: ${inboxDir}` });
      } else {
        const unfiled = countFiles(inboxDir);
        if (unfiled > 0) {
          diags.push({ severity: "warning", code: "filehub.inbox_unfiled", path: `filehub.${fhRoot}`, message: `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")` });
        }
      }
      // actionable pending gbrain writes (staged needs apply; terminal_failed
      // needs ack). applied/acked no longer alert.
      const actionable = readEnvelopes(fhRoot).filter((e) => e.status === "staged" || e.status === "terminal_failed");
      if (actionable.length > 0) {
        diags.push({ severity: "warning", code: "filehub.pending_applies", path: `filehub.${fhRoot}/.jspace-logs`, message: `filehub: ${actionable.length} actionable pending gbrain write(s); apply with "jspace pending apply", ack terminal_failed with "jspace pending ack"` });
      }
    }
  }

  // cron configuration checks (read-only; warnings only).
  const crons = cron.loadCrons(root).crons;
  for (const c of crons) {
    try {
      cron.parseSchedule(c.schedule);
    } catch {
      diags.push({ severity: "warning", code: "cron.invalid_schedule", path: `cron.${c.id}.schedule`, message: `cron ${c.id}: invalid schedule "${c.schedule}"` });
    }
  }
  if (process.platform === "linux") {
    const health = cron.linuxCronHealth();
    if (!health.crontab) diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "crontab command not found on this system; jspace cron cannot install tasks" });
    if (!health.service) diags.push({ severity: "warning", code: "cron.daemon_stopped", path: "cron", message: "cron daemon not running; scheduled tasks won't fire until it starts" });
  }
  const installedIds = new Set(cron.installedCronIds(root));
  if (crons.length > 0) {
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
  const openCron = openIncidents(root);
  if (openCron.length > 0) {
    diags.push({
      severity: "warning",
      code: "cron.open_incidents",
      path: "cron",
      message: `${openCron.length} open cron incident(s): ${openCron.map((i) => `${i.cronId}[${i.failureClass}]`).join(", ")} (check with jspace cron failures)`,
    });
  }

  const errors = diags.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diags.filter((d) => d.severity === "warning").map((d) => d.message);
  return {
    exitCode: errors.length > 0 ? 1 : undefined,
    lines: [
      `jspace: doctor ${errors.length > 0 ? "failed" : "ok"}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    ],
    data: { diagnostics: diags, errors, warnings },
    errors,
    warnings,
  };
}
