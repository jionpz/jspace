// cli/commands/workspace.ts — `jspace workspace` + `update` command families.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandSpec } from "../../application/commands/command.ts";
import { workspaceDiff, workspaceUpgrade } from "../../application/workspace/workspace.ts";
import { doctorWorkbench, type CronHealthDeps } from "../../application/diagnostics/doctor.ts";
import { installSkills, type InstallDeps } from "../../application/skills/install.ts";
import { ensureUserSkillLink, removeRetiredUserSkills } from "../../application/workspace/projections.ts";
import { cmdUpdate } from "../update.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { ASSETS } from "../assets.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { b, cronDeps, optS, readFileOrNull, s } from "./helpers.ts";
import { userSkillsRoot, embeddedSkillAssets } from "./skills.ts";

/** After a successful workbench upgrade, sync the user-level ~/.agents/skills/
 *  entries: inside the workbench, its official skills are dir links to the SSOT
 *  (.jspace/skills, issue #39 — re-pointed, never stale); skills without a
 *  workbench SSOT (machine-global) refresh per-file (hash-compare: changed
 *  files re-written, identical skipped). The workbench owns .jspace/skills/;
 *  the user-level mirror is where the multi-harness docs live. */
function refreshExternalSkills(wbRoot: string): string[] {
  const deps: InstallDeps = {
    ...embeddedSkillAssets(),
    userSkillsRoot,
    writeFile: (p, c) => writeBytesAtomic(p, c),
    exists: existsSync,
    readFile: (p) => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    workbenchSkillDir: (name) => {
      const p = join(wbRoot, ".jspace", "skills", name);
      return existsSync(p) ? p : null;
    },
    ensureSkillDirLink: ensureUserSkillLink,
  };
  const names = [...SKILLS_MANIFEST.workbench, ...SKILLS_MANIFEST.global].map((skill) => skill.name);
  const r = installSkills(deps, names, { refresh: true });
  const lines: string[] = [];
  const updated = r.skills.flatMap((skill) => skill.updated.map((rel) => `${skill.name}/${rel}`));
  // Count real links only: a copy fallback is not "following the SSOT", and
  // over-claiming it was exactly the misleading "dir link(s) active" line.
  const linked = r.skills.filter((s) => s.link !== undefined && s.link.mode !== "copy").length;
  const copies = r.skills.filter((s) => s.link?.mode === "copy").length;
  for (const s of r.skills) {
    if (s.link?.action === "replaced-divergent") {
      lines.push(`jspace: info: ~/.agents/skills/${s.name} held a divergent copy; replaced by a dir link to the workbench SSOT (official skills are managed)`);
    }
  }
  if (updated.length === 0 && linked > 0) {
    lines.push(`jspace: ok: user-level skills follow the workbench SSOT (${linked} dir link(s) active${copies > 0 ? `, ${copies} copy fallback(s)` : ""})`);
  } else if (updated.length === 0) {
    lines.push("jspace: ok: user-level skills up to date (~/.agents/skills)");
  } else {
    const shown = updated.slice(0, 5).join(", ");
    lines.push(`jspace: ok: refreshed ${updated.length} user-level skill file(s) in ~/.agents/skills: ${shown}${updated.length > 5 ? " …" : ""}`);
  }
  // A renamed/deleted official skill must not linger in ~/.agents/skills where
  // harnesses still discover it (that is how a stale contract survives an upgrade).
  for (const name of removeRetiredUserSkills(userSkillsRoot(), names)) {
    lines.push(`jspace: info: removed retired official skill ~/.agents/skills/${name} (no longer shipped by jspace)`);
  }
  return lines;
}

export const updateSpec: CommandSpec = {
  name: "update",
  summary: "self-update the jspace CLI from GitHub Releases",
  description:
    "Self-update the jspace CLI from GitHub Releases (explicit command only; no background checks). Downloads the matching platform binary, verifies its SHA-256 against the release checksums, and replaces the current binary.",
  options: [
    { name: "--check", takesValue: false, help: "report current vs latest, do not update" },
    { name: "--version", takesValue: true, metavar: "VERSION", help: "install a specific version (e.g. v1.0.1; rollback) (env: JSPACE_VERSION) (env: JSPACE_BASE_URL overrides the download base)" },
  ],
  handler: async (_ctx, args) => {
    await cmdUpdate(b(args.check), args.version === undefined ? undefined : s(args.version));
    return { lines: [] };
  },
};

const workspaceDiffSpec: CommandSpec = {
  name: "diff",
  summary: "show differences between the workbench and the running bundle",
  features: { dir: true, json: true },
  handler: (ctx, args) => workspaceDiff(ctx.root, BUNDLE_MANIFEST, b(args.json), ASSETS),
};

export interface WorkspaceUpgradeHandlerDeps {
  workspaceUpgrade: typeof workspaceUpgrade;
  refreshExternalSkills: (wbRoot: string) => string[];
  doctorWorkbench: typeof doctorWorkbench;
  cronDeps: CronHealthDeps;
  manifest: typeof BUNDLE_MANIFEST;
  assets: typeof ASSETS;
  readFile: typeof readFileOrNull;
  writeFile: (p: string, c: string) => void;
}

const defaultUpgradeDeps = (): WorkspaceUpgradeHandlerDeps => ({
  workspaceUpgrade,
  refreshExternalSkills,
  doctorWorkbench,
  cronDeps,
  manifest: BUNDLE_MANIFEST,
  assets: ASSETS,
  readFile: readFileOrNull,
  writeFile: (p, c) => writeBytesAtomic(p, c),
});

/** `workspace upgrade` handler — exported for CLI combo tests with injected deps. */
export function workspaceUpgradeHandler(
  ctx: { root: string },
  args: Record<string, unknown>,
  deps: WorkspaceUpgradeHandlerDeps = defaultUpgradeDeps(),
): ReturnType<typeof workspaceUpgrade> {
  const result = deps.workspaceUpgrade(
    ctx.root,
    {
      dryRun: b(args.dryRun),
      acceptConflicts: b(args.acceptConflicts),
      rollbackId: optS(args.rollback),
    },
    { manifest: deps.manifest, assets: deps.assets, readFile: deps.readFile, writeFile: deps.writeFile },
  );
  // dry-run is a preview, rollback restores a historical state: neither
  // should run the follow-up doctor or skill refresh (both can report
  // transient mismatches)
  if (result.exitCode || b(args.dryRun) || s(args.rollback)) return result;
  const refreshLines = deps.refreshExternalSkills(ctx.root);
  const doctor = deps.doctorWorkbench(ctx.root, deps.cronDeps);
  return {
    ...result,
    lines: [...result.lines, ...refreshLines, ...doctor.lines],
    warnings: doctor.warnings,
    errors: doctor.errors,
    exitCode: doctor.exitCode,
  };
}

const workspaceUpgradeSpec: CommandSpec = {
  name: "upgrade",
  summary: "upgrade the workbench to the running bundle (plan + journal + rollback)",
  features: { dir: true, dryRun: true },
  options: [
    { name: "--accept-conflicts", dest: "acceptConflicts", takesValue: false, help: "overwrite locally modified managed files" },
    { name: "--rollback", takesValue: true, metavar: "ID", help: "restore a previous upgrade from its journal" },
  ],
  handler: (ctx, args) => workspaceUpgradeHandler(ctx, args),
};

export const workspaceSpec: CommandSpec = {
  name: "workspace",
  summary: "inspect and upgrade the workbench",
  commandArgName: "workspace_command",
  children: [workspaceDiffSpec, workspaceUpgradeSpec],
};
