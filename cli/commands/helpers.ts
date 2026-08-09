// cli/commands/helpers.ts — small shared CommandSpec wiring helpers (argument
// coercion + cron deps for doctor/workspace-upgrade). Neutral module: family
// command files import from here instead of redefining or crossing into each
// other (keeps the family split free of circular imports).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadCrons, parseSchedule } from "../../application/automation/definitions.ts";
import { schedulerAdapter } from "../../adapters/scheduler/index.ts";
import { installedCronIdsForRoot, schedulerEnv } from "../scheduler.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { binaryOnPath } from "../../adapters/harness/bin.ts";

export const s = (v: unknown): string => (typeof v === "string" ? v : "");
export const b = (v: unknown): boolean => v === true;
/** Optional string argument: "" / missing -> undefined (omitted), else the
 *  value. Use for optional flags that map to `| undefined` in a call site
 *  (`s(args.x) || undefined`). */
export const optS = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export const readFileOrNull = (p: string): string | null => {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

/** Parse ~/.claude.json for doctor's gbrain skills-dir wiring check; null on
 *  missing/malformed (not a workbench health problem — the wire cmd handles it). */
export function readUserClaudeJson(): unknown | null {
  try {
    return JSON.parse(readFileSync(`${homedir()}/.claude.json`, "utf-8"));
  } catch {
    return null;
  }
}

export const cronDeps = {
  loadCrons,
  parseSchedule,
  installedCronIds: installedCronIdsForRoot,
  linuxCronHealth: () => schedulerAdapter(process.platform)?.health?.(schedulerEnv()) ?? { crontab: false, service: false },
  officialSkillNames: () => SKILLS_MANIFEST.workbench.map((s) => s.name),
  readUserClaudeJson,
  harnessBinOnPath: (name: string) => binaryOnPath(name, process.platform),
};
