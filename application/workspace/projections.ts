// application/workspace/projections.ts — thin-link skill projection engine
// (issue #39). The SSOT stays `.jspace/skills/<name>` (physical files); every
// harness projection dir (`.agents|.claude|.grok|.opencode/skills/`) and the
// user-level `~/.agents/skills/` reference a skill through a DIRECTORY symlink,
// so all discovery roots resolve to one realpath: harness name-collisions dedup
// silently (pi's realpath set) and the "SKILL.md body vs `~/.agents/...`
// details" divergence becomes physically impossible. Platforms without symlink
// privilege fall back to a junction (Windows) or a VISIBLY reported copy —
// never a silent look-alike copy.
//
// Only manifest-declared skill names are managed here; user-created dirs in a
// projection root are never touched (empty leftovers of RETIRED skills are the
// one exception — they are machine residue, not user content).
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { MaterializedLinkEntry } from "../../core/contracts/materialized.ts";
import { skillRoot } from "../fs.ts";
import { diffDirs } from "../diagnostics/checks/shared.ts";

export type ProjectionLinkMode = "link" | "junction" | "copy";

export interface LinkOp {
  /** Projection entry path relative to the workbench root. */
  rel: string;
  action: "create" | "relink" | "collapse" | "replace-remnant" | "keep-divergent" | "no-op";
  /** Link target text as written (relative for in-workbench projections,
   *  absolute for user-level). */
  target: string;
  mode?: ProjectionLinkMode;
  detail?: string;
}

export interface ProjectionApplyResult {
  /** Journal `links` section: every managed projection entry, including
   *  copy-fallback and kept-divergent ones (mode "copy" = doctor visibility). */
  links: Record<string, MaterializedLinkEntry>;
  /** User-facing lines (info level — fallbacks and keeps must be visible). */
  lines: string[];
}

/** Official skill names declared by the manifest (the only entries the engine
 *  manages in a projection root). */
export function manifestSkillNames(manifest: DistributionManifestV1): string[] {
  const names = new Set<string>();
  for (const f of manifest.files) {
    if (f.path.startsWith("skills/")) names.add(f.path.slice("skills/".length).split("/")[0]);
  }
  return [...names].sort();
}

/** True when the dir holds nothing but machine residue: diffDirs already
 *  ignores dotfiles + __pycache__, so "no content diffs" plus "no unmanaged
 *  entries" means the dir is byte-equivalent to the SSOT and collapsible. */
function hasUnmanagedEntries(dir: string, ssotDir: string): boolean {
  const ssotNames = new Set(readdirSync(ssotDir));
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "__pycache__") continue;
    if (!ssotNames.has(name)) return true;
  }
  return false;
}

/** True when the dir holds nothing but machine residue (dotfiles/__pycache__) —
 *  in particular EMPTY, e.g. after the journal `remove` path unlinked a legacy
 *  copy's files. Such a dir under a managed name is never user content. */
function isResidueOnly(dir: string): boolean {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "__pycache__") continue;
    return false;
  }
  return true;
}

/** Classify one projection entry against its SSOT dir (read-only). lstat first:
 *  a dangling symlink must classify as relink, not create (existsSync would
 *  follow the dead link and misread it as absent). */
function classifyEntry(entryAbs: string, ssotDir: string): LinkOp["action"] {
  let lst;
  try {
    lst = lstatSync(entryAbs);
  } catch {
    return "create";
  }
  if (lst.isSymbolicLink()) {
    try {
      return realpathSync(entryAbs) === realpathSync(ssotDir) ? "no-op" : "relink";
    } catch {
      return "relink"; // dangling link
    }
  }
  if (lst.isFile()) return "replace-remnant"; // Windows git checkout w/ core.symlinks=false
  // real dir: residue-only (e.g. emptied by the per-file `remove` path) or
  // content-equal dirs collapse into the link; anything with unmanaged user
  // content is kept as a divergent copy (never destroyed).
  if (isResidueOnly(entryAbs) || (diffDirs(ssotDir, entryAbs).length === 0 && !hasUnmanagedEntries(entryAbs, ssotDir))) {
    return "collapse";
  }
  return "keep-divergent";
}

/** Create a directory symlink at `entryAbs` whose stored target text is
 *  `linkText` (relative for in-workbench projections so the workbench stays
 *  movable; `targetAbs` is the same destination, needed for junctions — which
 *  normalize to absolute — and for the copy fallback). Falls back junction
 *  (Windows) then recursive copy, each reported via the returned mode. Caller
 *  removes any conflicting entry first. */
function createSymlink(entryAbs: string, linkText: string, targetAbs: string): ProjectionLinkMode {
  mkdirSync(dirname(entryAbs), { recursive: true });
  try {
    symlinkSync(linkText, entryAbs, "dir");
    return "link";
  } catch {
    if (process.platform === "win32") {
      try {
        symlinkSync(resolve(targetAbs), entryAbs, "junction");
        return "junction";
      } catch {
        /* fall through to copy */
      }
    }
  }
  cpSync(targetAbs, entryAbs, { recursive: true });
  return "copy";
}

