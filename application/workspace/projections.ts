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
// The official skill set is FULLY managed: a real dir under a manifest name is
// stale machine state and is converged to the link (never kept divergent), and
// RETIRED names are DELETED outright — a renamed/removed official skill must not
// survive on a deployed machine. User-created dirs under other names are still
// never touched (empty leftovers are the only other thing swept).
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { MaterializedLinkEntry } from "../../core/contracts/materialized.ts";
import { skillRoot } from "../fs.ts";
import { diffDirs } from "../diagnostics/checks/shared.ts";
import { retiredSet } from "../skills/retired.ts";

export type ProjectionLinkMode = "link" | "junction" | "copy";

export interface LinkOp {
  /** Projection entry path relative to the workbench root. */
  rel: string;
  action: "create" | "relink" | "collapse" | "replace-remnant" | "converge" | "no-op";
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

export interface RetiredUserSkillPreservation {
  name: string;
  reason: string;
}

export interface RetiredUserSkillCleanup {
  removed: string[];
  preserved: RetiredUserSkillPreservation[];
}

/**
 * Content fingerprints of every `jspace-bootstrap` file ever shipped from this
 * repository. A user-level directory only counts as machine residue when every
 * file is one of these exact historical official files; a same-named directory
 * with user content or an edited copy is preserved and reported.
 */
const RETIRED_OFFICIAL_SHA256: Readonly<Record<string, readonly string[]>> = {
  "SKILL.md": [
    "25a6a9f5c6b181a9fce29fa650fa0a97d645b23628b93f1cfc4c74764c0d249b",
    "2b7feacf23e3eb00fcfd13536cbe0f5ccf8921d123bfe19eb2af493ff3a15ee3",
    "7cb3b504cb02f9c33d32a75a228a7e627ed09f8f7bdfa2501a0036ecffdd490e",
    "8455ea7ef302b5ffb86720f57d786c3f27a0bb15a22b777be98a97d1179f8016",
    "884e35352143dda38e012bb3c97283fb8d0807e2688528c022b396667003c1b6",
    "9ac8c36789c78cce7d07c16007c9cb1d15467987ef088f43661bf2aaae923c2a",
    "a1bd22ac85a5803e3588277062b5b0371f4777a4f441e91704137e7a1b0b21b1",
    "db873a31c8ae998746016e80e421701b3660a01dd2aeac9c952963eb67a0d834",
    "dbc27883519875dca658fd01480f719a6bf35331853161df89ac6f4d76ebdc40",
    "e35682a1291d96c9a915b0de408af5703f7a17c807f228f0f304e830730c2eda",
    "f418b78e30d40d420115678f6572d4f1659101e85883b4591dc78bb6bd1cbc7f",
    "fc338f3cd6ca53e0e426f424cd915696bc7d6f0e465034b0e0f6fc769e97407e",
  ],
  "agents/openai.yaml": ["d6fb2598ad72ff41a22e59ebe0f2ccc644791a816065176b3115bc0e2ee9e371"],
  "references/example-bootstrap.md": ["a7e9b0b0644d1fb17402c4b0b570f7daecd1b877e77552732ca9f64ff4d9e9df"],
  "references/gbrain.md": [
    "0d7053ffac87d4fd0e778cf40e9a2d66295dd00d557f55d828b39b05a99b30f1",
    "12905472c118603ca95920a18be21d6f8b51d5d1dd26c721ff19560b99ef3682",
    "2161ed8c3e9aa4fa44ead2e6d486cc6c110b9fe8fe4e1d26dbf0c9b5c1a22aa5",
    "2a101c539486add4d5e0ccde14347dbab76c95526d7f413f43bbadeb888b0c33",
    "380961bf70832dd0a8b4a5887e0da1fb647d564289afbd0cae05216abf3825ee",
    "64c63a1c12857e63e801dc2209c95b55b1a0602f57ac01549b9dc25c7d5789bc",
    "b067f3ab1e7c0b226868c2f65dd71f8a4a6d39fc1e7edf4418ca52f835cedf53",
    "ea0a756ec9ddf15341ff7251f9ace5c75aca64824f73a6214fe3c0605c2621a7",
  ],
  "references/harnesses.md": [
    "1ac7c176856fad40d4d858764004db7e8b2cad226f8a1dcbeb9355cf98ba4090",
    "35318bcbbae465a15f90b2280e150d693eb348a772e0f5a4474830952a569a4c",
    "5a8f4db5b5752681e309d27bf4679318cbad1a4f9829c24a2e26d767ec9eb3a9",
    "aeea3c2d77c8d204b0387ee37639c8b2f51139aa09b139df7c8e3d85ba16ec00",
    "b89338fcee6f56a46d4c116e27ce35cbb29d2b3f01e0fcdc048324845f2ed4e3",
    "e46b558f580d7dd88925828bb407c28e009b51235ab4880b90ef089ff126826c",
  ],
  "references/headless-ops.md": [
    "0d5e11027d00cca5d99e8e1538e58009243a898869b9d231b7406aec6dc0b6c1",
    "1fea930d72945e1609d2503667916877f20d9d4af9bbcf1c7a4acbeefc69b0f4",
    "a1aef844240e2ac0b07db93321e87026b0a9b59dd4db2e2ea8216ca1eedaaf58",
    "fa35f62bd7ba87bc4e9d29bec1af97567b2666523475982e90df5db84bb97c10",
  ],
  "references/registry.md": [
    "0b17b5292fc18d3bd2af43b9c76461c96a18fa344190ce86c9690b77a1ccdc91",
    "38c80a3dfed5b126481c9d6c2c99cd5cfd5ca49e262eb9cad049a2c2bc10eba2",
    "479c66d177329a574e564816697d13c47aee3ad811cef6eecdd3daa2f024139c",
    "8faf898a877d44440057bf128baa2fe9063b24229567648ae52cd57b41c347c0",
    "9d584e75c1db7890a6a9dc87d0bd8e51e39ba013d3c33e7be6a3dd6371c9cd42",
    "f652e7e6aec82c5bba7ca4ac2006a68a8f471735bcfd3bb4224c74f21545de1d",
    "fbab4b4399317e43f7bba1fad8f15b6e85be0b1b6eea2aa3d558868f94ee8283",
  ],
};

const RETIRED_OFFICIAL_HASH_SETS = new Map(
  Object.entries(RETIRED_OFFICIAL_SHA256).map(([rel, hashes]) => [rel, new Set(hashes)]),
);

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type RetiredOfficialProof = { safe: true } | { safe: false; reason: string };

/** Prove that a real directory is nothing but historical official files.
 *  Preservation wins on every ambiguity: unknown paths, edited files, symlinks,
 *  unreadable entries and unsupported objects are all reported as conflicts. */
function proveRetiredOfficialDir(dir: string): RetiredOfficialProof {
  const visit = (absDir: string): RetiredOfficialProof => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (error) {
      return { safe: false, reason: `directory is unreadable: ${(error as Error).message}` };
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      const rel = relative(dir, abs).replace(/\\/g, "/");
      if (entry.isSymbolicLink()) {
        return { safe: false, reason: `contains an unverified symlink: ${rel}` };
      }
      if (entry.isDirectory()) {
        const nested = visit(abs);
        if (!nested.safe) return nested;
        continue;
      }
      if (!entry.isFile()) {
        return { safe: false, reason: `contains an unsupported filesystem object: ${rel}` };
      }
      const allowed = RETIRED_OFFICIAL_HASH_SETS.get(rel);
      if (allowed === undefined) {
        return { safe: false, reason: `contains a file never shipped by the retired official skill: ${rel}` };
      }
      let digest: string;
      try {
        digest = fileSha256(abs);
      } catch (error) {
        return { safe: false, reason: `file is unreadable: ${rel}: ${(error as Error).message}` };
      }
      if (!allowed.has(digest)) {
        return { safe: false, reason: `contains a modified historical file: ${rel}` };
      }
    }
    return { safe: true };
  };
  return visit(dir);
}

