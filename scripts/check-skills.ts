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
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeSkillsManifest } from "../core/contracts/skills.ts";
import { parseSkillFrontmatter, renderAgentsBlocks } from "./skill-frontmatter.ts";

const repoRoot = resolve(import.meta.dir, "..");
const failures: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

function pass(label: string): void {
  console.log(`  ok: ${label}`);
}

// ---- C1: reference integrity -------------------------------------------------
{
  const skillDirs = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let checked = 0;
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
          const m = line.match(/`(references\/[\w-]+\.md|\.\.\/[\w-]+\/references\/[\w-]+\.md)`/);
          if (!m) continue;
          // reference paths in skills/<dir>/** are relative to skills/<dir>/;
          // "../<skill>/references/x.md" stays repo-relative under skills/.
          const resolved = join(repoRoot, "skills", dir, m[1]);
          if (!existsSync(resolved)) {
            fail(`C1 broken reference: ${p.replace(repoRoot + "/", "")} -> ${m[1]}`);
          } else {
            checked++;
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
    const brainRows = new Map<string, string>();
    for (const name of workbenchNames) {
      const fm = parseSkillFrontmatter(readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8"));
      if (!fm) {
        fail(`C2 ${name}/SKILL.md has no frontmatter`);
        continue;
      }
      brainRows.set(fm.name, fm.triggers.join(" | "));
    }
    const brainMatch = agents.match(/^<!-- TRELLIS-BRAIN-OPS:BEGIN -->\n([\s\S]*?)\n<!-- TRELLIS-BRAIN-OPS:END -->/m);
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
    if (!govMatch) {
      fail("C3 no Skill Governance marker region found");
    } else {
      const govNames = [...govMatch[1].matchAll(/^- `([\w-]+)` -/g)].map((m) => m[1]);
      const diff = govNames.filter((n) => !workbenchNames.includes(n));
      if (diff.length > 0) fail(`C3 Skill Governance lists skills not in manifest: ${diff.join(", ")}`);
      pass("C3 Skill Governance set matches workbench manifest");
    }
  }
}

// ---- C4: freshness (regenerate -> generated files unchanged) -----------------
{
  // Files gen-assets owns. If regenerating changes any, the checked-in copy is stale.
  const generated = [
    "cli/assets.generated.ts",
    "cli/manifest.generated.ts",
    "cli/skills.generated.ts",
    "templates/workbench/AGENTS.md",
  ];
  const snapshot = new Map(generated.map((f) => [f, readFileSync(join(repoRoot, f), "utf-8")]));
  try {
    execSync("bun run scripts/gen-assets.ts", { cwd: repoRoot, stdio: "pipe" });
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

// ---- summary ----------------------------------------------------------------
console.log("---");
if (failures.length > 0) {
  console.log(`FAILED: ${failures.length} issue(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("PASS: 全部 skills 自检通过");
