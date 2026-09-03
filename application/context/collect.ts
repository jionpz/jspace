// application/context/collect.ts — workbench state collection for the
// context injection hooks (`jspace context session-start` / `turn`).
// Each collector is independent and fails quietly: a missing/wrong state
// degrades to an omitted field, never an error. The gate (gate.ts) decides
// when to emit anything at all; this module only answers "what is the state".
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HubV1 } from "../../core/contracts/hub.ts";
import type { IncidentCollection } from "../automation/incidents.ts";
import type { PendingWriteEnvelopeV1 } from "../../core/contracts/pending.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";
import { readIncidents } from "../automation/incidents.ts";
import { readJournals } from "../ingest/journal.ts";
import { countInbox } from "../registry/inbox.ts";
import { readEnvelopes } from "../pending/envelope.ts";
import type { ProfileState, ProjectState, RecentKnowledgeEntry } from "./project-states.ts";
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
  /** Damaged pending envelope files (unreadable .APPLY.json) — surfaced like
   *  damaged incidents/runs, never silently dropped (visible-degradation rule). */
  pendingDamaged: number;
  /** Damaged ingest journal files (unreadable .jspace/state/ingest/*.json) —
   *  symmetric with pendingDamaged; decode failures must be forwarded. */
  ingestDamaged: number;
  /** Open cron incidents (cronId + failureClass). */
  cronIncidents: { cronId: string; failureClass: string }[];
  /** Files in the filehub _inbox (0 when no filehub / empty). */
  inboxCount: number;
  /** Active project state cards, surfaced by the session-start injection leg.
   *  Populated by collectActiveProjects (async, gbrain-backed); the sync
   *  collectors never touch it. Empty when gbrain is unavailable — the
   *  project line is advisory, never a gate. */
  projects: ProjectState[];
  /** Active workbench preference cards, surfaced by the session-start injection
   *  leg. Populated by collectActiveProfiles (async, gbrain-backed); the sync
   *  collectors never touch it. Independent of `projects` (own cap of 4). */
  profiles: ProfileState[];
  /** Recent decisions/lessons/knowledge pages (flywheel-boost: gives AI
   *  awareness of prior learnings, not just current state). */
  recentKnowledge: RecentKnowledgeEntry[];
  /** hub.json is missing or malformed — the gate turns this into a visible
   *  alert instead of a silent "clean state" (visible-degradation rule). */
  hubBroken: boolean;
}

export interface CollectDeps {
  readHub: (root: string) => HubV1;
  hubOk: (root: string) => boolean;
  resolveFilehubRoot: (root: string) => string | null;
  readEnvelopes: (fhRoot: string) => { records: PendingWriteEnvelopeV1[]; issues: ContractIssue[] };
  readIncidents: (root: string) => IncidentCollection;
  /** Count files in the filehub _inbox (0 when absent/empty). Resolves the
   *  filehub root itself, so it takes root — kept in deps so the collector
   *  never touches the filesystem directly (unit-testable with stubs). */
  readInboxCount: (root: string) => number;
  /** Damaged ingest journal issues for a workbench root (decode failures must
   *  be forwarded, never silently dropped — symmetric with readEnvelopes). */
  readIngestIssues: (root: string) => { issues: ContractIssue[] };
  /** One-line summary of a domain (workspace/<id>/domain.json `summary`),
   *  or null when absent/unreadable. Path is workbench-relative. */
  readDomainSummary: (root: string, path: string) => string | null;
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
    return countInbox(inbox);
  },
  readIngestIssues: readJournals,
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
    pendingDamaged: 0,
    ingestDamaged: 0,
    cronIncidents: [],
    inboxCount: 0,
    hubBroken: false,
    projects: [],
    profiles: [],
    recentKnowledge: [],
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
      const { records, issues } = deps.readEnvelopes(fh);
      const actionable = records.filter((e) => e.status === "staged" || e.status === "terminal_failed");
      state.pendingCount = actionable.length;
      state.pendingProducers = [...new Set(actionable.map((e) => e.producer))];
      state.pendingDamaged = issues.length;
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

  // ingest journal decode issues (workbench root — independent of filehub).
  try {
    state.ingestDamaged = deps.readIngestIssues(root).issues.length;
  } catch {
    // ingest unreadable: field stays at default
  }

  return state;
}
