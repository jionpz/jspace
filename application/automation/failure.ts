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

/** Evidence that the HOST slept under the run, not that the upstream failed.
 *  The harness detects this itself and says so verbatim:
 *    connection { code: "StreamSuspended",
 *                 message: "Stream watchdog detected system suspend; aborting" }
 *    formatted: "Connection lost while your computer was asleep"
 *  It matters because the same symptom — a ~960s "Request timed out." and a
 *  run that burns its whole budget — used to be filed as an upstream stall, so
 *  the fix went to the provider instead of to the machine (2026-10-27: three
 *  crons; transcript gaps matched the pmset sleep windows second for second).
 *
 *  This is a PARTIAL signal by construction: a sleep that the harness does not
 *  notice (e.g. the process is mid-tool-call) still classifies as `timeout`.
 *  Never present `system_sleep` as a complete detector. */
const SYSTEM_SLEEP = /(streamsuspended|connection lost while your computer was asleep|system suspend|sleep watchdog)/i;

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

  // Ahead of `timeout` on purpose: a sleep-induced failure ALWAYS sets
  // timedOut, so letting the timeout branch win would make this reason
  // unreachable. Checked against the raw output (not meaningfulOutput) because
  // the suspend evidence is a structured api_error line, not noise.
  if (SYSTEM_SLEEP.test(input.output)) return "system_sleep";

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
