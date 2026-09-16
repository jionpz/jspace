// application/diagnostics/checks/skills.ts — skill materialization + projection health.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { CONFIG_DIR } from "../../../core/contracts/files.ts";
import { readMaterializedJournal } from "../../workspace/journal.ts";
import { skillProjections } from "../../workspace/manifest.ts";
import { isFile } from "../../fs.ts";
import type { SkillsDeps } from "../deps.ts";
import {
  activeHarnesses,
  BLOCK_END,
  diffDirs,
  editedSeedRepair,
  harnessFindingSeverity,
  RETIRED_SKILL_NAMES,
  SEED_HOOK_REPAIR,
} from "./shared.ts";

/** Existence probe that also sees dangling symlinks (existsSync does not), so a
 *  retired name left as a broken link still counts as residue. */
function present(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Skill materialization health: orphan dirs, harness projection drift, legacy
 *  root copies, and the claude harness pointer (CLAUDE.md + context hooks). */
export function checkSkills(root: string, deps: SkillsDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];

  {
    const official = new Set(deps.officialSkillNames());
    let recorded = new Set<string>();
    try {
      const j = readMaterializedJournal(root);
      if (j) recorded = new Set(Object.keys(j.files));
    } catch {
      // damaged journal: orphan detection skipped (workspace diff/upgrade report it)
    }
    const skillsDir = join(root, CONFIG_DIR, "skills");
    if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
      for (const name of readdirSync(skillsDir)) {
        if (official.has(name)) continue;
        if (name.startsWith(".")) continue;
        const p = join(skillsDir, name);
        if (!statSync(p).isDirectory()) continue;
        const rel = `${CONFIG_DIR}/skills/${name}`;
        const isRecorded = [...recorded].some((r) => r === rel || r.startsWith(`${rel}/`));
        if (isRecorded) continue;
        diags.push({
          severity: "warning",
          code: "skills.orphan_dir",
          path: `skills.${name}`,
          message: `orphan skill dir: .jspace/skills/${name} (not in the current bundle and no journal record; if not user-created, remove it manually)`,
        });
      }
    }
  }

  {
    const claudeMd = join(root, "CLAUDE.md");
    const present = existsSync(claudeMd) && statSync(claudeMd).isFile();
    let imports = false;
    if (present) {
      try {
        imports = /@(?:\.\/)?AGENTS\.md/.test(readFileSync(claudeMd, "utf-8"));
      } catch {
        imports = false;
      }
    }
    if (!imports) {
      // Two different situations, two honest instructions (issue #52): a missing
      // seed IS re-created by upgrade, an edited one is preserved (skip).
      diags.push({
        severity: harnessFindingSeverity("claude", activeHarnesses(root, deps)),
        code: "claude.pointer_missing",
        path: "CLAUDE.md",
        message: present
          ? `CLAUDE.md exists but no longer imports @AGENTS.md, so Claude Code cannot see the workbench context; ${editedSeedRepair("the @AGENTS.md import")}`
          : "CLAUDE.md missing or not a regular file; Claude Code cannot see the workbench context (a missing seed is re-created by 'jspace workspace upgrade'; irrelevant if you use a non-Claude harness)",
      });
    }
  }

  {
    const settingsPath = join(root, ".claude", "settings.json");
    if (existsSync(settingsPath) && statSync(settingsPath).isFile()) {
      try {
        const wired = readFileSync(settingsPath, "utf-8").includes("jspace context");
        if (!wired) {
          // Same range rule + same repair sentence as
          // harness.session_start_not_wired (issue #52): one edited seed, one
          // honest instruction — never "run upgrade and the warning clears".
          const active = activeHarnesses(root, deps);
          diags.push({
            severity: harnessFindingSeverity("claude", active),
            code: "hooks.not_wired",
            path: ".claude/settings.json",
            message: `.claude/settings.json exists but lacks the jspace context hooks; ${SEED_HOOK_REPAIR}`,
          });
        }
      } catch {
        // unreadable settings: skip
      }
    }
  }

  {
    const projRecorded = new Map<string, Set<string>>();
    for (const proj of skillProjections()) projRecorded.set(proj, new Set());
    try {
      const j = readMaterializedJournal(root);
      if (j) {
        for (const rel of Object.keys(j.files)) {
          for (const proj of skillProjections()) {
            const re = new RegExp(`^${proj.replace(/\./g, "\\.")}/([^/]+)(?:/|$)`);
            const m = re.exec(rel);
            if (m) projRecorded.get(proj)!.add(m[1]);
          }
        }
      }
    } catch {
      // damaged journal
    }
    for (const proj of skillProjections()) {
      for (const name of deps.officialSkillNames()) {
        const sourceDir = join(root, CONFIG_DIR, "skills", name);
        const projDir = join(root, proj, name);
        if (!existsSync(sourceDir)) continue;
        if (!existsSync(projDir)) {
          if (!projRecorded.get(proj)!.has(name)) continue;
          diags.push({
            severity: "warning",
            code: "skills.projection_drift",
            path: `${proj}.${name}`,
            message: `skill projection drift: ${proj}/${name} is missing entirely (it was materialized before; run jspace workspace upgrade to re-create it)`,
          });
          continue;
        }
        const diffs = diffDirs(sourceDir, projDir);
        if (diffs.length === 0) continue;
        diags.push({
          severity: "warning",
          code: "skills.projection_drift",
          path: `${proj}.${name}`,
          message: `skill projection drift: ${proj}/${name} differs from .jspace/skills/${name} (${diffs.slice(0, 3).join(", ")}${diffs.length > 3 ? ", …" : ""}); thin-link upgrade collapses content-identical copies into dir links, divergent ones are kept as copy — see jspace workspace diff`,
        });
      }
    }
  }

  {
    // Thin-link visibility (issue #39): a projection recorded as mode "copy" is
    // a fallback snapshot (symlinks unavailable on that platform), never a
    // silent look-alike link. info — structure works, only link benefits are lost.
    const links = readMaterializedJournal(root)?.links ?? {};
    const copies = Object.entries(links)
      .filter(([, l]) => l.mode === "copy")
      .map(([rel]) => rel);
    if (copies.length > 0) {
      diags.push({
        severity: "info",
        code: "skills.copy_fallback",
        path: "skills",
        message: `skill projection(s) materialized as COPY (symlinks unavailable on this platform): ${copies.slice(0, 3).join(", ")}${copies.length > 3 ? ", …" : ""}; they are snapshots, not links — workspace upgrade re-checks them on every run`,
      });
    }
  }

  {
    // User-level thin-link health (issue #39): duplicate discovery roots and
    // broken links. Skipped entirely when the user root dep is not wired.
    const userRoot = deps.userSkillsRoot?.();
    if (userRoot !== undefined) {
      const projDirs = skillProjections();
      const duplicates: string[] = [];
      const broken: string[] = [];
      for (const name of deps.officialSkillNames()) {
        const userEntry = join(userRoot, name);
        let lst;
        try {
          lst = lstatSync(userEntry);
        } catch {
          continue; // never installed at user level — global_missing covers the absent case
        }
        if (lst.isSymbolicLink()) {
          try {
            realpathSync(userEntry);
          } catch {
            broken.push(name); // dangling: the workbench SSOT moved or is unmounted
          }
          continue;
        }
        // Real dir at user level + a workbench projection also visible to
        // harnesses that scan both roots (e.g. pi) => two name-colliding copies.
        if (projDirs.some((p) => existsSync(join(root, p, name)))) duplicates.push(name);
      }
      if (broken.length > 0) {
        diags.push({
          severity: "warning",
          code: "skills.user_link_broken",
          path: "skills",
          message: `user-level skill link(s) broken (dangling): ${broken.join(", ")} at ${userRoot}; run jspace skills install inside the workbench to re-point them`,
        });
      }
      if (duplicates.length > 0) {
        diags.push({
          severity: "info",
          code: "skills.duplicate_roots",
          path: "skills",
          message: `official skill(s) visible from two discovery roots with different content: ${duplicates.slice(0, 5).join(", ")}${duplicates.length > 5 ? ", …" : ""} — harnesses that scan both ~/.agents/skills and the workbench projections (e.g. pi) warn on name collision; thin-link state (skills install inside the workbench + workspace upgrade) collapses them to one realpath`,
        });
      }

      // Retired official names must not survive on a deployed machine: harnesses
      // keep discovering them and injecting a contract JSpace no longer ships, so
      // "the official skill set is ours" is only true once the name is gone.
      // Present because a machine ran `jspace update` (binary only) and never the
      // follow-up that materializes the skill layer.
      const retiredLeft: string[] = [];
      for (const name of RETIRED_SKILL_NAMES) {
        for (const rel of ["skills", ...projDirs]) {
          const entry = rel === "skills" ? join(root, CONFIG_DIR, "skills", name) : join(root, rel, name);
          if (present(entry)) retiredLeft.push(`${rel === "skills" ? `${CONFIG_DIR}/skills` : rel}/${name}`);
        }
        if (present(join(userRoot, name))) retiredLeft.push(`~/.agents/skills/${name}`);
      }
      if (retiredLeft.length > 0) {
        diags.push({
          severity: "warning",
          code: "skills.retired_present",
          path: "skills",
          message: `retired official skill(s) still materialized: ${retiredLeft.join(", ")} — a harness will keep injecting a contract JSpace no longer ships. Run jspace workspace upgrade (or jspace skills install --refresh) inside the workbench; it deletes retired names outright`,
        });
      }
    }
  }

  {
    const official = new Set([...deps.officialSkillNames(), ...RETIRED_SKILL_NAMES]);
    const rootSkills = join(root, "skills");
    if (existsSync(rootSkills) && statSync(rootSkills).isDirectory()) {
      for (const name of readdirSync(rootSkills)) {
        if (name.startsWith(".")) continue;
        if (!official.has(name)) continue;
        const p = join(rootSkills, name);
        if (!statSync(p).isDirectory()) continue;
        diags.push({
          severity: "warning",
          code: "skills.legacy_root_copy",
          path: `skills.${name}`,
          message: `legacy copy of official skill in root skills/: skills/${name} (official skills live under .jspace/skills/; if not user-created, remove it manually)`,
        });
      }
    }
  }

  {
    const stale = deps.bundleStaleSkills?.(root) ?? [];
    if (stale.length > 0) {
      diags.push({
        severity: "info",
        code: "skills.bundle_stale",
        path: "skills",
        message: `official skill(s) differ from the running bundle: ${stale.join(", ")}; run jspace workspace upgrade (it refreshes unmodified copies here and in ~/.agents/skills, and preserves local edits as skip/conflict)`,
      });
    }
  }

  {
    // Machine-global skills (manifest.global, e.g. harness-config) live at a
    // per-machine path outside the workbench; a declared-but-absent install is
    // how official docs' references turn into dead links (issue #37). info:
    // the skill is optional machine-level tooling, not a workbench fault.
    for (const g of deps.globalSkills?.() ?? []) {
      if (isFile(join(g.installPath, "SKILL.md"))) continue;
      diags.push({
        severity: "info",
        code: "skills.global_missing",
        path: `skills.${g.name}`,
        message: `machine-global skill not installed: ${g.name} has no SKILL.md at ${g.installPath} (official skill docs reference it); run jspace skills install`,
      });
    }
  }

  {
    const agentsPath = join(root, "AGENTS.md");
    const body = isFile(agentsPath) ? readFileSync(agentsPath, "utf-8") : null;
    const endIdx = body?.indexOf(BLOCK_END) ?? -1;
    if (body !== null && endIdx !== -1) {
      const outside = body.slice(endIdx + BLOCK_END.length);
      const hits: string[] = [];
      // Detects generated-block markers in the user-owned region (a pre-block-era
      // template dump). Current marker is JSPACE-BRAIN-OPS; the TRELLIS-* spellings
      // are the retired historical names (renamed with the jspace naming cleanup,
      // see scripts/skill-frontmatter.ts) and MUST stay listed — legacy residue in
      // old workbenches carries them.
      for (const marker of ["JSPACE-BRAIN-OPS:BEGIN", "TRELLIS-BRAIN-OPS:BEGIN", "TRELLIS-SKILL-GOV:BEGIN"]) {
        if (outside.includes(marker)) hits.push(`generated block ${marker}`);
      }
      for (const retired of RETIRED_SKILL_NAMES) {
        if (outside.includes(retired)) hits.push(`retired skill name ${retired}`);
      }
      if (hits.length > 0) {
        diags.push({
          severity: "warning",
          code: "agentsmd.stale_outside_block",
          path: "AGENTS.md",
          message: `AGENTS.md carries stale template residue outside the JSPACE block (${hits.join(", ")}); that region is yours — jspace never rewrites it, so a pre-block-era copy keeps injecting contradictory rules. Back the file up, then delete everything after ${BLOCK_END} that you did not write`,
        });
      }
    }
  }

  return diags;
}
