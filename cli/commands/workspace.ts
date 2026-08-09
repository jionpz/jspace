// cli/commands/workspace.ts — `jspace workspace` + `update` command families.
import { existsSync, readFileSync } from "node:fs";
import type { CommandSpec } from "../../application/commands/command.ts";
import { workspaceDiff, workspaceUpgrade } from "../../application/workspace/workspace.ts";
import { doctorWorkbench } from "../../application/workspace/doctor.ts";
import { installSkills, type InstallDeps } from "../../application/skills/install.ts";
import { cmdUpdate } from "../update.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { ASSETS } from "../assets.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { b, cronDeps, readFileOrNull, s } from "./helpers.ts";
import { userSkillsRoot } from "./skills.ts";

/** After a successful workbench upgrade, refresh the user-level ~/.agents/skills/
 *  copies of the official skills (hash-compare: changed files re-written, identical
 *  skipped). The workbench owns .jspace/skills/; the user-level mirror is where
 *  the multi-harness docs live, and it must not drift stale past the bundle. */
function refreshExternalSkills(): string[] {
  const deps: InstallDeps = {
    assetKeys: () => Object.keys(ASSETS),
    assetContent: (k) => ASSETS[k],
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
  };
  const names = SKILLS_MANIFEST.workbench.map((skill) => skill.name);
  const r = installSkills(deps, names, { refresh: true });
  const updated = r.skills.flatMap((skill) => skill.updated.map((rel) => `${skill.name}/${rel}`));
  if (updated.length === 0) return ["jspace: ok: user-level skills up to date (~/.agents/skills)"];
  const shown = updated.slice(0, 5).join(", ");
  return [`jspace: ok: refreshed ${updated.length} user-level skill file(s) in ~/.agents/skills: ${shown}${updated.length > 5 ? " …" : ""}`];
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

const workspaceUpgradeSpec: CommandSpec = {
  name: "upgrade",
  summary: "upgrade the workbench to the running bundle (plan + journal + rollback)",
  features: { dir: true, dryRun: true },
  options: [
    { name: "--accept-conflicts", dest: "acceptConflicts", takesValue: false, help: "overwrite locally modified managed files" },
    { name: "--rollback", takesValue: true, metavar: "ID", help: "restore a previous upgrade from its journal" },
  ],
  handler: (ctx, args) => {
    const result = workspaceUpgrade(
      ctx.root,
      {
        dryRun: b(args.dryRun),
        acceptConflicts: b(args.acceptConflicts),
        rollbackId: s(args.rollback) || undefined,
      },
      { manifest: BUNDLE_MANIFEST, assets: ASSETS, readFile: readFileOrNull, writeFile: (p, c) => writeBytesAtomic(p, c) },
    );
    // dry-run is a preview, rollback restores a historical state: neither
    // should run the follow-up doctor or skill refresh (both can report
    // transient mismatches)
    if (result.exitCode || b(args.dryRun) || s(args.rollback)) return result;
    const refreshLines = refreshExternalSkills();
    const doctor = doctorWorkbench(ctx.root, cronDeps);
    return {
      ...result,
      lines: [...result.lines, ...refreshLines, ...doctor.lines],
      warnings: doctor.warnings,
      errors: doctor.errors,
      exitCode: doctor.exitCode,
    };
  },
};

export const workspaceSpec: CommandSpec = {
  name: "workspace",
  summary: "inspect and upgrade the workbench",
  commandArgName: "workspace_command",
  children: [workspaceDiffSpec, workspaceUpgradeSpec],
};
