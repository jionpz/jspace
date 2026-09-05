// cli/commands/skills.ts — `jspace skills install` — materialize the official
// skills (workbench + machine-global, issue #37) into the user-level
// `~/.agents/skills/` directory. This is the multi-harness uniform location
// (Claude/Grok/Pi/OpenCode read user-level paths; `~` expands per machine,
// machine-agnostic, no harness-specific var).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import { installSkills, type InstallDeps, type InstallResult } from "../../application/skills/install.ts";
import { ASSETS } from "../assets.generated.ts";
import { GLOBAL_SKILLS } from "../global-skills.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { expandTilde } from "../embed.ts";
import { b } from "./helpers.ts";

export function userSkillsRoot(): string {
  return expandTilde("~/.agents/skills");
}

function writeWithDirs(abs: string, content: string): void {
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function readFileOrNull(abs: string): string | null {
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

/** Union view over the two embedded skill content maps — workbench skills in
 *  ASSETS, machine-global skills (harness-config) in GLOBAL_SKILLS (issue #37).
 *  installSkills is prefix+key based, so it needs no scope awareness. Shared by
 *  `skills install` and `workspace upgrade`'s user-level refresh. */
export function embeddedSkillAssets(): Pick<InstallDeps, "assetKeys" | "assetContent"> {
  return {
    assetKeys: () => [...Object.keys(ASSETS), ...Object.keys(GLOBAL_SKILLS)],
    assetContent: (k) => ASSETS[k] ?? GLOBAL_SKILLS[k],
  };
}

const installDeps = (dryRun: boolean): InstallDeps => ({
  ...embeddedSkillAssets(),
  userSkillsRoot,
  writeFile: writeWithDirs,
  exists: existsSync,
  readFile: readFileOrNull,
  dryRun,
});

/** `skills install` handler — exported for tests with injected deps (write
 *  failures must surface as errors + exit 1, never a silent exit 0 — issue #8 #9). */
export function installHandler(
  ctx: CmdContext,
  args: { refresh?: unknown },
  deps: InstallDeps = installDeps(ctx.dryRun),
): CmdResult {
  try {
    const names = [...SKILLS_MANIFEST.workbench, ...SKILLS_MANIFEST.global].map((s) => s.name);
    const r = installSkills(deps, names, { refresh: b(args?.refresh) });
    const root = userSkillsRoot();
    return { lines: summarizeInstall(r, root, ctx.dryRun) };
  } catch (e) {
    return { lines: [], errors: [`skills install: ${e instanceof Error ? e.message : String(e)}`], exitCode: 1 };
  }
}

const installSpec: CommandSpec = {
  name: "install",
  summary: "materialize official skills (workbench + machine-global) into ~/.agents/skills/ (multi-harness uniform location)",
  features: { dryRun: true },
  options: [
    { name: "--refresh", dest: "refresh", takesValue: false, help: "refresh changed official files (hash-compare; default: fill gaps only, preserve local edits)" },
  ],
  handler: installHandler,
};

function summarizeInstall(r: InstallResult, root: string, dryRun: boolean): string[] {
  const lines: string[] = [];
  const verb = dryRun ? "(dry-run) would install" : "installed";
  let totalCreated = 0;
  let totalUpdated = 0;
  for (const s of r.skills) {
    totalCreated += s.created.length;
    totalUpdated += s.updated.length;
    const createdDesc = s.created.length > 0 ? ` created=${s.created.length}` : "";
    const updatedDesc = s.updated.length > 0 ? ` refreshed=${s.updated.length}` : "";
    const skippedDesc = s.skipped.length > 0 ? ` skipped=${s.skipped.length}` : "";
    lines.push(`${verb} ${s.name}@${join(root, s.name)}${createdDesc}${updatedDesc}${skippedDesc}`);
  }
  if (totalCreated === 0 && totalUpdated === 0 && !dryRun) lines.push("jspace: ok: all official skills already installed (re-run to refresh missing files)");
  return lines;
}

export const skillsSpec: CommandSpec = {
  name: "skills",
  summary: "manage the official workbench skills in the user-level ~/.agents/skills/",
  description:
    "The user-level ~/.agents/skills/ is the multi-harness uniform location (Claude/Grok/Pi/OpenCode " +
    "all read user-level paths). `skills install` materializes the official skills there — the " +
    "workbench skills plus the machine-global ones (manifest.global, e.g. harness-config, issue #37) — " +
    "filling gaps without overwriting local edits (idempotent, like harness-config).",
  features: { dir: true },
  children: [installSpec],
};
