// application/diagnostics/deps.ts — injected dependencies for doctor checks.
import type { LinuxCronHealth } from "../../adapters/scheduler/types.ts";

/** Minimal cron view consumed by doctor; full cron surface lives in the scheduler. */
export interface CronLike {
  id: string;
  schedule: string;
  harness?: string; // read by checkHarness (active harness set)
  enabled: boolean;
  /** Present when the cron drives a bundled skill instead of an inline prose
   *  prompt. Read by the legacy-inline-prompt migration check: a contract kept
   *  in cron.json (user data, never overwritten by upgrade) is frozen forever,
   *  while a skill target keeps it in the upgrade-managed skill layer. */
  target?: { skill: string };
  /** Per-cron headless tools override; read by checkCrons for harness support. */
  tools?: string;
}

export interface CronsDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  parseSchedule: (schedule: string) => unknown;
  installedCronIds: (root: string) => string[];
  /** Linux cron health tri-state. `unverifiable` = detection failed in a way
   *  that may be environmental (sandbox / namespace isolation) rather than a
   *  real fault — doctor maps it to info, never warning (issue #10). */
  linuxCronHealth: () => LinuxCronHealth;
  officialSkillNames: () => string[];
  platform?: string;
}

export interface SkillsDeps {
  officialSkillNames: () => string[];
  /** Skill names whose materialized copy differs from the running bundle.
   *  Injected from cli for the same reason as officialSkillNames (diffBundle
   *  needs BUNDLE_MANIFEST). Omitted => the check is skipped silently. */
  bundleStaleSkills?: (root: string) => string[];
}

export interface GbrainDeps {
  /** Raw text of a harness's machine config (~/.claude.json / ~/.grok/config.toml),
   *  or null when missing. Used by the multi-harness gbrain wiring check
   *  (issue #8 #16). */
  readHarnessConfig?: (path: string) => string | null;
}

export interface CursorSkillsDeps {
  officialSkillNames: () => string[];
  /** True when an official skill is thin-linked into Cursor's user-level skills
   *  dir (~/.cursor/skills/<name> → ~/.agents/skills/<name>). Injected from cli
   *  (uses homedir + readlink); doctor reports gaps as info (issue #12). */
  cursorSkillsLinked?: (name: string) => boolean;
}

export interface HarnessCheckDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  /** Active-harness binary presence (injectable so tests stay deterministic on
   *  machines without the harness CLI installed). Defaults to a real PATH check. */
  harnessBinOnPath?: (name: string) => boolean;
  platform?: string;
}

export interface SessionHooksDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  readHarnessConfig?: (path: string) => string | null;
}

/** Combined cron-health injection surface for doctorWorkbench. */
export interface CronHealthDeps extends CronsDeps, SkillsDeps, GbrainDeps, CursorSkillsDeps, HarnessCheckDeps, SessionHooksDeps {
  /** Parsed ~/.claude.json (user machine config), or null when missing/invalid.
   *  Injected so doctor can check the gbrain MCP skills-dir wiring without
   *  touching the machine-level file itself. */
  readUserClaudeJson?: () => unknown | null;
}
