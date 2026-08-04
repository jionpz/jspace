// cli/cron.ts — declarative cron definitions (.jspace/cron.json) + macOS launchd
// install + headless harness execution. Follows the registry.ts / cmds.ts idioms.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "../application/errors.ts";
import { devRoot, isCompiled } from "./embed.ts";
import { isFile, resolvePath } from "./paths.ts";
import { CONFIG_DIR } from "../core/contracts/files.ts";
import { readWorkbenchState, workbenchRoot } from "./registry.ts";
import { resolveFilehubRoot } from "../application/registry/filehub-lookup.ts";
import { loadCrons, parseSchedule, type ScheduleDict } from "../application/automation/definitions.ts";
import { harnessArgv } from "../adapters/harness/argv.ts";
import { lastRun } from "../application/automation/runs.ts";
import { openIncidents, readIncidents } from "../application/automation/incidents.ts";
import { readEnvelopes, envelopePath } from "../application/pending/envelope.ts";
import type { CronDefinition } from "../core/contracts/cron.ts";
export { parseSchedule };
export type { ScheduleDict };

export const CRON_FILE = join(CONFIG_DIR, "cron.json");

type Platform = "darwin" | "linux" | "win32";
const platform: Platform = process.platform as Platform;

/** POSIX single-quote quoting for crontab lines (paths may contain spaces/quotes). */
function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Stable short identity for a workbench root (used in Windows task names). */
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Local calendar date YYYY-MM-DD (no UTC shift). */
function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localStamp(): string {
  return `${localDate()}T${String(new Date().getHours()).padStart(2, "0")}${String(new Date().getMinutes()).padStart(2, "0")}${String(new Date().getSeconds()).padStart(2, "0")}`;
}

// ---- launchd install / uninstall ----
function plistPath(id: string): string {
  return join(homedir(), "Library", "LaunchAgents", `com.jspace.cron.${id}.plist`);
}
export function plistExists(id: string): boolean {
  return isFile(plistPath(id));
}
export function installedPlists(): string[] {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("com.jspace.cron.") && n.endsWith(".plist"));
}

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

/** IDs currently installed in the platform scheduler for this workbench. */
export function installedCronIds(root: string): string[] {
  if (platform === "darwin") {
    return installedPlists().map((n) => n.replace(/^com\.jspace\.cron\./, "").replace(/\.plist$/, ""));
  }
  if (platform === "linux") {
    const res = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
    const out = res.status === 0 ? (res.stdout ?? "") : "";
    const ids: string[] = [];
    for (const m of out.matchAll(/cron run --dir '([^']*)' --id '([^']+)'/g)) {
      const dir = m[1];
      if (resolvePath(dir) === root) ids.push(m[2]);
    }
    return ids;
  }
  if (platform === "win32") {
    const wbId = shortHash(root);
    const res = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf-8" });
    const out = res.status === 0 ? (res.stdout ?? "") : "";
    const prefix = `JSpaceCron_${wbId}_`;
    return out.split(/\r?\n/).map((l) => l.split(",")[0].replace(/^"|"$/g, ""))
      .filter((n) => n.startsWith(prefix))
      .map((n) => n.slice(prefix.length));
  }
  return [];
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
