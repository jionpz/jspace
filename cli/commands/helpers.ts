// cli/commands/helpers.ts — small shared CommandSpec wiring helpers (argument
// coercion + cron deps for doctor/workspace-upgrade). Neutral module: family
// command files import from here instead of redefining or crossing into each
// other (keeps the family split free of circular imports).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCrons } from "../../application/automation/definitions.ts";
import { schedulerAdapter } from "../../adapters/scheduler/index.ts";
import { installedCronIdsForRoot, schedulerEnv } from "../scheduler.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { expandTilde } from "../embed.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { diffBundle } from "../../application/workspace/manifest.ts";
import { readMaterializedJournal } from "../../application/workspace/journal.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { binaryOnPath } from "../../adapters/harness/bin.ts";

export const s = (v: unknown): string => (typeof v === "string" ? v : "");
export const b = (v: unknown): boolean => v === true;
/** Optional string argument: "" / missing -> undefined (omitted), else the
 *  value. Use for optional flags that map to `| undefined` in a call site
 *  (`s(args.x) || undefined`). */
export const optS = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Suppress stdout lines but keep the exit code + warnings/errors (used by
 *  harness hooks like OpenCode's session.idle, where output would be noise).
 *  `lines` stays present (empty) so the renderer stays happy. */
export function quiet(result: { lines: string[]; exitCode?: number; errors?: string[]; warnings?: string[]; data?: unknown }): { lines: string[]; exitCode?: number; errors?: string[]; warnings?: string[] } {
  return { lines: [], exitCode: result.exitCode, errors: result.errors, warnings: result.warnings };
}

export const readFileOrNull = (p: string): string | null => {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

/** Official skills whose materialized copy no longer matches the running
 *  bundle. Lives here (not in doctor) because it needs BUNDLE_MANIFEST — doctor
 *  stays free of the generated modules and takes this as an injected dep. */
export function bundleStaleSkills(root: string): string[] {
  const prefix = `${CONFIG_DIR}/skills/`;
  const names = new Set<string>();
  try {
    const recorded = readMaterializedJournal(root)?.files ?? {};
    for (const e of diffBundle(root, BUNDLE_MANIFEST, { readFile: readFileOrNull, recorded })) {
      if (e.action === "no-op") continue;
      if (!e.rel.startsWith(prefix)) continue;
      const name = e.rel.slice(prefix.length).split("/")[0];
      if (name) names.add(name);
    }
  } catch {
    // damaged journal / unreadable workbench: diff + upgrade report it; a
    // read-only diagnostic must never throw.
    return [];
  }
  return [...names].sort();
}

export const cronDeps = {
  loadCrons,
  installedCronIds: installedCronIdsForRoot,
  linuxCronHealth: () => schedulerAdapter(process.platform)?.health?.(schedulerEnv()) ?? { crontab: "missing", service: "stopped" },
  officialSkillNames: () => SKILLS_MANIFEST.workbench.map((s) => s.name),
  bundleStaleSkills,
  userSkillsRoot: () => expandTilde("~/.agents/skills"),
  globalSkills: () =>
    SKILLS_MANIFEST.global
      .filter((s) => s.install_path !== undefined)
      .map((s) => ({ name: s.name, installPath: expandTilde(s.install_path!) })), // install_path is contract-required for global; ! is filter-guaranteed
  cursorLegacySkillLinks: legacyCursorSkillLinks,
  readHarnessConfig: readFileOrNull,
  harnessBinOnPath: (name: string) => binaryOnPath(name, process.platform),
  globalGovernanceHome: () => homedir(),
  platform: process.platform,
};

/** Official skills still sitting in Cursor's RETIRED user-level skills dir
 *  (`~/.cursor/skills/<name>`, the old three-hop chain into `~/.agents/skills`).
 *  Cursor reads this workbench's `.agents/skills` projection instead, so any
 *  entry here is a leftover that can only point at one workbench; doctor
 *  reports it as info and never deletes it. */
export function legacyCursorSkillLinks(): string[] {
  const dir = join(homedir(), ".cursor", "skills");
  return SKILLS_MANIFEST.workbench.map((s) => s.name).filter((name) => existsSync(join(dir, name)));
}
