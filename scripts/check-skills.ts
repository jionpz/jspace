// scripts/check-skills.ts — skill-tree health checks (dev-side; not materialized).
// Run: bun run scripts/check-skills.ts
//
//   C1 references: every relative reference (references/x.md, ../<skill>/references/x.md)
//                  from SKILL.md / references/*.md resolves on disk.
//   C2 render:     AGENTS.md "Brain operations" rows == SKILL.md frontmatter `triggers`
//                  (render output must equal what gen-assets would produce).
//   C3 routing:    "Brain operations" / "Skill Governance" skill sets == skills-manifest
//                  workbench list (excludes harness-config, a machine-global skill).
//   C4 freshness:  re-running gen-assets leaves git diff clean (generated assets synced).
//   C5 doc drift:  root README.md + AGENTS.md skill listings == skills-manifest
//                  workbench + global names; "manifest 合计 N" matches manifest.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeSkillsManifest } from "../core/contracts/skills.ts";
import { checkDocSkillListing, loadManifestSkillSets } from "./skill-doc-drift.ts";
import { readWorkbenchSkills } from "./skill-frontmatter.ts";

const repoRoot = resolve(import.meta.dir, "..");
const failures: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

function pass(label: string): void {
  console.log(`  ok: ${label}`);
}

// ---- C1: reference integrity -------------------------------------------------
// New form: `~/.agents/skills/<name>/<rest>` — must resolve to a repo source
// file skills/<name>/<rest> (the user-level ~/.agents/skills/ is materialized
// from the repo, so the repo source is the ground truth).
// Old forms (`references/x.md`, `../<skill>/...`) are now forbidden — a stale
// CWD-relative reference fails so the navigation fix can't silently regress.
{
  const skillDirs = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let checked = 0;
  const OLD_REF = /`(references\/[\w-]+\.md|\.\.\/[\w-]+\/(?:references\/[\w-]+\.md|SKILL\.md)|\.\.\/SKILL\.md)`/;
  for (const dir of skillDirs) {
    const base = join(repoRoot, "skills", dir);
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;
        const body = readFileSync(p, "utf-8");
        for (const line of body.split("\n")) {
          // New form: ~/.agents/skills/<name>/<rest>
          const m = line.match(/`~\/\.agents\/skills\/([\w-]+)\/([\w\/.-]+)`/);
          if (m) {
            // repo source: skills/<name>/<rest>
            const resolved = join(repoRoot, "skills", m[1], m[2]);
            if (!existsSync(resolved)) {
              fail(`C1 broken reference: ${p.replace(repoRoot + "/", "")} -> ~/.agents/skills/${m[1]}/${m[2]} (no repo source skills/${m[1]}/${m[2]})`);
            } else {
              checked++;
            }
            continue;
          }
          // Old CWD-relative form is forbidden (must use ~/.agents/skills/...)
          const old = line.match(OLD_REF);
          if (old) {
            fail(`C1 stale relative reference in ${p.replace(repoRoot + "/", "")}: \`${old[1]}\` — use \`~/.agents/skills/<skill>/...\` (multi-harness uniform) instead`);
          }
        }
      }
    };
    walk(base);
  }
  if (checked > 0) pass(`C1 references resolve (${checked} refs)`);
}

