// application/automation/incidents.ts — incident state machine
// (.jspace/state/incidents/). A failed/suspect run opens or updates an incident
// keyed by cron + failure class; a successful retry resolves it; `cron ack`
// records acknowledgment (evidence retained) so it stops alerting.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";

const INCIDENTS_DIR = join(CONFIG_DIR, "state", "incidents");

export type FailureClass = "failed" | "suspect" | "batch-stale";
export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface Incident {
  id: string;
  cronId: string;
  failureClass: FailureClass;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  evidence: string[]; // run ids / log paths
}

function dir(root: string): string {
  return join(root, INCIDENTS_DIR);
}

function localStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

export function readIncidents(root: string): Incident[] {
  let names: string[];
  try {
    names = readdirSync(dir(root));
  } catch {
    return [];
  }
  const out: Incident[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const inc = JSON.parse(readFileSync(join(dir(root), n), "utf-8")) as Incident;
      if (inc && typeof inc.status === "string") out.push(inc);
    } catch {
      /* skip corrupt incident */
    }
  }
  return out.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

function writeIncident(root: string, inc: Incident): void {
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(dir(root), `${inc.id}.json`), JSON.stringify(inc, null, 2) + "\n", "utf-8");
}

/** Open a new incident for cron+failureClass, or re-open/update an existing
 *  non-resolved one, appending the latest evidence. */
export function openOrUpdate(root: string, cronId: string, failureClass: FailureClass, runId: string): Incident {
  const existing = readIncidents(root).find(
    (i) => i.cronId === cronId && i.failureClass === failureClass && i.status !== "resolved",
  );
  if (existing) {
    const updated: Incident = {
      ...existing,
      status: "open",
      evidence: [...existing.evidence.filter((e) => e !== runId), runId],
    };
    writeIncident(root, updated);
    return updated;
  }
  const inc: Incident = {
    id: crypto.randomUUID(),
    cronId,
    failureClass,
    status: "open",
    openedAt: localStamp(),
    evidence: [runId],
  };
  writeIncident(root, inc);
  return inc;
}

/** A successful run resolves every open/acknowledged incident for that cron. */
export function resolveIncidents(root: string, cronId: string): void {
  for (const inc of readIncidents(root)) {
    if (inc.cronId === cronId && inc.status !== "resolved") {
      writeIncident(root, { ...inc, status: "resolved", resolvedAt: localStamp() });
    }
  }
}

/** Acknowledge open incidents (all, or just one cron). Returns how many were acked. */
export function ackIncidents(root: string, cronId?: string): number {
  let n = 0;
  for (const inc of readIncidents(root)) {
    if (inc.status !== "open") continue;
    if (cronId !== undefined && inc.cronId !== cronId) continue;
    writeIncident(root, { ...inc, status: "acknowledged", acknowledgedAt: localStamp() });
    n++;
  }
  return n;
}

/** Incidents that still alert (open, not acknowledged). */
export function openIncidents(root: string): Incident[] {
  return readIncidents(root).filter((i) => i.status === "open");
}
