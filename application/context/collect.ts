// application/context/collect.ts — workbench state collection for the
// context injection hooks (`jspace context session-start` / `turn`).
// Each collector is independent and fails quietly: a missing/wrong state
// degrades to an omitted field, never an error. The gate (gate.ts) decides
// when to emit anything at all; this module only answers "what is the state".
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HubV4 } from "../../core/contracts/hub.ts";
import type { IncidentCollection } from "../automation/incidents.ts";
import type { PendingWriteEnvelopeV1 } from "../../core/contracts/pending.ts";
import { readIncidents } from "../automation/incidents.ts";
import { readEnvelopes } from "../pending/envelope.ts";
import { loadHub } from "../workspace/state.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";

export interface WorkbenchState {
  /** Registered domain ids (empty when none). */
  domains: string[];
  /** Registered domain entries (id + relative path + one-line summary if any). */
  domainsDetail: { id: string; path: string; summary: string }[];
  /** Actionable pending gbrain writes (staged / terminal_failed). */
  pendingCount: number;
  /** Producer names of actionable pending writes (for the next-action hint). */
  pendingProducers: string[];
  /** Open cron incidents (cronId + failureClass). */
  cronIncidents: { cronId: string; failureClass: string }[];
  /** Files in the filehub _inbox (0 when no filehub / empty). */
  inboxCount: number;
  /** hub.json is missing or malformed — the gate turns this into a visible
   *  alert instead of a silent "clean state" (visible-degradation rule). */
  hubBroken: boolean;
}

export interface CollectDeps {
  readHub: (root: string) => HubV4;
  hubOk: (root: string) => boolean;
  resolveFilehubRoot: (root: string) => string | null;
  readEnvelopes: (fhRoot: string) => PendingWriteEnvelopeV1[];
  readIncidents: (root: string) => IncidentCollection;
  /** Count files in the filehub _inbox (0 when absent/empty). Resolves the
   *  filehub root itself, so it takes root — kept in deps so the collector
   *  never touches the filesystem directly (unit-testable with stubs). */
  readInboxCount: (root: string) => number;
  /** One-line summary of a domain (workspace/<id>/domain.json `summary`),
   *  or null when absent/unreadable. Path is workbench-relative. */
  readDomainSummary: (root: string, path: string) => string | null;
}

function countInboxFiles(dir: string): number {
  // Top-level entries only — matches `jspace inbox status` so the hook's
  // "N 份待整理" always agrees with the number the user sees. A directory
  // counts as one pending item (asset-ingest files it wholesale). Capped to
  // avoid a pathological inbox stalling the hook.
  const MAX_INBOX_ENTRIES = 10000;
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (n >= MAX_INBOX_ENTRIES) break;
    if (name.startsWith(".")) continue;
    n += 1;
  }
  return n;
}

function readDomainSummary(root: string, path: string): string | null {
  try {
    const raw = readFileSync(join(root, path, "domain.json"), "utf-8");
    const doc = JSON.parse(raw) as { summary?: unknown };
    return typeof doc.summary === "string" && doc.summary.trim() ? doc.summary.trim() : null;
  } catch {
    return null;
  }
}

/** Production deps — every collector reads real workbench files. */
const realDeps: CollectDeps = {
  readHub: loadHub,
  hubOk: (root) => readWorkbenchState(root).hub.status === "ok",
  resolveFilehubRoot,
  readEnvelopes,
  readIncidents,
  readInboxCount: (root) => {
    const fh = resolveFilehubRoot(root);
    if (fh === null) return 0;
    const inbox = join(fh, "_inbox");
    if (!existsSync(inbox) || !statSync(inbox).isDirectory()) return 0;
    return countInboxFiles(inbox);
  },
  readDomainSummary,
};

/** Collect the workbench state. Never throws: each collector is wrapped and
 *  failures degrade to defaults (the state is advisory context, not a gate). */
export function collectWorkbenchState(root: string, deps: CollectDeps = realDeps): WorkbenchState {
  const state: WorkbenchState = {
    domains: [],
    domainsDetail: [],
    pendingCount: 0,
    pendingProducers: [],
    cronIncidents: [],
    inboxCount: 0,
    hubBroken: false,
  };

  // hub.json / domains — a broken hub is surfaced, not swallowed.
  try {
    if (!deps.hubOk(root)) {
      state.hubBroken = true;
    } else {
      const hub = deps.readHub(root);
      state.domains = hub.domains.map((d) => d.id);
      state.domainsDetail = hub.domains.map((d) => ({
        id: d.id,
        path: d.path,
        summary: deps.readDomainSummary(root, d.path) ?? "",
      }));
    }
  } catch {
    state.hubBroken = true;
  }

  // filehub-backed: pending envelopes + inbox (same resolution as pending/ingest).
  try {
    const fh = deps.resolveFilehubRoot(root);
    if (fh !== null) {
      const envs = deps.readEnvelopes(fh);
      const actionable = envs.filter((e) => e.status === "staged" || e.status === "terminal_failed");
      state.pendingCount = actionable.length;
      state.pendingProducers = [...new Set(actionable.map((e) => e.producer))];
      state.inboxCount = deps.readInboxCount(root);
    }
  } catch {
    // filehub unreadable: fields stay at defaults
  }

  // cron incidents.
  try {
    state.cronIncidents = deps
      .readIncidents(root)
      .records.filter((i) => i.status === "open")
      .map((i) => ({ cronId: i.cronId, failureClass: i.failureClass }));
  } catch {
    // incidents unreadable: fields stay at defaults
  }

  return state;
}