function proveRetiredOfficialEntry(entryAbs: string): RetiredOfficialProof {
  let lst;
  try {
    lst = lstatSync(entryAbs);
  } catch (error) {
    return { safe: false, reason: `entry is unreadable: ${(error as Error).message}` };
  }
  if (lst.isSymbolicLink()) {
    let target: string;
    try {
      target = readlinkSync(entryAbs);
    } catch (error) {
      return { safe: false, reason: `symlink target is unreadable: ${(error as Error).message}` };
    }
    let real: string;
    try {
      real = realpathSync(entryAbs);
    } catch {
      return { safe: false, reason: `symlink target is missing: ${target}` };
    }
    let targetStat;
    try {
      targetStat = statSync(real);
    } catch (error) {
      return { safe: false, reason: `symlink target is unreadable: ${target}: ${(error as Error).message}` };
    }
    if (!targetStat.isDirectory()) {
      return { safe: false, reason: `symlink target is not a directory: ${target}` };
    }
    const proof = proveRetiredOfficialDir(real);
    if (!proof.safe) {
      return { safe: false, reason: `symlink target is not a proven historical official copy (${target}): ${proof.reason}` };
    }
    return { safe: true };
  }
  if (!lst.isDirectory()) {
    return { safe: false, reason: "entry is not a directory" };
  }
  return proveRetiredOfficialDir(entryAbs);
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
  // Real dir under a MANAGED name: either residue-only (e.g. emptied by the
  // per-file `remove` path) or genuinely divergent — both end as a link, because
  // official skills are entirely ours. `collapse` = byte-equivalent, so it can be
  // done quietly; `converge` = content differs and the replacement is reported.
  if (isResidueOnly(entryAbs) || (diffDirs(ssotDir, entryAbs).length === 0 && !hasUnmanagedEntries(entryAbs, ssotDir))) {
    return "collapse";
  }
  return "converge";
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
        ...(action === "converge"
          ? { detail: "content differs from SSOT; replaced by a dir link (official skills are managed — local edits there are not preserved)" }
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
      const converging = op.action === "converge";
      rmSync(entryAbs, { recursive: true, force: true });
      const mode = createSymlink(entryAbs, op.target, resolve(projectionRootAbs, op.target));
      links[op.rel] = { target: op.target, mode };
      if (converging) {
        lines.push(`jspace: info: ${op.rel} replaced a divergent copy with a ${mode === "copy" ? "COPY" : "dir link"} to the bundle SSOT (official skills are managed; local edits there are not preserved)`);
      } else if (mode === "copy") {
        lines.push(`jspace: info: ${op.rel} materialized as COPY (symlink unavailable on this platform); content is a snapshot, not a link`);
      }
    }
    for (const name of sweepResidue(projectionRootAbs, opts.skillNames)) {
      lines.push(`jspace: info: removed retired official skill ${proj}/${name} (no longer shipped by jspace)`);
    }
  }
  return { links, lines };
}