// ---- C2 + C3: render consistency and routing completeness --------------------
{
  const manifestRaw = JSON.parse(readFileSync(join(repoRoot, "skills-manifest.json"), "utf-8")) as unknown;
  const decoded = decodeSkillsManifest(manifestRaw);
  if (!decoded.ok) {
    fail(`skills-manifest.json invalid: ${decoded.issues.map((i) => `${i.code}: ${i.message}`).join("; ")}`);
  } else {
    const workbenchNames = decoded.value.workbench.map((s) => s.name);
    const agentsPath = join(repoRoot, "templates", "workbench", "AGENTS.md");
    const agents = readFileSync(agentsPath, "utf-8");

    // Brain operations rows must equal frontmatter triggers, joined the same way gen-assets joins.
    // readWorkbenchSkills also enforces the single-source invariant: every
    // workbench SKILL.md frontmatter name must match its manifest entry name.
    let workbenchFms: ReturnType<typeof readWorkbenchSkills>;
    try {
      workbenchFms = readWorkbenchSkills(repoRoot, workbenchNames);
    } catch (e) {
      fail(`C2 skill name single-source drift: ${(e as Error).message}`);
      workbenchFms = [];
    }
    const brainRows = new Map(workbenchFms.map((fm) => [fm.name, fm.triggers.join(" | ")]));
    const brainMatch = agents.match(/^<!-- JSPACE-BRAIN-OPS:BEGIN -->\n([\s\S]*?)\n<!-- JSPACE-BRAIN-OPS:END -->/m);
    if (!brainMatch) {
      fail("C2 no Brain operations marker region found");
    } else {
      const rows = new Map(
        brainMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- **"))
          .map((l) => {
            const m = l.match(/^- \*\*([\w-]+)\*\*: (.+)$/);
            return m ? [m[1], m[2]] : [l, "?"];
          }),
      );
      for (const [name, keywords] of brainRows) {
        if (rows.get(name) !== keywords) {
          fail(`C2 Brain operations row for ${name} != frontmatter triggers (run gen-assets)`);
        }
      }
      const extra = [...rows.keys()].filter((n) => !brainRows.has(n));
      if (extra.length > 0) fail(`C3 Brain operations has skills not in manifest: ${extra.join(", ")}`);
      pass("C2/C3 Brain operations consistent with frontmatter + manifest");
    }

    const govMatch = agents.match(/^<!-- TRELLIS-SKILL-GOV:BEGIN -->\n([\s\S]*?)\n<!-- TRELLIS-SKILL-GOV:END -->/m);
    if (govMatch) {
      // The Skill Governance render block was removed (child C of the workbench
      // context wiring); if a stale copy survives in a template, flag it so it
      // gets deleted rather than silently re-rendered.
      fail("C3 stale Skill Governance block still present in AGENTS.md (removed in child C); delete it");
    }
    pass("C3 Skill Governance block absent (removed in child C)");
  }
}

// ---- C4: freshness (regenerate -> generated files unchanged) -----------------
{
  // Files gen-assets owns. If regenerating changes any, the checked-in copy is stale.
  const generated = [
    "cli/assets.generated.ts",
    "cli/manifest.generated.ts",
    "cli/manifest.json",
    "cli/skills.generated.ts",
    "adapters/harness/capabilities.generated.ts",
    "templates/workbench/AGENTS.md",
  ];
  const snapshot = new Map(generated.map((f) => [f, readFileSync(join(repoRoot, f), "utf-8")]));
  try {
    // stdio: "inherit" so a gen-assets failure (e.g. the source-integrity guard
    // from issue #6/#7) prints its detailed error instead of a vague
    // "Command failed" (P1.5).
    execSync("bun run scripts/gen-assets.ts", { cwd: repoRoot, stdio: "inherit" });
    const changed = generated.filter((f) => readFileSync(join(repoRoot, f), "utf-8") !== snapshot.get(f));
    if (changed.length > 0) {
      fail(`C4 generated files are stale (run gen-assets and commit): ${changed.join(", ")}`);
    } else {
      pass("C4 gen-assets output is fresh (regenerate changes nothing)");
    }
  } catch (e) {
    fail(`C4 gen-assets failed: ${(e as Error).message}`);
  }
}

// ---- C5: root README/AGENTS skill listings vs skills-manifest ---------------
{
  const sets = loadManifestSkillSets(repoRoot);
  if ("error" in sets) {
    fail(`C5 skills-manifest.json invalid: ${sets.error}`);
  } else {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf-8");
    const c5Failures = [
      ...checkDocSkillListing(readme, "README.md", sets),
      ...checkDocSkillListing(agents, "AGENTS.md", sets),
    ];
    for (const msg of c5Failures) fail(msg);
    if (c5Failures.length === 0) {
      pass(`C5 README/AGENTS skill listings match manifest (${sets.total} skills)`);
    }
  }
}

// ---- summary ----------------------------------------------------------------
console.log("---");
if (failures.length > 0) {
  console.log(`FAILED: ${failures.length} issue(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("PASS: 全部 skills 自检通过");
