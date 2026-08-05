// application/automation/runs.ts — structured run records (.jspace/state/runs/).
// Machine truth for cron status; prose logs stay as human payloads referenced
// by outputLog. Written by the executor on every run.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { decodeRunRecord, type RunRecordV1 } from "../../core/contracts/run-record.ts";
import { readJsonRecords } from "../fs.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";

const RUNS_DIR = join(CONFIG_DIR, "state", "runs");

export type { RunStatus } from "../../core/contracts/run-record.ts";
export type RunRecord = RunRecordV1;

function runsDir(root: string, cronId: string): string {
  return join(root, RUNS_DIR, cronId);
}

export function writeRun(root: string, cronId: string, record: RunRecord): void {
  const dir = runsDir(root, cronId);
  mkdirSync(dir, { recursive: true });
  writeBytesAtomic(join(dir, `${record.id}.json`), JSON.stringify({ ...record, version: 1 }, null, 2) + "\n");
}

export interface RunCollection {
  records: RunRecord[];
  /** damaged/corrupt run files in this cron's runs dir (never silently dropped). */
  issues: ContractIssue[];
}

export function readRuns(root: string, cronId: string): RunCollection {
  return readJsonRecords(runsDir(root, cronId), {
    ext: ".json",
    decode: decodeRunRecord,
    sort: (a, b) => a.startedAt.localeCompare(b.startedAt),
  });
}

export function lastRun(root: string, cronId: string): RunRecord | null {
  const { records } = readRuns(root, cronId);
  return records.length > 0 ? records[records.length - 1] : null;
}
