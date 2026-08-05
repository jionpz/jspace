// cli/cron.ts — declarative cron definitions (.jspace/cron.json) + macOS launchd
// install + headless harness execution. Follows the registry.ts / cmds.ts idioms.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { devRoot, isCompiled } from "./embed.ts";
import { workbenchRoot } from "./registry.ts";
import { resolveFilehubRoot } from "../application/registry/filehub-lookup.ts";
import { loadCrons, parseSchedule, type ScheduleDict } from "../application/automation/definitions.ts";
import { lastRun } from "../application/automation/runs.ts";
import { readIncidents } from "../application/automation/incidents.ts";
import { readEnvelopes, envelopePath } from "../application/pending/envelope.ts";
export { parseSchedule };
export type { ScheduleDict };

type Platform = "darwin" | "linux" | "win32";
const platform: Platform = process.platform as Platform;

/** Absolute jspace binary for scheduling. Compiled: process.execPath; source
 *  checkout: repo bin/jspace[.exe] (win32 probes for the .exe, H4). */
export function jspaceBinary(plat: Platform = platform): string {
  if (isCompiled()) return process.execPath;
  if (plat === "win32") {
    const exe = join(devRoot(), "bin", "jspace.exe");
    return existsSync(exe) ? exe : join(devRoot(), "bin", "jspace");
  }
  return join(devRoot(), "bin", "jspace");
}

/** Linux cron health for doctor: crontab command present + cron daemon running. */
export function linuxCronHealth(): { crontab: boolean; service: boolean } {
  const c = spawnSync("sh", ["-c", "command -v crontab"], { encoding: "utf-8" });
  const s = spawnSync("sh", ["-c", "pgrep -x crond >/dev/null 2>&1 || pgrep -x cron >/dev/null 2>&1"], { encoding: "utf-8" });
  return { crontab: (c.stdout ?? "").trim() !== "", service: s.status === 0 };
}

// ---- cron run / status ----
export function cronLogDir(root: string, id: string): string {
  return join(root, ".jspace", "logs", "cron", id);
}

export function cmdCronStatus(id?: string): void {
  const root = workbenchRoot();
  const data = loadCrons(root);
  const ids = id ? [id] : data.crons.map((c) => c.id);
  if (ids.length === 0) {
    console.log("jspace: ok: no crons defined");
    return;
  }
  for (const cid of ids) {
    const last = lastRun(root, cid);
    if (!last) {
      console.log(`${cid}: never run`);
      continue;
    }
    console.log(`${cid}: ${last.status} (exit ${last.exit ?? "?"}, ${last.startedAt}) log ${last.outputLog}`);
  }
}

// ---- cron failures (session-start check surface) ----

/** Resolve the filehub root via the shared effective registry (type:filehub,
 *  primary path), or null when unregistered/unbound — then pending scan is skipped. */
export function filehubRoot(root: string): string | null {
  return resolveFilehubRoot(root);
}

/** Find actionable pending gbrain writes: staged (needs apply) or
 *  terminal_failed (needs ack) envelopes in <filehub>/.jspace-logs/*.APPLY.json.
 *  Applied/acked envelopes no longer alert. */
export function findPendingApplies(root: string): { root: string | null; paths: string[] } {
  const fh = filehubRoot(root);
  if (!fh) return { root: null, paths: [] };
  const actionable = readEnvelopes(fh).filter((e) => e.status === "staged" || e.status === "terminal_failed");
  return { root: fh, paths: actionable.map((e) => envelopePath(fh, e.id)) };
}

/**
 * `jspace cron failures [--json]` / `jspace cron check [--json]` — one-place
 * session-start surface: recent failures + pending staged gbrain writes +
 * per-cron status. Exit 1 when anything needs attention (for hooks/scripts).
 */
export function cmdCronFailures(json: boolean, root?: string): void {
  const wb = root ?? workbenchRoot();
  const ids = loadCrons(wb).crons.map((c) => c.id);

  const incidents = readIncidents(wb);
  const open = incidents.filter((i) => i.status === "open");
  const acknowledged = incidents.filter((i) => i.status === "acknowledged");
  const pending = findPendingApplies(wb);
  const crons = ids.map((id) => {
    const last = lastRun(wb, id);
    return { id, status: last?.status ?? "never run" };
  });
  const failed = crons.filter((c) => c.status === "failed").length;
  const suspect = crons.filter((c) => c.status === "suspect").length;
  const neverRun = crons.filter((c) => c.status === "never run").length;
  // alert only on open (unacknowledged) incidents or actionable pending writes
  const needsAttention = open.length + pending.paths.length;

  if (json) {
    console.log(JSON.stringify({
      incidents: incidents.map((i) => ({
        cron: i.cronId,
        failure_class: i.failureClass,
        status: i.status,
        opened_at: i.openedAt,
        acknowledged_at: i.acknowledgedAt,
        resolved_at: i.resolvedAt,
        evidence: i.evidence,
      })),
      open_incidents: open.length,
      acknowledged_incidents: acknowledged.length,
      pending_applies: pending.paths,
      crons,
      summary: {
        failures: failed,
        suspect,
        never_run: neverRun,
        pending_applies: pending.paths.length,
        open_incidents: open.length,
        needs_attention: needsAttention,
      },
    }));
  } else {
    console.log("jspace: cron failures");
    console.log(`open incidents: (${open.length})`);
    for (const i of open) console.log(`  ${i.cronId} [${i.failureClass}] ${i.openedAt} evidence: ${i.evidence.join(", ")}`);
    console.log(`pending gbrain writes (APPLY.json): (${pending.paths.length})`);
    for (const p of pending.paths) console.log(`  ${p}`);
    console.log("cron status:");
    for (const c of crons) console.log(`  ${c.id}: ${c.status}`);
    console.log(`needs_attention: ${needsAttention}`);
  }
  process.exitCode = needsAttention > 0 ? 1 : 0;
}
