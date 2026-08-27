// application/diagnostics/checks/writeback.ts — session write-back habit gate.
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { readBriefing } from "../../context/briefing.ts";

/** Sessions to accumulate before the habit gate speaks: a week-ish of activity,
 *  so a freshly initialized workbench never gets nagged. */
export const WRITEBACK_HABIT_SESSION_THRESHOLD = 5;

/** Write-back habit gate (E): the reminder leg is demonstrably running (session
 *  milestones recorded + at least one closing nudge spent), so ask the user to
 *  verify the *write* leg with the provenance tag.
 *
 *  Deliberately offline: doctor never queries gbrain (`08-10-doctor-drift-checks`
 *  R4), so this can only say "unverified", never "write-back rate is 0". The
 *  precise ratio stays with workbench-retro check 1. info-only and never
 *  escalated — an all-manual write-back cadence is a legitimate choice, exactly
 *  like `cron.all_disabled`. */
export function checkWritebackHabit(root: string): RegistryDiagnostic[] {
  const { state } = readBriefing(root);
  if (!state) return []; // no session-start milestone: nothing to say about habits
  if (state.session_count < WRITEBACK_HABIT_SESSION_THRESHOLD) return [];
  // Absent nudge marker = the turn hook never claimed one (old CLI / turn hook
  // not running). That is a wiring question for briefing.stale, not a habit one.
  if (state.writeback_nudge_for_session === undefined) return [];
  if (state.writeback_nudge_for_session < 1) return [];
  return [
    {
      severity: "info",
      code: "memory.writeback_habit_unverified",
      path: "memory.writeback",
      message: `${state.session_count} session(s) recorded with the closing nudge already spent, but doctor never queries gbrain — verify the session write-back leg yourself with 'gbrain list --type note --tag source:session -n 20' (precise rate: workbench-retro check 1); to persist facts say 「收工」 to run memory-writeback with tags: source:session. This diagnostic only reminds, it never writes gbrain.`,
    },
  ];
}
