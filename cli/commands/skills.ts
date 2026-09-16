// cli/commands/skills.ts — `jspace skills install` — materialize the official
// skills (workbench + machine-global, issue #37) into the user-level
// `~/.agents/skills/` directory. This is the multi-harness uniform location
// (Claude/Grok/Pi/OpenCode read user-level paths; `~` expands per machine,
// machine-agnostic, no harness-specific var). Inside a workbench the workbench
// skills become thin directory links to its SSOT (.jspace/skills, issue #39);
// machine-global skills and no-workbench runs materialize per-file copies.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import type { CommandSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import { installSkills, type InstallDeps, type InstallResult } from "../../application/skills/install.ts";
import { classifyUserSkillLink, ensureUserSkillLink, removeRetiredUserSkills } from "../../application/workspace/projections.ts";
import { ASSETS } from "../assets.generated.ts";
import { GLOBAL_SKILLS } from "../global-skills.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { expandTilde } from "../embed.ts";
import { b } from "./helpers.ts";

export function userSkillsRoot(): string {
  return expandTilde("~/.agents/skills");
}

function writeWithDirs(abs: string, content: string): void {
  // Atomic rename replaces a symlink at `abs` rather than writing through it
  // (dangling or live). writeFileSync follows the link and can escape
  // ~/.agents/skills.
  writeBytesAtomic(abs, content);
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

const installDeps = (dryRun: boolean, wbRoot?: string): InstallDeps => ({
  ...embeddedSkillAssets(),
  userSkillsRoot,
  writeFile: writeWithDirs,
  exists: existsSync,
  readFile: readFileOrNull,
  dryRun,
  workbenchSkillDir: (name) => {
    if (wbRoot === undefined) return null;
    const p = join(wbRoot, ".jspace", "skills", name);
    return existsSync(p) ? p : null;
  },
  // dry-run must never mutate: classify only, reporting what WOULD happen.
  ensureSkillDirLink: dryRun
    ? (entry, ssot) => {
        const a = classifyUserSkillLink(entry, ssot);
        return { mode: "link", changed: a !== "no-op", divergent: a === "converge" };
      }
    : ensureUserSkillLink,
});

/** `skills install` handler — exported for tests with injected deps (write
 *  failures must surface as errors + exit 1, never a silent exit 0 — issue #8 #9). */
export function installHandler(
  ctx: CmdContext,
  args: { refresh?: unknown },
  deps: InstallDeps = installDeps(ctx.dryRun, ctx.root),
): CmdResult {
  try {
    const names = [...SKILLS_MANIFEST.workbench, ...SKILLS_MANIFEST.global].map((s) => s.name);
    const r = installSkills(deps, names, { refresh: b(args?.refresh) });
    const root = userSkillsRoot();
    const lines = summarizeInstall(r, root, ctx.dryRun);
    // Official skills are fully managed: a renamed/deleted skill must not linger
    // in ~/.agents/skills and keep being discovered by harnesses.
    for (const name of removeRetiredUserSkills(root, names, ctx.dryRun)) {
      lines.push(
        ctx.dryRun
          ? `jspace: info: (dry-run) would remove retired official skill ${join(root, name)}`
          : `jspace: info: removed retired official skill ${join(root, name)} (no longer shipped by jspace)`,
      );
    }
    return { lines };
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
    if (s.link !== undefined) {
      // thin-link materialization (issue #39): one line per skill, fallback and
      // keeps explicitly visible — never a silent look-alike copy.
      const suffix =
        s.link.action === "replaced-divergent"
          ? " (divergent copy REPLACED by dir link -> workbench SSOT; official skills are managed, local edits there are not preserved)"
          : s.link.action === "created"
            ? s.link.mode === "copy"
              ? " (materialized as COPY: symlink unavailable on this platform)"
              : dryRun
                ? " (dir link -> workbench SSOT)"
                : " (dir link -> workbench SSOT)"
            : " (dir link active)";
      lines.push(`${verb} ${s.name}@${join(root, s.name)}${suffix}`);
      continue;
    }
    totalCreated += s.created.length;
    totalUpdated += s.updated.length;
    const createdDesc = s.created.length > 0 ? ` created=${s.created.length}` : "";
    const updatedDesc = s.updated.length > 0 ? ` refreshed=${s.updated.length}` : "";
    const skippedDesc = s.skipped.length > 0 ? ` skipped=${s.skipped.length}` : "";
    lines.push(`${verb} ${s.name}@${join(root, s.name)}${createdDesc}${updatedDesc}${skippedDesc}`);
  }
  if (totalCreated === 0 && totalUpdated === 0 && !dryRun && !r.skills.some((s) => s.link !== undefined))
    lines.push("jspace: ok: all official skills already installed (re-run to refresh missing files)");
  return lines;
}

export const skillsSpec: CommandSpec = {
  name: "skills",
  summary: "manage official skills (workbench + machine-global) in the user-level ~/.agents/skills/",
  description:
    "The user-level ~/.agents/skills/ is the multi-harness uniform location (Claude/Grok/Pi/OpenCode " +
    "all read user-level paths). `skills install` materializes the official skills there — the " +
    "workbench skills plus the machine-global ones (manifest.global, e.g. harness-config, issue #37) — " +
    "filling gaps without overwriting local edits (idempotent, like harness-config).",
  features: { dir: true },
  children: [installSpec],
};