/** Remove machine residue in a projection root:
 *  - a RETIRED official name: any entry (dir, file, dangling link), empty or
 *    not — we own the name, so a deleted/renamed skill must not survive;
 *  - any other non-managed EMPTY dir: residue of the retired-skill file cleanup.
 *  Managed (manifest) names belong to the link flow above; anything else with
 *  content is a user skill and is never touched. Returns removed retired names. */
function sweepResidue(projectionRootAbs: string, managed: string[]): string[] {
  const removed: string[] = [];
  if (!existsSync(projectionRootAbs)) return removed;
  const managedNames = new Set(managed);
  const retired = retiredSet(managed);
  for (const name of readdirSync(projectionRootAbs)) {
    if (managedNames.has(name)) continue;
    const p = join(projectionRootAbs, name);
    let lst;
    try {
      lst = lstatSync(p); // lstat: a dangling retired link must still be removable
    } catch {
      continue;
    }
    if (retired.has(name)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
      continue;
    }
    if (lst.isSymbolicLink() || !lst.isDirectory()) continue;
    if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
  }
  return removed;
}

/** Ensure the USER-level skill entry (`~/.agents/skills/<name>`) is a directory
 *  link to the workbench SSOT. Same classification rules as workbench
 *  projections. `divergent: true` means a real dir with different content stood
 *  where the link belongs; it is REPLACED (official skills are fully managed, so
 *  we never leave a stale copy behind) and the caller surfaces the replacement. */
export function ensureUserSkillLink(
  entryAbs: string,
  ssotDirAbs: string,
): { mode: ProjectionLinkMode; changed: boolean; divergent: boolean } {
  const action = classifyEntry(entryAbs, ssotDirAbs);
  if (action === "no-op") return { mode: "link", changed: false, divergent: false };
  const convergent = action === "converge";
  rmSync(entryAbs, { recursive: true, force: true });
  const mode = createSymlink(entryAbs, ssotDirAbs, ssotDirAbs);
  return { mode, changed: true, divergent: convergent };
}

/** Remove RETIRED official skills from a USER-level skill root only when their
 *  contents prove they are historical official copies. Unlike workbench
 *  projection dirs, `~/.agents/skills/` is user-owned: a same-named directory
 *  with unknown or edited content is preserved and reported. */
