// cli/commands/skill-scope.test.ts — scope convergence: a workbench skill must
// never be discovered from ~/.agents/skills/. Cleanup may only delete entries
// proven to be official projections (a link into a .jspace/skills SSOT, or a
// byte-identical copy); anything with local content stays.
// Run: bun test cli/commands/skill-scope.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ASSETS } from "../assets.generated.ts";
import { GLOBAL_SKILLS } from "../global-skills.generated.ts";
import { installHandler } from "./skills.ts";
import {
  classifyUserSkill,
  isOfficialCopy,
  isWorkbenchRoot,
  pruneWorkbenchSkillsFromUserLevel,
  staleGlobalSkills,
} from "./skill-scope.ts";

const NAME = "memory-recall";

function fixture(): { root: string; wb: string; other: string; user: string } {
  const root = mkdtempSync(join(tmpdir(), "jspace-skill-scope-"));
  const wb = join(root, "wb");
  const other = join(root, "wb-other");
  const user = join(root, "agents", "skills");
  for (const base of [wb, other]) {
    mkdirSync(join(base, ".jspace", "skills", NAME), { recursive: true });
    writeFileSync(join(base, ".jspace", "marker.json"), "{}");
    writeFileSync(join(base, ".jspace", "skills", NAME, "SKILL.md"), `# ${base}\n`);
  }
  mkdirSync(user, { recursive: true });
  return { root, wb, other, user };
}

/** Materialize the bundled skill byte-for-byte (the Windows copy fallback shape). */
function writeOfficialCopy(dir: string, name: string): void {
  const prefix = `skills/${name}/`;
  for (const [key, body] of Object.entries(ASSETS)) {
    if (!key.startsWith(prefix)) continue;
    const abs = join(dir, key.slice(prefix.length));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

test("workbench marker is required before a directory counts as a skill SSOT", () => {
  const { wb, root } = fixture();
  try {
    expect(isWorkbenchRoot(wb)).toBe(true);
    expect(isWorkbenchRoot(root)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies every user-level shape", () => {
  const { root, wb, other, user } = fixture();
  try {
    const cls = (name: string) => classifyUserSkill(user, wb, name);

    expect(cls("absent-skill")).toBe("absent");

    symlinkSync(join(wb, ".jspace", "skills", NAME), join(user, NAME));
    expect(cls(NAME)).toBe("link-local");

    rmSync(join(user, NAME));
    symlinkSync(join(other, ".jspace", "skills", NAME), join(user, NAME));
    expect(cls(NAME)).toBe("link-foreign");

    rmSync(join(user, NAME));
    symlinkSync(join(root, "gone"), join(user, NAME));
    expect(cls(NAME)).toBe("link-dangling");

    rmSync(join(user, NAME));
    mkdirSync(join(user, NAME));
    expect(cls(NAME)).toBe("user-owned");
    writeOfficialCopy(join(user, NAME), NAME);
    expect(cls(NAME)).toBe("copy-official");

    rmSync(join(user, NAME), { recursive: true, force: true });
    writeFileSync(join(user, NAME), "not a dir");
    expect(cls(NAME)).toBe("user-owned");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a copy passes only when every bundled byte matches", () => {
  const { root, user } = fixture();
  try {
    const dir = join(user, NAME);
    writeOfficialCopy(dir, NAME);
    expect(isOfficialCopy(dir, NAME)).toBe(true);
    writeFileSync(join(dir, "references", "discipline.md"), "edited\n");
    expect(isOfficialCopy(dir, NAME)).toBe(false);
    writeFileSync(join(dir, "references", "discipline.md"), ASSETS[`skills/${NAME}/references/discipline.md`]!);
    writeFileSync(join(dir, "extra.md"), "local note\n");
    expect(isOfficialCopy(dir, NAME)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installHandler prunes only through the injected root", () => {
  // Regression guard: the prune must follow deps.userSkillsRoot(). When it used
  // the module default, a test run with an injected tmp root classified the
  // operator's real ~/.agents/skills entries and deleted them.
  const { root, wb, user } = fixture();
  try {
    symlinkSync(join(wb, ".jspace", "skills", NAME), join(user, NAME));
    const r = installHandler(
      { json: false, dryRun: false, dir: undefined, root: wb, cwd: wb },
      { refresh: false },
      {
        assetKeys: () => [],
        assetContent: () => "",
        userSkillsRoot: () => user,
        exists: (p) => existsSync(p),
        readFile: () => null,
        writeFile: () => {
          throw new Error("must not write: no assets requested");
        },
        dryRun: false,
      },
    );
    expect(r.exitCode).toBeUndefined();
    expect(existsSync(join(user, NAME))).toBe(false);
    expect(r.lines.join("\n")).toContain("removed user-level workbench skill");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staleGlobalSkills: absent is not stale, byte drift is", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-global-stale-"));
  try {
    const user = join(root, "skills");
    mkdirSync(user, { recursive: true });
    const prefix = "skills/harness-config/";
    expect(staleGlobalSkills(user)).toEqual([]); // not installed -> global_missing, not staleness
    for (const [key, body] of Object.entries(GLOBAL_SKILLS)) {
      if (!key.startsWith(prefix)) continue;
      const abs = join(user, "harness-config", key.slice(prefix.length));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    expect(staleGlobalSkills(user)).toEqual([]);
    writeFileSync(join(user, "harness-config", "SKILL.md"), "edited\n");
    expect(staleGlobalSkills(user)).toEqual(["harness-config"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prune removes proofs and preserves user content", () => {
  const { root, wb, other, user } = fixture();
  try {
    // local link
    symlinkSync(join(wb, ".jspace", "skills", NAME), join(user, NAME));
    // foreign link (another workbench's SSOT)
    mkdirSync(join(other, ".jspace", "skills", "asset-ingest"), { recursive: true });
    symlinkSync(join(other, ".jspace", "skills", "asset-ingest"), join(user, "asset-ingest"));
    // official copy
    mkdirSync(join(user, "weekly-report"));
    writeOfficialCopy(join(user, "weekly-report"), "weekly-report");
    // user-owned
    mkdirSync(join(user, "memory-writeback"));
    writeFileSync(join(user, "memory-writeback", "SKILL.md"), "# mine\n");

    const r = pruneWorkbenchSkillsFromUserLevel({
      userRoot: user,
      workbenchRoot: wb,
      names: [NAME, "asset-ingest", "weekly-report", "memory-writeback", "jspace-use"],
    });

    expect(r.removed.map((x) => x.name).sort()).toEqual(["asset-ingest", NAME, "weekly-report"]);
    expect(r.preserved.map((x) => x.name)).toEqual(["memory-writeback"]);
    expect(r.skipped).toEqual([]);

    // dry-run reports the same without deleting
    const again = pruneWorkbenchSkillsFromUserLevel({
      userRoot: user,
      workbenchRoot: wb,
      names: ["memory-writeback"],
      dryRun: true,
    });
    expect(again.removed).toEqual([]);
    expect(again.preserved.map((x) => x.name)).toEqual(["memory-writeback"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
