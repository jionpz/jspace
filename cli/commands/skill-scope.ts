// cli/commands/skill-scope.ts — the one place that decides where an official
// skill is allowed to be discovered.
//
// `global` skills (manifest.global) live in the user-level `~/.agents/skills/`.
// `workbench` skills live ONLY in `<workbench>/.jspace/skills/` plus the
// in-workbench projections; a user-level copy is machine state left behind by
// older bundles, and it is wrong for two reasons: `~/.agents/skills/<name>` can
// only point at one workbench, and the contract references workbench-relative
// state that does not exist in unrelated directories.
//
// This module owns the proof that an entry is an OFFICIAL projection (structure
// or byte equality) so cleanup never deletes a user-authored skill. It needs the
// embedded bundle, so it lives in cli and is injected into doctor as a dep.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { skillRoot } from "../../application/fs.ts";
import {
  classifyMisplacedEntry,
  removeMisplacedUserSkills,
  type MisplacedCleanup,
  type MisplacedEntryClass,
} from "../../application/workspace/projections.ts";
import { MARKER_FILE } from "../../core/contracts/files.ts";
import { ASSETS } from "../assets.generated.ts";
import { GLOBAL_SKILLS } from "../global-skills.generated.ts";

function bundledFiles(name: string): Map<string, string> {
  const prefix = `skills/${name}/`;
  const out = new Map<string, string>();
  for (const [key, body] of Object.entries(ASSETS)) {
    if (key.startsWith(prefix)) out.set(key.slice(prefix.length), body);
  }
  return out;
}

/** True when `dir` holds exactly `want` with identical bytes (dotfiles and
 *  `__pycache__` ignored, as in diffDirs). */
function dirMatchesBundle(dir: string, want: Map<string, string>): boolean {
  if (want.size === 0) return false;
  const seen = new Set<string>();
  const walk = (d: string, rel: string): boolean => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "__pycache__") continue;
      const abs = join(d, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        return false;
      }
      if (st.isDirectory()) {
        if (!walk(abs, relPath)) return false;
        continue;
      }
      const expected = want.get(relPath);
      if (expected === undefined) return false;
      try {
        if (readFileSync(abs, "utf-8") !== expected) return false;
      } catch {
        return false;
      }
      seen.add(relPath);
    }
    return true;
  };
  return walk(dir, "") && seen.size === want.size;
}

/** Machine-global skills whose installed copy differs from the bundle. Absent
 *  installs belong to skills.global_missing, not to staleness. */
export function staleGlobalSkills(userRoot: string): string[] {
  const byName = new Map<string, Map<string, string>>();
  for (const [key, body] of Object.entries(GLOBAL_SKILLS)) {
    const m = /^skills\/([^/]+)\/(.+)$/.exec(key);
    if (!m) continue;
    const files = byName.get(m[1]!) ?? new Map<string, string>();
    files.set(m[2]!, body);
    byName.set(m[1]!, files);
  }
  const out: string[] = [];
  for (const [name, files] of byName) {
    if (!existsSync(join(userRoot, name))) continue;
    if (!dirMatchesBundle(join(userRoot, name), files)) out.push(name);
  }
  return out.sort();
}

/** True when `entryAbs` holds exactly the bundled file set with identical bytes.
 *  Dotfiles and `__pycache__` are ignored, as in diffDirs. This is how a Windows
 *  no-symlink COPY fallback is proven to be machine state rather than a user
 *  edit — the only content-based evidence we accept. */
export function isOfficialCopy(entryAbs: string, name: string): boolean {
  return dirMatchesBundle(entryAbs, bundledFiles(name));
}

/** A directory is a workbench when it carries the marker file — an arbitrary cwd
 *  must never be treated as a skill SSOT. */
export function isWorkbenchRoot(root: string): boolean {
  return existsSync(join(root, MARKER_FILE));
}

/** Classify `~/.agents/skills/<name>` for a workbench-scoped official skill. */
export function classifyUserSkill(
  userRoot: string,
  workbenchRoot: string,
  name: string,
): MisplacedEntryClass {
  const ownSsot = isWorkbenchRoot(workbenchRoot) ? skillRoot(workbenchRoot, name) : null;
  return classifyMisplacedEntry(join(userRoot, name), ownSsot, isOfficialCopy, name);
}

/** Remove workbench-scoped official skills from the user-level root. */
export function pruneWorkbenchSkillsFromUserLevel(opts: {
  userRoot: string;
  workbenchRoot: string;
  names: readonly string[];
  dryRun?: boolean;
}): MisplacedCleanup {
  return removeMisplacedUserSkills(
    opts.userRoot,
    opts.names,
    (name) => classifyUserSkill(opts.userRoot, opts.workbenchRoot, name),
    opts.dryRun ?? false,
  );
}

/** Human-readable lines for a prune run (shared by `skills install` and
 *  `workspace upgrade`). */
export function summarizePrune(cleanup: MisplacedCleanup, userRoot: string, dryRun: boolean): string[] {
  const lines: string[] = [];
  for (const item of cleanup.removed) {
    const p = join(userRoot, item.name);
    lines.push(
      dryRun
        ? `jspace: info: (dry-run) would remove user-level workbench skill ${p} (${item.class})`
        : `jspace: info: removed user-level workbench skill ${p} (${item.class}; workbench skills are discovered from the workbench, not ~/.agents/skills)`,
    );
  }
  for (const item of cleanup.preserved) {
    lines.push(
      `jspace: warning: preserved ${join(userRoot, item.name)} — its content is not the official copy, so it may be your own skill; remove it manually if it is a stale copy`,
    );
  }
  return lines;
}