export function removeRetiredUserSkills(
  userRoot: string,
  officialNow: readonly string[],
  dryRun = false,
): RetiredUserSkillCleanup {
  const retired = retiredSet(officialNow);
  if (retired.size === 0) return { removed: [], preserved: [] };
  let names: string[];
  try {
    names = readdirSync(userRoot);
  } catch {
    return { removed: [], preserved: [] }; // not installed / unreadable — nothing to clean
  }
  const removed: string[] = [];
  const preserved: RetiredUserSkillPreservation[] = [];
  for (const name of names) {
    if (!retired.has(name)) continue;
    const entryAbs = join(userRoot, name);
    const proof = proveRetiredOfficialEntry(entryAbs);
    if (!proof.safe) {
      preserved.push({ name, reason: proof.reason });
      continue;
    }
    if (!dryRun) rmSync(join(userRoot, name), { recursive: true, force: true });
    removed.push(name);
  }
  return {
    removed: removed.sort(),
    preserved: preserved.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Read-only classification for a user-level entry — dry-run surface of
 *  ensureUserSkillLink (never mutates). */
export function classifyUserSkillLink(
  entryAbs: string,
  ssotDirAbs: string,
): LinkOp["action"] {
  return classifyEntry(entryAbs, ssotDirAbs);
}

/** Why a user-level entry under an official WORKBENCH skill name is there.
 *  Scope convergence: workbench skills must never be discovered from
 *  `~/.agents/skills/` (one user-level name can only point at one workbench,
 *  and the contract references workbench-relative state), so every class here
 *  except `absent` is machine state to clean up or report. */
export type MisplacedEntryClass =
  | "absent"
  | "link-local" // symlink -> THIS workbench's .jspace/skills/<name>
  | "link-foreign" // symlink -> another workbench's .jspace/skills/<name>
  | "link-dangling" // symlink whose target is gone (user_link_broken owns it)
  | "link-other" // symlink that points somewhere unrelated
  | "copy-official" // real dir, byte-identical to the bundle (Windows copy fallback)
  | "user-owned"; // real dir with local edits, or a non-dir entry

export function classifyMisplacedEntry(
  entryAbs: string,
  ownSsotAbs: string | null,
  isOfficialCopy: (entryAbs: string, name: string) => boolean,
  name: string,
): MisplacedEntryClass {
  let lst;
  try {
    lst = lstatSync(entryAbs);
  } catch {
    return "absent";
  }
  if (lst.isSymbolicLink()) {
    let real: string;
    try {
      real = realpathSync(entryAbs);
    } catch {
      return "link-dangling";
    }
    if (ownSsotAbs !== null) {
      try {
        if (real === realpathSync(ownSsotAbs)) return "link-local";
      } catch {
        // own SSOT missing: fall through, the link still points into a workbench
      }
    }
    // `<any workbench>/.jspace/skills/<name>` — a projection of ANOTHER
    // workbench. Structural proof, no content read needed.
    const parts = real.split(/[\\/]/);
    const n = parts.length;
    if (n >= 3 && parts[n - 3] === ".jspace" && parts[n - 2] === "skills" && parts[n - 1] === name) {
      return "link-foreign";
    }
    return "link-other";
  }
  if (!lst.isDirectory()) return "user-owned";
  return isOfficialCopy(entryAbs, name) ? "copy-official" : "user-owned";
}

export interface MisplacedCleanup {
  /** Proven official projections — removed (or, in dry-run, would be). */
  removed: Array<{ name: string; class: MisplacedEntryClass }>;
  /** Content differs from the bundle: possibly the user's own skill. Kept. */
  preserved: Array<{ name: string; class: MisplacedEntryClass }>;
  /** Left alone for a different diagnostic (dangling link, unrelated target). */
  skipped: Array<{ name: string; class: MisplacedEntryClass }>;
}

/** Remove workbench-scoped official skills from the USER-level root. Only
 *  entries proven to be official projections are deleted (a symlink into a
 *  workbench SSOT, or a byte-identical copy); anything with local content is
 *  preserved and reported. Mirrors removeRetiredUserSkills' ownership stance. */
export function removeMisplacedUserSkills(
  userRoot: string,
  names: readonly string[],
  classify: (name: string) => MisplacedEntryClass,
  dryRun = false,
): MisplacedCleanup {
  const out: MisplacedCleanup = { removed: [], preserved: [], skipped: [] };
  for (const name of names) {
    const cls = classify(name);
    if (cls === "link-local" || cls === "link-foreign" || cls === "copy-official") {
      if (!dryRun) rmSync(join(userRoot, name), { recursive: true, force: true });
      out.removed.push({ name, class: cls });
      continue;
    }
    if (cls === "user-owned") out.preserved.push({ name, class: cls });
    else if (cls !== "absent") out.skipped.push({ name, class: cls });
  }
  return out;
}
