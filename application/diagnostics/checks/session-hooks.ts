// application/diagnostics/checks/session-hooks.ts — session-start hook wiring + briefing.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { loadCapabilities } from "../../../adapters/harness/registry.ts";
import { isBriefingStale, readBriefing } from "../../context/briefing.ts";
import { isFile } from "../../fs.ts";
import type { SessionHooksDeps } from "../deps.ts";

/** Session-start briefing behavior checks (issue #13): the file-level doctor
 *  checks were not enough — a workbench can be perfectly materialized while the
 *  hook that should run `jspace context session-start` is missing/stale. */
export function checkSessionStartHooks(root: string, cron: SessionHooksDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const caps = loadCapabilities();
  const home = homedir();

  const activeCron = new Set<string>();
  try {
    for (const c of cron.loadCrons(root).crons) {
      if (c.harness && c.enabled) activeCron.add(c.harness);
    }
  } catch {
    // cron.json unreadable -> checkCrons reports it
  }
  const piActive = activeCron.has("pi") || existsSync(join(root, ".pi"));
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
        if (piInstalled && piActive) {
          diags.push({
            severity: "warning",
            code: "harness.session_start_not_wired",
            path: `harness.${name}`,
            message: `Pi is installed and active for this workbench, but the jspace session-start extension is missing or stale at ${abs}; run 'jspace harness wire --harness pi' to enable automatic briefing`,
          });
        }
      } else if (raw !== null) {
        diags.push({
          severity: "warning",
          code: "harness.session_start_not_wired",
          path: `harness.${name}`,
          message: `${name} session-start hook exists but is missing 'jspace context session-start' at ${abs}; run the harness's wire/upgrade command to repair it`,
        });
      }
    } else if (raw !== null) {
      diags.push({
        severity: "warning",
        code: "harness.session_start_not_wired",
        path: `harness.${name}`,
        message: `${name} session-start seed exists but is missing 'jspace context session-start' at ${abs}; run 'jspace workspace upgrade' to restore the seed`,
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
