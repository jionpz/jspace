// application/workspace/doctor.ts — `jspace doctor` use case.
// Business logic moved out of cli/cmds.ts cmdDoctor. Cron checks are injected
// (cli/cron.ts still owns the scheduler surface until Child C); everything here
// is read-only diagnostics with severity-tagged output.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { inspectWorkbench, type InspectEnv } from "../../core/registry/inspect.ts";
import {
  primaryPathForResourceType,
  resolveEffectiveRegistry,
} from "../../core/registry/effective.ts";
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
  const diagnostics = inspectWorkbench(env);
  const errors = diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  // filehub asset-layer checks (warnings only, never blocking).
  if (reads.hub.status === "ok") {
    const local = reads.local.status === "ok" ? reads.local.value : null;
    const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
    const fhRoot = primaryPathForResourceType(effective, "filehub");
    if (!fhRoot) {
      warnings.push(
        "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
      );
    } else {
      const inboxDir = join(fhRoot, "_inbox");
      if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
        warnings.push(`filehub: _inbox missing: ${inboxDir}`);
      } else {
        const unfiled = countFiles(inboxDir);
        if (unfiled > 0) {
          warnings.push(
            `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")`,
          );
        }
      }
      const stagedDir = join(fhRoot, ".jspace-logs");
      if (existsSync(stagedDir)) {
        const applies = readdirSync(stagedDir).filter((n) => n.endsWith(".APPLY.md"));
        if (applies.length > 0) {
          warnings.push(
            `filehub: ${applies.length} pending staged gbrain write(s) (*.APPLY.md in .jspace-logs); apply when gbrain lock frees (check jspace cron failures)`,
          );
        }
      }
    }
  }

  // cron configuration checks (read-only; warnings only).
  const crons = cron.loadCrons(root).crons;
  for (const c of crons) {
    try {
      cron.parseSchedule(c.schedule);
    } catch {
      warnings.push(`cron ${c.id}: invalid schedule "${c.schedule}"`);
    }
  }
  if (process.platform === "linux") {
    const health = cron.linuxCronHealth();
    if (!health.crontab) warnings.push("crontab command not found on this system; jspace cron cannot install tasks");
    if (!health.service) warnings.push("cron daemon not running; scheduled tasks won't fire until it starts");
  }
  const installedIds = new Set(cron.installedCronIds(root));
  if (crons.length > 0) {
    for (const c of crons) {
      if (c.enabled && !installedIds.has(c.id)) {
        warnings.push(`cron ${c.id} enabled but not installed (run jspace cron install)`);
      }
    }
    for (const id of installedIds) {
      if (!crons.some((c) => c.id === id)) {
        warnings.push(`stale scheduled task com.jspace.cron.${id} (cron removed; run jspace cron uninstall)`);
      }
    }
  }
  const failedPath = join(root, ".jspace", "logs", "cron-failed.md");
  if (isFile(failedPath)) {
    const failed = readFileSync(failedPath, "utf-8").split("\n").filter((l) => l.startsWith("- ")).length;
    if (failed > 0) {
      warnings.push(`${failed} failed cron run(s) recorded in .jspace/logs/cron-failed.md (check with jspace cron status)`);
    }
  }

  return {
    exitCode: errors.length > 0 ? 1 : undefined,
    lines: [
      `jspace: doctor ${errors.length > 0 ? "failed" : "ok"}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    ],
    errors,
    warnings,
  };
}
