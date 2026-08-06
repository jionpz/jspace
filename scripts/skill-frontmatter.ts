// scripts/skill-frontmatter.ts — parse SKILL.md frontmatter (name/description/triggers)
// and render the two generated blocks in templates/workbench/AGENTS.md.
//
// Single source of truth for skill routing: SKILL.md frontmatter. gen-assets
// calls renderAgentsBlocks() to regenerate:
//   - "Brain operations" resolver rows  <- frontmatter `triggers`
//   - "Skill Governance" skill list     <- frontmatter `name` + `description`
// Markers (TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV) delimit the generated regions;
// everything outside is hand-written prose preserved verbatim.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers: string[];
}

const BRAIN_BEGIN = "<!-- TRELLIS-BRAIN-OPS:BEGIN -->";
const BRAIN_END = "<!-- TRELLIS-BRAIN-OPS:END -->";
const GOV_BEGIN = "<!-- TRELLIS-SKILL-GOV:BEGIN -->";
const GOV_END = "<!-- TRELLIS-SKILL-GOV:END -->";

/**
 * Parse the frontmatter block between the two leading `---` fences.
 * Only name / description / triggers are consumed (the fields gen-assets needs);
 * all other keys are ignored. Returns null when the file has no frontmatter.
 */
export function parseSkillFrontmatter(raw: string): SkillFrontmatter | null {
  // Normalize CRLF checkouts (Windows git autocrlf) before parsing — frontmatter
  // fences must be recognized identically on every platform, not just LF.
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const fm = text.slice(4, end);
  let name = "";
  let description = "";
  const triggers: string[] = [];
  let inTriggers = false;
  for (const line of fm.split("\n")) {
    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim();
    } else if (line.startsWith("description:")) {
      const v = line.slice("description:".length).trim();
      // Unquote a single-line `"..."` value; no multi-line descriptions.
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
        description = v.slice(1, -1);
      } else {
        description = v;
      }
    } else if (line.startsWith("triggers:")) {
      inTriggers = true;
    } else if (inTriggers) {
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) {
        let v = m[1].trim();
        if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
        triggers.push(v);
      } else {
        inTriggers = false; // block ended (e.g. next top-level key)
      }
    }
  }
  return { name, description, triggers };
}

function renderBrainRows(skills: SkillFrontmatter[]): string {
  return skills
    .filter((s) => s.triggers.length > 0)
    .map((s) => `- **${s.name}**: ${s.triggers.join(" | ")}`)
    .join("\n");
}

function renderGovRows(skills: SkillFrontmatter[]): string {
  return skills
    .map((s) => `- \`${s.name}\` - ${s.description}`)
    .join("\n");
}

/** Replace the content between begin/end markers (inclusive of the marker lines). */
function replaceBlock(content: string, begin: string, end: string, body: string): string {
  const startIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker pair not found in templates/workbench/AGENTS.md (${begin})`);
  }
  return `${content.slice(0, startIdx)}${begin}\n${body}\n${end}${content.slice(endIdx + end.length)}`;
}

/**
 * Single-source-of-truth guard for skill names (D3). Each workbench skill's
 * SKILL.md frontmatter `name` must equal its skills-manifest.json entry name;
 * drift between the two (packing key vs rendered name) is a generation-time
 * error, never a silent bundle split. gen-assets calls this through
 * renderAgentsBlocks; check-skills (C3) reuses it so the invariant is enforced
 * both on regenerate and on demand.
 */
export function readWorkbenchSkills(repoRoot: string, skillNames: string[]): SkillFrontmatter[] {
  const skills: SkillFrontmatter[] = [];
  for (const name of skillNames) {
    const raw = readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
    const fm = parseSkillFrontmatter(raw);
    if (!fm) throw new Error(`skills/${name}/SKILL.md has no frontmatter`);
    if (fm.name !== name) {
      throw new Error(
        `skills/${name}/SKILL.md frontmatter name "${fm.name}" does not match skills-manifest.json name "${name}"`,
      );
    }
    if (!fm.name || !fm.description) {
      throw new Error(`skills/${name}/SKILL.md frontmatter missing name/description`);
    }
    skills.push(fm);
  }
  return skills;
}

/**
 * Render the two generated blocks of templates/workbench/AGENTS.md from each
 * workbench skill's SKILL.md frontmatter and write the result back to disk.
 * Returns the rendered AGENTS.md content (caller embeds the same bytes).
 */
export function renderAgentsBlocks(repoRoot: string, skillNames: string[]): string {
  const skills = readWorkbenchSkills(repoRoot, skillNames);
  const agentsPath = join(repoRoot, "templates", "workbench", "AGENTS.md");
  const agents = readFileSync(agentsPath, "utf-8");
  let rendered = agents;
  rendered = replaceBlock(rendered, BRAIN_BEGIN, BRAIN_END, renderBrainRows(skills));
  rendered = replaceBlock(rendered, GOV_BEGIN, GOV_END, renderGovRows(skills));
  writeFileSync(agentsPath, rendered, "utf-8");
  return rendered;
}
