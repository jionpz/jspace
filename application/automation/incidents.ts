// application/automation/incidents.ts — incident state machine
// (.jspace/state/incidents/). A failed/suspect run opens or updates an incident
// keyed by cron + failure class; a successful retry resolves it; `cron ack`
// records acknowledgment (evidence retained) so it stops alerting.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { localStamp } from "../time.ts";
import { decodeIncident, type FailureClass, type IncidentV1 } from "../../core/contracts/incident.ts";
import { readJsonRecords } from "../fs.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";

const INCIDENTS_DIR = join(CONFIG_DIR, "state", "incidents");

export type { FailureClass, IncidentStatus } from "../../core/contracts/incident.ts";
export type Incident = IncidentV1;

function dir(root: string): string {
  return join(root, INCIDENTS_DIR);
}

export interface IncidentCollection {
  records: Incident[];
  /** damaged/corrupt incident files (never silently dropped). */
  issues: ContractIssue[];
}

export function readIncidents(root: string): IncidentCollection {
  return readJsonRecords(dir(root), {
    ext: ".json",
    decode: decodeIncident,
    sort: (a, b) => a.openedAt.localeCompare(b.openedAt),
  });
}

function writeIncident(root: string, inc: Incident): void {
  mkdirSync(dir(root), { recursive: true });
  writeBytesAtomic(join(dir(root), `${inc.id}.json`), JSON.stringify({ ...inc, version: 1 }, null, 2) + "\n");
}

/** Open a new incident for cron+failureClass, or re-open/update an existing
 *  non-resolved one, appending the latest evidence. */
export function openOrUpdate(root: string, cronId: string, failureClass: FailureClass, runId: string): Incident {
  const existing = readIncidents(root).records.find(
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
    version: 1,
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
  for (const inc of readIncidents(root).records) {
    if (inc.cronId === cronId && inc.status !== "resolved") {
      writeIncident(root, { ...inc, status: "resolved", resolvedAt: localStamp() });
    }
  }
}

/** Acknowledge open incidents (all, or just one cron). Returns how many were acked. */
export function ackIncidents(root: string, cronId?: string): number {
  let n = 0;
  for (const inc of readIncidents(root).records) {
    if (inc.status !== "open") continue;
    if (cronId !== undefined && inc.cronId !== cronId) continue;
    writeIncident(root, { ...inc, status: "acknowledged", acknowledgedAt: localStamp() });
    n++;
  }
  return n;
}

/** Incidents that still alert (open, not acknowledged). */
export function openIncidents(root: string): Incident[] {
  return readIncidents(root).records.filter((i) => i.status === "open");
}
