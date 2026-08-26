// application/diagnostics/checks/skills.ts — skill materialization + projection health.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { CONFIG_DIR } from "../../../core/contracts/files.ts";
import { readMaterializedJournal } from "../../workspace/journal.ts";
import { skillProjections } from "../../workspace/manifest.ts";
import { isFile } from "../../fs.ts";
import type { SkillsDeps } from "../deps.ts";
import { BLOCK_END, diffDirs, RETIRED_SKILL_NAMES } from "./shared.ts";

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
    let pointerOk = existsSync(claudeMd) && statSync(claudeMd).isFile();
    if (pointerOk) {
      try {
        pointerOk = /@(?:\.\/)?AGENTS\.md/.test(readFileSync(claudeMd, "utf-8"));
      } catch {
        pointerOk = false;
      }
    }
    if (!pointerOk) {
      diags.push({
        severity: "warning",
        code: "claude.pointer_missing",
        path: "CLAUDE.md",
        message: "CLAUDE.md missing or does not import @AGENTS.md; Claude Code cannot see the workbench context (run jspace workspace upgrade to re-create the seed file; irrelevant if you use a non-Claude harness)",
      });
    }
  }

  {
    const settingsPath = join(root, ".claude", "settings.json");
    if (existsSync(settingsPath) && statSync(settingsPath).isFile()) {
      try {
        const wired = readFileSync(settingsPath, "utf-8").includes("jspace context");
        if (!wired) {
          diags.push({
            severity: "warning",
            code: "hooks.not_wired",
            path: ".claude/settings.json",
            message: ".claude/settings.json exists but lacks the jspace context hooks; upgrade preserves a user-edited seed file (skip) — merge the hooks manually or restore the seed file",
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
          message: `skill projection drift: ${proj}/${name} differs from .jspace/skills/${name} (${diffs.slice(0, 3).join(", ")}${diffs.length > 3 ? ", …" : ""}); jspace workspace upgrade refreshes unmodified copies, user edits are preserved (check jspace workspace diff)`,
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
    const agentsPath = join(root, "AGENTS.md");
    const body = isFile(agentsPath) ? readFileSync(agentsPath, "utf-8") : null;
    const endIdx = body?.indexOf(BLOCK_END) ?? -1;
    if (body !== null && endIdx !== -1) {
      const outside = body.slice(endIdx + BLOCK_END.length);
      const hits: string[] = [];
      // "TRELLIS-" markers are the frozen historical wire format present in
      // deployed workbenches (see scripts/skill-frontmatter.ts); this residue
      // check must keep matching the OLD spelling even if a future rename adds
      // a new marker, so legacy copies are still detected.
      for (const marker of ["TRELLIS-BRAIN-OPS:BEGIN", "TRELLIS-SKILL-GOV:BEGIN"]) {
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
