// cli/commands/harness-skills.test.ts — Cursor user-level skill links
// (harness wire --harness cursor). Link failures are errors, never a silent
// exit 0 (issue #8 #9). Temp dirs only — never touches real ~/.cursor or ~/.agents.
// Run: bun test cli/commands/harness-skills.test.ts
import { afterEach, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wireCursorSkillLinks } from "./harness.ts";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tree(): { userRoot: string; cursorRoot: string } {
  dir = mkdtempSync(join(tmpdir(), "jspace-cursor-skills-"));
  const userRoot = join(dir, "agents", "skills");
  const cursorRoot = join(dir, "cursor", "skills");
  mkdirSync(join(userRoot, "jspace-use"), { recursive: true });
  writeFileSync(join(userRoot, "jspace-use", "SKILL.md"), "# jspace-use\n", "utf-8");
  return { userRoot, cursorRoot };
}

test("wireCursorSkillLinks creates a dir symlink to the user-level skill", () => {
  const { userRoot, cursorRoot } = tree();
  const r = wireCursorSkillLinks({
    userRoot,
    cursorRoot,
    skillNames: ["jspace-use"],
    dryRun: false,
    isWin: false,
  });
  expect(r.errors).toHaveLength(0);
  expect(r.lines.some((l) => l.includes("linked"))).toBe(true);
  const link = join(cursorRoot, "jspace-use");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe(join(userRoot, "jspace-use"));
});

test("wireCursorSkillLinks: link failure -> errors (caller sets exit 1)", () => {
  const { userRoot, cursorRoot } = tree();
  mkdirSync(join(cursorRoot, ".."), { recursive: true });
  writeFileSync(cursorRoot, "not-a-directory", "utf-8");
  const r = wireCursorSkillLinks({
    userRoot,
    cursorRoot,
    skillNames: ["jspace-use"],
    dryRun: false,
    isWin: false,
  });
  expect(r.errors.length).toBeGreaterThan(0);
  expect(r.errors[0]).toContain("failed to link");
  expect(r.lines).toHaveLength(0);
});

test("wireCursorSkillLinks dry-run does not create the link", () => {
  const { userRoot, cursorRoot } = tree();
  const r = wireCursorSkillLinks({
    userRoot,
    cursorRoot,
    skillNames: ["jspace-use"],
    dryRun: true,
    isWin: false,
  });
  expect(r.errors).toHaveLength(0);
  expect(r.lines[0]).toContain("(dry-run) would link");
  expect(() => lstatSync(join(cursorRoot, "jspace-use"))).toThrow();
});
