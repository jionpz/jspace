// application/automation/status.ts — cron status / failures / check surface
// (moved from cli/cron.ts). Returns CmdResult so the CLI layer never prints
// directly; the "needs attention" exit rides the exitCode field (the workbench
// SessionStart hook probes `jspace cron check`'s exit 1).
import { join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import { loadCrons } from "./definitions.ts";
import { lastRun, readRuns } from "./runs.ts";
import { readIncidents } from "./incidents.ts";
import { readEnvelopes, envelopePath } from "../pending/envelope.ts";

export function cronLogDir(root: string, id: string): string {
  return join(root, CONFIG_DIR, "logs", "cron", id);
}

/** Find actionable pending gbrain writes: staged (needs apply) or
 *  terminal_failed (needs ack) envelopes in <filehub>/.jspace-logs/*.APPLY.json.
 *  Applied/acked envelopes no longer alert. Damaged envelope files are surfaced
 *  via issues (like damaged incidents/runs), never silently dropped. */
export function findPendingApplies(root: string): { root: string | null; paths: string[]; issues: ContractIssue[] } {
  const fh = resolveFilehubRoot(root);
  if (!fh) return { root: null, paths: [], issues: [] };
  const { records, issues } = readEnvelopes(fh);
  const actionable = records.filter((e) => e.status === "staged" || e.status === "terminal_failed");
  return { root: fh, paths: actionable.map((e) => envelopePath(fh, e.id)), issues };
}

/** `jspace cron status` — last run result per cron (all, or one). */
export function cronStatus(root: string, id?: string): CmdResult {
  const data = loadCrons(root);
  const ids = id ? [id] : data.crons.map((c) => c.id);
  if (ids.length === 0) return { lines: ["jspace: ok: no crons defined"] };
  const lines = ids.map((cid) => {
    const last = lastRun(root, cid);
    if (!last) return `${cid}: never run`;
    return `${cid}: ${last.status} (exit ${last.exit ?? "?"}, ${last.startedAt}) log ${last.outputLog}`;
  });
  return { lines };
}

/**
 * `jspace cron failures [--json]` / `jspace cron check [--json]` — one-place
 * session-start surface: recent failures + pending staged gbrain writes +
 * per-cron status. exitCode 1 when anything needs attention (for hooks/scripts).
 */
export function cronFailures(root: string): CmdResult {
  const ids = loadCrons(root).crons.map((c) => c.id);

  const { records: incidents, issues: incidentIssues } = readIncidents(root);
  const open = incidents.filter((i) => i.status === "open");
  const acknowledged = incidents.filter((i) => i.status === "acknowledged");
  const pending = findPendingApplies(root);
  const runIssues: ContractIssue[] = [];
  const crons = ids.map((id) => {
    const runs = readRuns(root, id);
    runIssues.push(...runs.issues);
    const last = runs.records.length > 0 ? runs.records[runs.records.length - 1] : null;
    return { id, status: last === null ? "never run" : last.status };
  });
  const failed = crons.filter((c) => c.status === "failed").length;
  const suspect = crons.filter((c) => c.status === "suspect").length;
  const neverRun = crons.filter((c) => c.status === "never run").length;
  // damaged state records are attention-worthy, never silently dropped
  const stateIssues = [...runIssues, ...incidentIssues, ...pending.issues];
  // alert only on open (unacknowledged) incidents, actionable pending writes,
  // or damaged machine-state records
  const needsAttention = open.length + pending.paths.length + stateIssues.length;

  const data = {
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
    damaged_state: stateIssues.map((s) => ({ code: s.code, file: s.path, message: s.message })),
    crons,
    summary: {
      failures: failed,
      suspect,
      never_run: neverRun,
      pending_applies: pending.paths.length,
      open_incidents: open.length,
      damaged_state: stateIssues.length,
      needs_attention: needsAttention,
    },
  };
  const lines = [
    "jspace: cron failures",
    `open incidents: (${open.length})`,
    ...open.map((i) => `  ${i.cronId} [${i.failureClass}] ${i.openedAt} evidence: ${i.evidence.join(", ")}`),
    `pending gbrain writes (APPLY.json): (${pending.paths.length})`,
    ...pending.paths.map((p) => `  ${p}`),
    ...(stateIssues.length > 0
      ? [`damaged state records: (${stateIssues.length})`, ...stateIssues.map((s) => `  ${s.path}: ${s.message}`)]
      : []),
    "cron status:",
    ...crons.map((c) => `  ${c.id}: ${c.status}`),
    `needs_attention: ${needsAttention}`,
  ];
  return {
    exitCode: needsAttention > 0 ? 1 : undefined,
    lines,
    data,
    warnings: stateIssues.map((s) => `${s.path}: ${s.message}`),
  };
}
