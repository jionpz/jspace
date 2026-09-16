// application/diagnostics/checks/session-hooks.ts — session-start hook wiring + briefing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { loadCapabilities } from "../../../adapters/harness/registry.ts";
import { isBriefingStale, readBriefing } from "../../context/briefing.ts";
import { isFile } from "../../fs.ts";
import type { SessionHooksDeps } from "../deps.ts";
import { activeHarnesses, harnessFindingSeverity, SEED_HOOK_REPAIR } from "./shared.ts";

/** Session-start briefing behavior checks (issue #13): the file-level doctor
 *  checks were not enough — a workbench can be perfectly materialized while the
 *  hook that should run `jspace context session-start` is missing/stale. */
export function checkSessionStartHooks(root: string, cron: SessionHooksDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const caps = loadCapabilities();
  const home = homedir();

  // Range rule (issue #52): only the harnesses this workbench actually uses
  // (cron-enabled, or Pi's own `.pi/` dir — see activeHarnesses) get a warning.
  // A harness that is merely installed or merely seeded is info, matching the
  // range harness.ts already applied to its own checks.
  const active = activeHarnesses(root, cron);
  let anySessionStartSignal = false;

  for (const [name, cap] of Object.entries(caps.harnesses)) {
    const ss = cap.session_start;
    if (!ss) continue;
    const hasStart = cap.sessions.some((s) => /session.?start/i.test(s.name));
    if (!hasStart) continue;
    const isMachine = ss.path.startsWith("~/") || ss.path.startsWith("~\\") || ss.path.startsWith("/");
    const abs = isMachine
      ? ss.path.startsWith("~/") || ss.path.startsWith("~\\")
        ? join(home, ss.path.slice(2))
        : ss.path
      : join(root, ss.path);

    let raw: string | null;
    if (isMachine) {
      raw = cron.readHarnessConfig?.(abs) ?? null;
    } else {
      try {
        raw = isFile(abs) ? readFileSync(abs, "utf-8") : null;
      } catch {
        raw = null;
      }
    }
    if (raw !== null) anySessionStartSignal = true;
    if (raw !== null && raw.includes("jspace context session-start")) continue;

    if (isMachine) {
      if (name === "pi") {
        const piSettings = join(home, ".pi", "agent", "settings.json");
        const piInstalled = cron.readHarnessConfig?.(piSettings) !== null;
        if (piInstalled && active.has("pi")) {
          diags.push({
            severity: harnessFindingSeverity(name, active),
            code: "harness.session_start_not_wired",
            path: `harness.${name}`,
            message: `Pi is installed and active for this workbench, but the jspace session-start extension is missing or stale at ${abs}; run 'jspace harness wire --harness pi' to enable automatic briefing`,
          });
        }
      } else if (raw !== null) {
        diags.push({
          severity: harnessFindingSeverity(name, active),
          code: "harness.session_start_not_wired",
          path: `harness.${name}`,
          message: `${name} session-start hook exists but is missing 'jspace context session-start' at ${abs}; run 'jspace harness wire --harness ${name}' to repair it`,
        });
      }
    } else if (raw !== null) {
      // A workbench seed is user data once edited: upgrade preserves it (skip),
      // so the repair instruction must not claim that upgrade restores the hook
      // (issue #52). Both seed checks share the sentence verbatim.
      diags.push({
        severity: harnessFindingSeverity(name, active),
        code: "harness.session_start_not_wired",
        path: `harness.${name}`,
        message: `${name} session-start seed exists but is missing 'jspace context session-start' at ${abs}; ${SEED_HOOK_REPAIR}`,
      });
    }
  }

  if (anySessionStartSignal) {
    const briefing = readBriefing(root);
    if (isBriefingStale(briefing.state)) {
      diags.push({
        severity: "warning",
        code: "briefing.stale",
        path: "briefing",
        message: briefing.state === null
          ? "no session-start briefing recorded yet; automatic briefing may not be running (run 'jspace harness wire --harness <your-harness>')"
          : `last session-start briefing is stale (${briefing.state.last_session_start_at}); session-start hooks may not be running (run 'jspace harness wire --harness <your-harness>')`,
      });
    }
  }
  return diags;
}
