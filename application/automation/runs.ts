// application/automation/runs.ts — structured run records (.jspace/state/runs/).
// Machine truth for cron status; prose logs stay as human payloads referenced
// by outputLog. Written by the executor on every run.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";

const RUNS_DIR = join(CONFIG_DIR, "state", "runs");

export type RunStatus = "ok" | "suspect" | "failed";

export interface RunRecord {
  id: string;
  cronId: string;
  startedAt: string;
  exit: number | null;
  status: RunStatus;
  timedOut: boolean;
  /** prose log path (human payload) */
  outputLog: string;
  batchChanged: boolean;
}

function runsDir(root: string, cronId: string): string {
  return join(root, RUNS_DIR, cronId);
}

export function writeRun(root: string, cronId: string, record: RunRecord): void {
  const dir = runsDir(root, cronId);
  mkdirSync(dir, { recursive: true });
  writeBytesAtomic(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2) + "\n");
}

export function readRuns(root: string, cronId: string): RunRecord[] {
  const dir = runsDir(root, cronId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: RunRecord[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, n), "utf-8")) as RunRecord;
      if (r && typeof r.status === "string") out.push(r);
    } catch {
      /* skip corrupt record */
    }
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function lastRun(root: string, cronId: string): RunRecord | null {
  const runs = readRuns(root, cronId);
  return runs.length > 0 ? runs[runs.length - 1] : null;
}
