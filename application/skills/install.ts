// application/skills/install.ts — materialize the official workbench skills into
// the user-level `~/.agents/skills/` directory. This is the multi-harness uniform
// location (Claude/Grok/Pi/OpenCode all read user-level paths; `~` expands per
// machine, so it is machine-agnostic and does not depend on any harness-specific
// variable). Mirrors harness-config's `rsync --ignore-existing` semantics:
// fill gaps, never overwrite a local edit (default "fill" mode). An explicit
// "refresh" mode re-syncs CHANGED official files (hash-compare) so `workspace
// upgrade` can refresh stale user-level copies without clobbering identical ones.
import { join } from "node:path";

export interface InstallResult {
  ok: boolean;
  /** Per-skill breakdown: created files, updated (refresh) files, skipped files.
   *  `link` is present when the skill was materialized as a thin dir link to the
   *  workbench SSOT instead of a per-file copy (issue #39). */
  skills: {
    name: string;
    created: string[];
    updated: string[];
    skipped: string[];
    link?: { mode: "link" | "junction" | "copy"; action: "created" | "active" | "replaced-divergent" };
  }[];
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
  /** Current on-disk content (null when unreadable). Only consulted in refresh mode. */
  readFile: (absPath: string) => string | null;
  /** When true, skip all writes and only compute what would change. */
  dryRun?: boolean;
  /** Workbench SSOT dir for a skill (`<wbRoot>/.jspace/skills/<name>`), or null
   *  when running outside a workbench / the skill has no workbench SSOT (e.g.
   *  machine-global skills). Wired from cli; omitted => copy-only behavior. */
  workbenchSkillDir?: (name: string) => string | null;
  /** Thin-link primitive (issue #39): ensure `entryAbs` is a directory link to
   *  `ssotAbs` (junction/copy fallback inside). Omitted => copy-only behavior
   *  (legacy semantics; also the test-injection default). */
  ensureSkillDirLink?: (
    entryAbs: string,
    ssotAbs: string,
  ) => { mode: "link" | "junction" | "copy"; changed: boolean; divergent: boolean };
}

export interface InstallOpts {
  /** Refresh mode: re-write files whose content differs from the bundle
   *  (hash-compare); identical files are still skipped. Default (off) keeps the
   *  fill-gaps-only semantics — present files are never touched. */
  refresh?: boolean;
}

/** Materialize the official skills into ~/.agents/skills/. Idempotent: a file
 *  already present is skipped (never overwritten) in default mode, so a re-run
 *  is a no-op and a local edit is preserved (matching harness-config's
 *  --ignore-existing). With { refresh: true }, files that differ from the
 *  bundle are re-written (stale copies fixed), identical ones skipped. */
export function installSkills(deps: InstallDeps, skillNames: string[], opts: InstallOpts = {}): InstallResult {
  const root = deps.userSkillsRoot();
  const out: InstallResult = { ok: true, skills: [] };

  for (const name of skillNames) {
    // Thin-link path (issue #39): inside a workbench with a real SSOT dir, the
    // user-level entry becomes a directory link to it — one physical copy per
    // machine-side truth, re-pointed on each install. Skills with no workbench
    // SSOT (machine-global, or no workbench context) fall back to per-file copy.
    const ssot = deps.workbenchSkillDir?.(name) ?? null;
    if (ssot !== null && deps.ensureSkillDirLink) {
      const r = deps.ensureSkillDirLink(join(root, name), ssot);
      out.skills.push({
        name,
        created: [],
        updated: [],
        skipped: [],
        link: { mode: r.mode, action: r.divergent ? "replaced-divergent" : r.changed ? "created" : "active" },
      });
      continue;
    }
    const prefix = `skills/${name}/`;
    // Collect this skill's bundled files, excluding runtime artifacts.
    const keys = deps
      .assetKeys()
      .filter((k) => k.startsWith(prefix))
      .filter((k) => !k.includes("/__pycache__/") && !k.endsWith(".pyc") && !k.endsWith(".pyo") && !k.includes("/.git/"));

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    for (const key of keys) {
      const rel = key.slice(prefix.length); // e.g. SKILL.md, references/x.md
      const abs = join(root, name, rel);
      if (deps.exists(abs)) {
        if (opts.refresh) {
          const want = deps.assetContent(key);
          const cur = deps.readFile(abs);
          if (want !== undefined && cur !== null && cur !== want) {
            updated.push(rel);
            if (!deps.dryRun) deps.writeFile(abs, want, rel);
            continue;
          }
        }
        skipped.push(rel);
        continue;
      }
      const content = deps.assetContent(key);
      if (content === undefined) continue;
      created.push(rel);
      if (!deps.dryRun) deps.writeFile(abs, content, rel);
    }
    out.skills.push({ name, created, updated, skipped });
  }

  return out;
}
