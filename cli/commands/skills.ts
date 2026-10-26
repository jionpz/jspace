// cli/commands/skills.ts — `jspace skills install` — materialize the
// MACHINE-GLOBAL official skills (manifest.global, issue #37) into the
// user-level `~/.agents/skills/` directory, the multi-harness uniform location
// that must work with no workbench and from any cwd (`~` expands per machine,
// no harness-specific var). Workbench-scoped skills are NOT installed here:
// they are discovered from their workbench (@see skill-scope.ts), and proven
// leftovers of older bundles are pruned by the same run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import type { CommandSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import { installSkills, type InstallDeps, type InstallResult } from "../../application/skills/install.ts";
import { removeRetiredUserSkills } from "../../application/workspace/projections.ts";
import { ASSETS } from "../assets.generated.ts";
import { GLOBAL_SKILLS } from "../global-skills.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { expandTilde } from "../embed.ts";
import { b } from "./helpers.ts";
import { pruneWorkbenchSkillsFromUserLevel, summarizePrune } from "./skill-scope.ts";

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
    // Scope convergence: only MACHINE-GLOBAL skills are installed at the user
    // level. Workbench skills are discovered from their workbench (@see
    // skill-scope.ts); older bundles put them here and the prune below removes
    // the proven-official leftovers.
    const names = SKILLS_MANIFEST.global.map((s) => s.name);
    const r = installSkills(deps, names, { refresh: b(args?.refresh) });
    // Every path in this handler goes through the injected root: a stubbed
    // install must never read or prune the operator's real ~/.agents/skills.
    const root = deps.userSkillsRoot();
    const lines = summarizeInstall(r, root, ctx.dryRun);
    const pruned = pruneWorkbenchSkillsFromUserLevel({
      // deps.userSkillsRoot(), NOT the module default: the injected root is the
      // only thing tests may touch, and a stubbed install must never prune the
      // real ~/.agents/skills.
      userRoot: deps.userSkillsRoot(),
      workbenchRoot: ctx.root,
      names: SKILLS_MANIFEST.workbench.map((s) => s.name),
      dryRun: ctx.dryRun,
    });
    lines.push(...summarizePrune(pruned, root, ctx.dryRun));
    // Official skills are fully managed: a renamed/deleted skill must not linger
    // in ~/.agents/skills and keep being discovered by harnesses.
    const retired = removeRetiredUserSkills(root, [...names, ...SKILLS_MANIFEST.workbench.map((s) => s.name)], ctx.dryRun);
    for (const name of retired.removed) {
      lines.push(
        ctx.dryRun
          ? `jspace: info: (dry-run) would remove retired official skill ${join(root, name)}`
          : `jspace: info: removed retired official skill ${join(root, name)} (no longer shipped by jspace)`,
      );
    }
    for (const item of retired.preserved) {
      lines.push(
        `jspace: warning: preserved ${join(root, item.name)} because it is not a proven historical official copy: ${item.reason}`,
      );
    }
    return { lines };
  } catch (e) {
    return { lines: [], errors: [`skills install: ${e instanceof Error ? e.message : String(e)}`], exitCode: 1 };
  }
}

const installSpec: CommandSpec = {
  name: "install",
  summary: "materialize machine-global skills into ~/.agents/skills/ and prune workbench skills from it",
  features: { dryRun: true },
  options: [
    { name: "--refresh", dest: "refresh", takesValue: false, help: "refresh changed machine-global files (hash-compare; default: fill gaps only, preserve local edits)" },
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
  summary: "manage the machine-global official skills in the user-level ~/.agents/skills/",
  description:
    "Skill scope: `global` skills (manifest.global, e.g. harness-config, jspace-adopt) are the only " +
    "ones installed at the user-level ~/.agents/skills/ — the multi-harness uniform location that must " +
    "work with no workbench and from any cwd. `workbench` skills belong to one workbench and are " +
    "discovered there (`.jspace/skills/` and its `.<harness>/skills/` projections); `skills install` " +
    "prunes proven-official leftovers of those names from the user level and never touches a " +
    "user-authored copy.",
  features: { dir: true },
  children: [installSpec],
};
