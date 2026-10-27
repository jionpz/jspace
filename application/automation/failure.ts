// application/automation/failure.ts — pure mapping from a finished run's
// observable signals to a machine-readable failure reason. No process I/O and
// no raw output leaves this module: the RunRecord stores only the enum, while
// the prose log keeps the (truncated) detail.
import type { RunFailureReason } from "../../core/contracts/run-record.ts";

export interface FailureInput {
  exit: number;
  timedOut: boolean;
  stalled: boolean;
  batchStale: boolean;
  /** stdout+stderr as captured by the spawn adapter (already capped). */
  output: string;
}

/** A known non-fatal claude-code warning in this environment: the configured
 *  model id is echoed as `unrecognized_model` even on successful runs (and from
 *  `generate_session_title`). It must never be treated as the root cause. */
const NON_FATAL_MODEL_NOISE = /\[claude-code:unrecognized_model\]|generate_session_title|session title/i;

const SPAWN_ERROR = /jspace: spawn error:/i;
const AUTH = /(not logged in|invalid api key|authentication[_ ]error|unauthorized)/i;
const AUTH_HTTP = /\b(401|403)\b[^\n]*(unauthorized|forbidden|auth)/i;
const API_STALL = /(request timed out|api[_ ]error|apiconnectionerror|econnreset|etimedout|socket hang up|overloaded_error|502 bad gateway|503 service unavailable|rate limit exceeded)/i;
const MODEL = /(model not found|invalid model|unknown model|model[^\n]*does not exist)/i;

/** Drop lines whose only signal is the non-fatal model warning; classification
 *  then works on the remaining text. */
function meaningfulOutput(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !NON_FATAL_MODEL_NOISE.test(line))
    .join("\n");
}

/** Classify a finished run. `undefined` means the run is genuinely ok; the
 *  caller decides status separately so the existing three-state contract stays
 *  the source of truth. */
export function classifyFailure(input: FailureInput): RunFailureReason | undefined {
  if (input.stalled) return "stalled";
  if (input.timedOut) return "timeout";

  if (input.exit === 0) {
    if (input.batchStale) return "batch_stale";
    if (input.output.trim().length === 0) return "empty_output";
    return undefined;
  }

  const text = meaningfulOutput(input.output);
  if (SPAWN_ERROR.test(text)) return "spawn_error";
  if (AUTH.test(text) || AUTH_HTTP.test(text)) return "auth";
  if (API_STALL.test(text)) return "api_stall";
  if (MODEL.test(text)) return "model";
  return "exit_nonzero";
}
