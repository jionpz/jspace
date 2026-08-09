// application/ingest/use-cases.ts — `jspace ingest` use cases (Child E).
// Thin wrappers over the journal state machine (application/ingest/journal.ts)
// with real fs ops and filehub/project resolution. The semantic skill supplies
// the plan (target/slug/project/index) and the gbrain page content; the CLI owns
// the mechanical steps (stage copy, advance, commit remove-source, compensation).
import { copyFileSync, unlinkSync } from "node:fs";
import { isAbsolute, relative, join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import type { IngestStep } from "../../core/contracts/ingest.ts";
import {
  advanceIngest,
  beginIngest,
  completeIngest,
  completeRetryCommand,
  failIngest,
  isCleanupPending,
  readJournal,
  readJournals,
  rollbackIngest,
  type IngestFileOps,
} from "./journal.ts";
import { resolveProjectId } from "./project.ts";

const REAL_OPS: IngestFileOps = { copyFile: copyFileSync, unlink: unlinkSync };

export interface IngestBeginArgs {
  file: string;
  target: string;
  slug: string;
  project: string;
  indexLine?: string;
}

/** Begin an ingest: resolve filehub/project, compute relPath, stage a target
 *  copy and record the journal (source stays in inbox). Reports duplicate/resume
 *  idempotently instead of re-staging. */
export function ingestBegin(root: string, args: IngestBeginArgs): CmdResult {
  const fh = resolveFilehubRoot(root);
  if (!fh) fail(`jspace: no filehub registered for workbench ${root}; run "jspace filehub init" first`);
  const target = isAbsolute(args.target) ? args.target : join(fh, args.target);
  const relPath = relative(fh, target);
  if (relPath.startsWith("..") || isAbsolute(relPath)) {
    fail(`target must be under the filehub root (${fh})`);
  }
  const reads = readWorkbenchState(root);
  const hub = reads.hub.status === "ok" ? reads.hub.value : null;
  const proj = resolveProjectId(hub, args.project);
  const res = beginIngest(
    root,
    { source: args.file, target, relPath, slug: args.slug, projectId: proj.id, indexEntry: args.indexLine },
    REAL_OPS,
  );
  const lines: string[] = [];
  if (res.kind === "duplicate") {
    lines.push(`jspace: ok: already ingested (id ${res.journal.id}); skipping duplicate`);
  } else if (res.kind === "cleanup-pending") {
    // the previous commit did not prove source removal; finish it before restaging.
    return {
      exitCode: 1,
      errors: [`ingest ${res.journal.id}: source cleanup pending from a previous commit; finish it first`],
      lines: [
        `jspace: ingest ${res.journal.id}: source cleanup pending (failedStep=committed); source NOT removed`,
        `  retry: ${completeRetryCommand(res.journal.id)}`,
      ],
    };
  } else if (res.kind === "resume") {
    lines.push(`jspace: ok: ingest already in progress (id ${res.journal.id}, ${res.journal.status}); continuing`);
  } else {
    lines.push(`jspace: ok: ingest staged (id ${res.journal.id}): ${args.file} -> ${target}`);
    lines.push(`  next: write the gbrain page, then: jspace ingest advance ${res.journal.id} --gbrain`);
    lines.push(`  journal id: ${res.journal.id}`);
  }
  if (!proj.registered) {
    lines.push(`jspace: warn: project ${args.project} is not registered; using derived id ${proj.id} (run "jspace project add" to register)`);
  }
  return { lines };
}

/** Advance to the next step (gbrain / index / committed). The committed step
 *  runs the cleanup-pending machine: on source-removal failure it exits non-zero,
 *  reports the reason and the exact retry command — never a fake `source removed`. */
export function ingestAdvance(root: string, id: string, step: IngestStep): CmdResult {
  if (step === "committed") {
    const res = completeIngest(root, id, REAL_OPS);
    if (res.kind === "cleanup-pending") {
      return {
        exitCode: 1,
        errors: [`ingest ${id}: source cleanup failed: ${res.error.message}`],
        lines: [
          `jspace: ingest ${id}: source cleanup pending; source NOT removed`,
          `  retry: ${completeRetryCommand(id)}`,
        ],
      };
    }
    return { lines: [`jspace: ok: ingest ${id} -> committed (source removed)`] };
  }
  advanceIngest(root, id, step, REAL_OPS);
  return { lines: [`jspace: ok: ingest ${id} -> ${step}`] };
}

/** Mark failed with compensation for the step in progress. */
export function ingestFail(root: string, id: string, reason: string): CmdResult {
  const j = failIngest(root, id, reason, REAL_OPS);
  const lines = [`jspace: ingest ${id} failed at ${j.failedStep ?? "?"}: ${reason}`];
  if (j.failedStep === "staged") {
    lines.push("  compensated: removed staged target copy; source stays in inbox (no orphan)");
  }
  return { exitCode: 1, lines };
}

/** Explicitly abandon a staged ingest (source stays in inbox). */
export function ingestRollback(root: string, id: string): CmdResult {
  rollbackIngest(root, id, REAL_OPS);
  return { lines: [`jspace: ok: ingest ${id} rolled back (staged copy removed, source stays in inbox)`] };
}

export function ingestStatus(root: string, id: string, json: boolean): CmdResult {
  const j = readJournal(root, id);
  if (json) return { lines: [], data: j };
  const pending = isCleanupPending(j);
  const statusLine = `jspace: ingest ${id}: status=${j.status}` +
    (j.failedStep ? ` failedStep=${j.failedStep}` : "") +
    (j.failureReason ? ` reason=${j.failureReason}` : "");
  const lines = [
    statusLine,
    `  ${j.source} -> ${j.target}`,
    `  slug=${j.slug} project=${j.projectId} hash=${j.contentHash.slice(0, 8)}`,
  ];
  if (pending) {
    lines.push(`  cleanup pending: source not yet removed; finish cleanup: ${completeRetryCommand(id)}`);
  }
  return { lines };
}

export function ingestList(root: string, json: boolean): CmdResult {
  const journals = readJournals(root).records;
  if (json) {
    return { lines: [], data: { journals } };
  }
  if (journals.length === 0) return { lines: ["jspace: ok: no ingest journals"] };
  return {
    lines: journals.map((j) => {
      const st = isCleanupPending(j) ? "failed/cleanup-pending" : j.status;
      return `${j.id}  ${st}  ${j.relPath}`;
    }),
  };
}