/** Relative link target from the projection root to the SSOT dir (POSIX-stable,
 *  survives workbench moves; junctions normalize to absolute on Windows). */
function relativeTarget(projectionRootAbs: string, ssotDirAbs: string): string {
  return relative(projectionRootAbs, ssotDirAbs);
}

export interface ProjectionPlanOptions {
  skillNames: string[];
  projectionDirs: readonly string[];
}

/** Plan (read-only) the thin-link state for every (projection, skill) pair. */
export function planProjectionLinks(root: string, opts: ProjectionPlanOptions): LinkOp[] {
  const ops: LinkOp[] = [];
  for (const proj of opts.projectionDirs) {
    const projectionRootAbs = join(root, proj);
    for (const name of opts.skillNames) {
      const ssotDir = skillRoot(root, name);
      if (!existsSync(ssotDir)) continue; // SSOT materializes first, always
      const rel = `${proj}/${name}`;
      const entryAbs = join(root, rel);
      const action = classifyEntry(entryAbs, ssotDir);
      ops.push({
        rel,
        action,
        target: relativeTarget(projectionRootAbs, ssotDir),
        ...(action === "keep-divergent"
          ? { mode: "copy" as const, detail: "content differs from SSOT; kept as copy (delete it and re-run jspace workspace upgrade to converge)" }
          : {}),
      });
    }
  }
  return ops;
}

/** Apply the thin-link plan: execute every non-no-op op, sweep empty residue
 *  dirs of retired skills, and return the journal links section + info lines. */
export function applyProjectionLinks(root: string, opts: ProjectionPlanOptions): ProjectionApplyResult {
  const links: Record<string, MaterializedLinkEntry> = {};
  const lines: string[] = [];
  const ops = planProjectionLinks(root, opts);
  for (const proj of opts.projectionDirs) {
    const projectionRootAbs = join(root, proj);
    if (!existsSync(projectionRootAbs)) mkdirSync(projectionRootAbs, { recursive: true });
    for (const op of ops.filter((o) => o.rel.startsWith(`${proj}/`))) {
      const entryAbs = join(root, op.rel);
      if (op.action === "no-op") {
        links[op.rel] = { target: op.target, mode: "link" };
        continue;
      }
      if (op.action === "keep-divergent") {
        links[op.rel] = { target: op.target, mode: "copy" };
        lines.push(`jspace: info: ${op.rel} kept as copy: ${op.detail}`);
        continue;
      }
      rmSync(entryAbs, { recursive: true, force: true });
      const mode = createSymlink(entryAbs, op.target, resolve(projectionRootAbs, op.target));
      links[op.rel] = { target: op.target, mode };
      if (mode === "copy") {
        lines.push(`jspace: info: ${op.rel} materialized as COPY (symlink unavailable on this platform); content is a snapshot, not a link`);
      }
    }
    sweepResidue(projectionRootAbs, opts.skillNames);
  }
  return { links, lines };
}

/** Remove machine residue in a projection root: empty dirs left behind by
 *  retired-skill cleanup (their files go through the journal `remove` path).
 *  Managed (manifest) skill entries belong to the link flow above and are
 *  never swept here; non-empty user dirs are never touched. */
function sweepResidue(projectionRootAbs: string, managed: string[]): void {
  if (!existsSync(projectionRootAbs)) return;
  const managedNames = new Set(managed);
  for (const name of readdirSync(projectionRootAbs)) {
    if (managedNames.has(name)) continue;
    const p = join(projectionRootAbs, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
  }
}

/** Ensure the USER-level skill entry (`~/.agents/skills/<name>`) is a directory
 *  link to the workbench SSOT. Same classification rules as workbench
 *  projections; `divergent: true` means a locally-different real dir was KEPT
 *  (never destroyed) — caller surfaces it. */
export function ensureUserSkillLink(
  entryAbs: string,
  ssotDirAbs: string,
): { mode: ProjectionLinkMode; changed: boolean; divergent: boolean } {
  const action = classifyEntry(entryAbs, ssotDirAbs);
  if (action === "no-op") return { mode: "link", changed: false, divergent: false };
  if (action === "keep-divergent") return { mode: "copy", changed: false, divergent: true };
  rmSync(entryAbs, { recursive: true, force: true });
  const mode = createSymlink(entryAbs, ssotDirAbs, ssotDirAbs);
  return { mode, changed: true, divergent: false };
}

/** Read-only classification for a user-level entry — dry-run surface of
 *  ensureUserSkillLink (never mutates). */
export function classifyUserSkillLink(
  entryAbs: string,
  ssotDirAbs: string,
): LinkOp["action"] {
  return classifyEntry(entryAbs, ssotDirAbs);
}
