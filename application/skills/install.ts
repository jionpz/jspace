// application/skills/install.ts — materialize the official workbench skills into
// the user-level `~/.agents/skills/` directory. This is the multi-harness uniform
// location (Claude/Grok/Pi/OpenCode all read user-level paths; `~` expands per
// machine, so it is machine-agnostic and does not depend on any harness-specific
// variable). Mirrors harness-config's `rsync --ignore-existing` semantics:
// fill gaps, never overwrite a local edit.
import { join } from "node:path";

export interface InstallResult {
  ok: boolean;
  /** Per-skill breakdown: created files, skipped (present) files. */
  skills: { name: string; created: string[]; skipped: string[] }[];
}

export interface InstallDeps {
  /** All bundled asset keys (e.g. `skills/jspace-use/SKILL.md`). */
  assetKeys: () => string[];
  /** Content of a bundled asset key (undefined when absent). */
  assetContent: (key: string) => string | undefined;
  /** Resolve the user-level skills root (e.g. `~/.agents/skills`). */
  userSkillsRoot: () => string;
  /** Write a file (mkdir -p parents). Returns written rel path. */
  writeFile: (absPath: string, content: string, rel: string) => void;
  /** True when the file exists on disk. */
  exists: (absPath: string) => boolean;
  /** When true, skip all writes and only compute what would change. */
  dryRun?: boolean;
}

/** Materialize the official skills into ~/.agents/skills/. Idempotent: a file
 *  already present is skipped (never overwritten), so a re-run is a no-op and
 *  a local edit is preserved (matching harness-config's --ignore-existing). */
export function installSkills(deps: InstallDeps, skillNames: string[]): InstallResult {
  const root = deps.userSkillsRoot();
  const out: InstallResult = { ok: true, skills: [] };

  for (const name of skillNames) {
    const prefix = `skills/${name}/`;
    // Collect this skill's bundled files, excluding runtime artifacts.
    const keys = deps
      .assetKeys()
      .filter((k) => k.startsWith(prefix))
      .filter((k) => !k.includes("/__pycache__/") && !k.endsWith(".pyc") && !k.endsWith(".pyo") && !k.includes("/.git/"));

    const created: string[] = [];
    const skipped: string[] = [];
    for (const key of keys) {
      const rel = key.slice(prefix.length); // e.g. SKILL.md, references/x.md
      const abs = join(root, name, rel);
      if (deps.exists(abs)) {
        skipped.push(rel);
        continue;
      }
      const content = deps.assetContent(key);
      if (content === undefined) continue;
      created.push(rel);
      if (!deps.dryRun) deps.writeFile(abs, content, rel);
    }
    out.skills.push({ name, created, skipped });
  }

  return out;
}
