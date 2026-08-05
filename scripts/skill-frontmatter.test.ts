// scripts/skill-frontmatter.test.ts — frontmatter parsing regression tests.
// The Windows CI gen-assets failure (CRLF checkout -> "no frontmatter") pinned
// the requirement that parsing be line-ending agnostic.
// Run: bun test scripts/skill-frontmatter.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFrontmatter } from "./skill-frontmatter.ts";

const ROOT = join(import.meta.dir, "..");
const SKILL = join(ROOT, "skills", "jspace-bootstrap", "SKILL.md");

test("parseSkillFrontmatter parses a real SKILL.md (LF)", () => {
  const fm = parseSkillFrontmatter(readFileSync(SKILL, "utf-8"));
  expect(fm?.name).toBe("jspace-bootstrap");
  expect(fm?.description.length).toBeGreaterThan(0);
  expect(fm?.triggers.length).toBeGreaterThan(0);
});

test("parseSkillFrontmatter is CRLF-tolerant (Windows autocrlf checkout)", () => {
  const lf = readFileSync(SKILL, "utf-8");
  const crlf = lf.replace(/\n/g, "\r\n");
  const fm = parseSkillFrontmatter(crlf);
  expect(fm).not.toBeNull(); // was the Windows CI failure
  expect(fm?.name).toBe("jspace-bootstrap");
  expect(fm?.triggers.length).toBeGreaterThan(0);
});
