// core/contracts/run-record.ts — typed cron run record contract.
// One RunRecordV1 per cron execution, written by the executor to
// .jspace/state/runs/<cronId>/. Historical collection: a corrupt record must
// surface a diagnostic but never block reading the rest.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readBool,
  readEnum,
  readRequiredString,
  readUuid,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export const RUN_STATUSES = ["ok", "suspect", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Machine-readable failure cause. `ok` runs and legacy records omit it; the
 *  incident keeps its coarser `failureClass` (failed/suspect/batch-stale) and
 *  points at this run as evidence. */
export const RUN_FAILURE_REASONS = [
  "timeout",
  "stalled",
  "api_stall",
  "auth",
  "model",
  "spawn_error",
  "empty_output",
  "batch_stale",
  "exit_nonzero",
] as const;
export type RunFailureReason = (typeof RUN_FAILURE_REASONS)[number];

export interface RunRecordV1 {
  schema_version: 1;
  id: string; // uuid
  cronId: string;
  startedAt: string;
  exit: number | null;
  status: RunStatus;
  timedOut: boolean;
  /** prose log path (human payload, not recovery state) */
  outputLog: string;
  batchChanged: boolean;
  /** Failure cause for failed/suspect runs; absent on ok and legacy records. */
  reason?: RunFailureReason;
  /** Whole seconds from spawn to record; absent on legacy records. */
  durationSec?: number;
}

export function decodeRunRecord(input: unknown): DecodeResult<RunRecordV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("run.root.type", "run", "run record must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "schema_version", "id", "cronId", "startedAt", "exit", "status", "timedOut", "outputLog", "batchChanged",
    "reason", "durationSec",
  ] as const;
  checkNoUnknownFields(input, FIELDS, "run", "run.unknown-field", issues);
  readVersion(issues, "run.version.unsupported", "run.version", input.schema_version, [1]);
  readUuid(issues, "run.id.invalid", "run.id", input.id);
  readRequiredString(input, "cronId", "run", "run.cronId.invalid", issues);
  readRequiredString(input, "startedAt", "run", "run.startedAt.invalid", issues);
  readRequiredString(input, "outputLog", "run", "run.outputLog.invalid", issues);
  readEnum(issues, "run.status.invalid", "run.status", input.status, RUN_STATUSES);
  if (input.exit !== undefined && input.exit !== null && typeof input.exit !== "number") {
    issues.add("run.exit.invalid", "run.exit", "exit must be a number or null");
  }
  readBool(issues, "run.timedOut.invalid", "run.timedOut", input.timedOut);
  readBool(issues, "run.batchChanged.invalid", "run.batchChanged", input.batchChanged);
  if (input.reason !== undefined) {
    readEnum(issues, "run.reason.invalid", "run.reason", input.reason, RUN_FAILURE_REASONS);
  }
  if (input.durationSec !== undefined) {
    if (typeof input.durationSec !== "number" || !Number.isFinite(input.durationSec) || input.durationSec < 0) {
      issues.add("run.durationSec.invalid", "run.durationSec", "durationSec must be a non-negative number");
    }
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    id: input.id as string,
    cronId: input.cronId as string,
    startedAt: input.startedAt as string,
    exit: (input.exit ?? null) as number | null,
    status: input.status as RunStatus,
    timedOut: input.timedOut as boolean,
    outputLog: input.outputLog as string,
    batchChanged: input.batchChanged as boolean,
    ...(input.reason !== undefined ? { reason: input.reason as RunFailureReason } : {}),
    ...(input.durationSec !== undefined ? { durationSec: input.durationSec as number } : {}),
  });
}
