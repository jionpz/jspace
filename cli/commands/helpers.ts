// cli/commands/helpers.ts — small shared CommandSpec wiring helpers (argument
// coercion + cron deps for doctor/workspace-upgrade). Neutral module: family
// command files import from here instead of redefining or crossing into each
// other (keeps the family split free of circular imports).
import { readFileSync } from "node:fs";
import { loadCrons, parseSchedule } from "../../application/automation/definitions.ts";
import { schedulerAdapter } from "../../adapters/scheduler/index.ts";
import { installedCronIdsForRoot, schedulerEnv } from "../scheduler.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";

export const s = (v: unknown): string => (typeof v === "string" ? v : "");
export const b = (v: unknown): boolean => v === true;

export const readFileOrNull = (p: string): string | null => {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

export const cronDeps = {
  loadCrons,
  parseSchedule,
  installedCronIds: installedCronIdsForRoot,
  linuxCronHealth: () => schedulerAdapter(process.platform)?.health?.(schedulerEnv()) ?? { crontab: false, service: false },
  officialSkillNames: () => SKILLS_MANIFEST.workbench.map((s) => s.name),
};
