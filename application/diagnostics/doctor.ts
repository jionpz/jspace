// application/diagnostics/doctor.ts — `jspace doctor` use case (aggregate entry).
// Business logic moved out of cli/cmds.ts cmdDoctor; cron checks are injected.
// Focused check modules live under checks/; this file orchestrates + aggregates
// severity. JSON output carries the full diagnostics (code/severity/path) so
// scripts can classify errors.
import { existsSync, readFileSync } from "node:fs";
import type { CmdResult } from "../commands/command.ts";
import type { RegistryDiagnostic } from "../../core/contracts/diagnostics.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { inspectWorkbench, INVALID_JSON, type InspectEnv } from "../../core/registry/inspect.ts";
import { isFile } from "../fs.ts";
import { checkInbox, checkPending, checkIngest, checkDomains } from "./checks/inbox.ts";
import { checkSkills } from "./checks/skills.ts";
import { checkCrons } from "./checks/crons.ts";
import { checkGBrain, checkCursorSkills } from "./checks/gbrain.ts";
import { checkHarness } from "./checks/harness.ts";
import { checkSessionStartHooks } from "./checks/session-hooks.ts";
import { checkWritebackHabit } from "./checks/writeback.ts";
import { checkUsageMileageLedger } from "./checks/usage-mileage.ts";
import type { CronHealthDeps } from "./deps.ts";

export type { CronHealthDeps, CronLike } from "./deps.ts";

/** `jspace doctor` — orchestrate the read-only checks and aggregate by severity.
 *  `verbose` prints info-level diagnostics in human mode (default: only counted). */
export function doctorWorkbench(root: string, cron: CronHealthDeps, verbose = false): CmdResult {
  const reads = readWorkbenchState(root);
  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: existsSync,
    isFile,
    readJson: (p) => {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        return INVALID_JSON;
      }
    },
  };
  const diags: RegistryDiagnostic[] = [
    ...inspectWorkbench(env),
    ...checkInbox(reads),
    ...checkPending(reads),
    ...checkIngest(root),
    ...checkSkills(root, cron),
    ...checkDomains(root, reads.hub.status === "ok" ? reads.hub.value : null),
    ...checkGBrain(root, cron),
    ...checkCursorSkills(cron),
    ...checkCrons(root, cron),
    ...checkHarness(root, cron),
    ...checkSessionStartHooks(root, cron),
    ...checkWritebackHabit(root),
    ...checkUsageMileageLedger(root),
  ];

  const errors = diags.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diags.filter((d) => d.severity === "warning").map((d) => d.message);
  const infos = diags.filter((d) => d.severity === "info").map((d) => d.message);
  const summary = `jspace: doctor ${errors.length > 0 ? "failed" : "ok"}: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`;
  return {
    exitCode: errors.length > 0 ? 1 : undefined,
    lines: verbose ? [summary, ...infos] : [summary],
    data: { diagnostics: diags, errors, warnings, infos },
    errors,
    warnings,
  };
}
