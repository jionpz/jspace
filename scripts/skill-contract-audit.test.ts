import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REQUIRED_SKILL_SECTIONS,
  auditSkillDoc,
  auditWeeklyCronConfig,
} from "./skill-contract-audit.ts";

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "jspace-skill-audit-"));
  mkdirSync(join(root, "skills", "jspace-use", "references"), { recursive: true });
  writeFileSync(join(root, "skills", "jspace-use", "references", "gbrain.md"), "# contract\n");
  return root;
}

function validEntrypoint(): string {
  return `---
name: test
---
# Test
${REQUIRED_SKILL_SECTIONS.join("\n")}

Use \`gbrain call get_page '{"slug":"x","include_content":true}'\`.
Use \`jspace cron failures\`.
Use \`.jspace/state/pending/<id>.APPLY.json\`.
New page body contains \`Supersedes: [[old]]\`; read old-page backlinks and inspect each candidate.
\`type\` is descriptive; route by slug + tags.
Use the local Monday window and \`observed_through\`.
`;
}

describe("skill reference integrity", () => {
  test("checks every reference on a line, not only the first", () => {
    const root = fixtureRoot();
    try {
      const result = auditSkillDoc(
        "skills/jspace-use/SKILL.md",
        validEntrypoint().replace(
          "Use `gbrain call",
          "See `~/.agents/skills/jspace-use/references/gbrain.md` and `~/.agents/skills/missing/references/nope.md`. Use `gbrain call",
        ),
        { repoRoot: root },
      );
      expect(result.checkedReferences).toBe(2);
      expect(result.failures).toContainEqual(expect.stringContaining("skills/missing/references/nope.md"));
      expect(result.failures.some((failure) => failure.includes("jspace-use/references/gbrain.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects all stale relative references on one line", () => {
    const result = auditSkillDoc(
      "skills/jspace-use/references/example.md",
      "`references/gbrain.md` and `../memory-recall/references/discipline.md`\n",
      { repoRoot: "/repo", exists: () => true },
    );
    expect(result.checkedReferences).toBe(2);
    expect(result.failures.filter((failure) => failure.includes("stale relative reference"))).toHaveLength(2);
  });
});

describe("legacy contract guards", () => {
  test("accepts the current structured contract", () => {
    const result = auditSkillDoc("skills/jspace-use/SKILL.md", validEntrypoint(), {
      repoRoot: "/repo",
      exists: () => true,
    });
    expect(result.failures).toEqual([]);
  });

  test("rejects old command, alias, pending root and type routing", () => {
    const body = validEntrypoint()
      .replace("Use `gbrain call get_page", "Use `gbrain get x`; `gbrain put y`; `gbrain list --tag x`; `gbrain tags y`. Then `gbrain call get_page")
      .replace("Use `jspace cron failures`.", "Use `jspace cron check` and `jspace gbrain wire`.")
      .replace(".jspace/state/pending/<id>.APPLY.json", "<filehub>/.jspace-logs/123.APPLY.json")
      .replace("`type` is descriptive; route by slug + tags.", "`type` 必须统一 `note`；按 type 判断角色。");
    const result = auditSkillDoc("skills/jspace-use/SKILL.md", body, {
      repoRoot: "/repo",
      exists: () => true,
    });
    const text = result.failures.join("\n");
    expect(text).toContain("old gbrain text command");
    expect(text).toContain("retired cron check alias");
    expect(text).toContain("removed gbrain wire alias");
    expect(text).toContain("old pending root");
    expect(text).toContain("type used as routing");
  });

  test("allows an explicitly labelled legacy pending path in adoption docs", () => {
    const result = auditSkillDoc(
      "skills/jspace-adopt/references/apply-and-verify.md",
      "迁移前识别旧根 `<filehub>/.jspace-logs/123.APPLY.json`，迁移到 `.jspace/state/pending/`。\n",
      { repoRoot: "/repo", exists: () => true },
    );
    expect(result.failures).toEqual([]);
  });

  test("rejects reversed Supersedes and runtime-day period identity", () => {
    const body = validEntrypoint()
      .replace("New page body contains `Supersedes: [[old]]`; read old-page backlinks and inspect each candidate.", "从旧页读取 `Supersedes` 并跟随。")
      .replace(
        "Use the local Monday window and `observed_through`.",
        "用运行日作为周期 id。\n```python\ndatetime.now(tz) - timedelta(days=now.weekday())\n```",
      );
    const result = auditSkillDoc("skills/memory-recall/SKILL.md", body, {
      repoRoot: "/repo",
      exists: () => true,
    });
    const text = result.failures.join("\n");
    expect(text).toContain("reversed Supersedes direction");
    expect(text).toContain("runtime date used as period identity");
    expect(text).toContain("duplicated local clock math");
  });

  test("allows old-page backlinks whose candidates declare Supersedes", () => {
    const result = auditSkillDoc(
      "skills/memory-recall/SKILL.md",
      validEntrypoint().replace(
        "New page body contains `Supersedes: [[old]]`; read old-page backlinks and inspect each candidate.",
        "从旧页调用 `get_backlinks`，分页读完；逐个 `get_page` 候选，只接受正文含 `Supersedes: [[old]]` 的页。",
      ),
      { repoRoot: "/repo", exists: () => true },
    );
    expect(result.failures).toEqual([]);
  });

  test("requires every unified entrypoint section", () => {
    const body = validEntrypoint().replace("## 完成证据\n", "");
    const result = auditSkillDoc("skills/weekly-report/SKILL.md", body, {
      repoRoot: "/repo",
      exists: () => true,
    });
    expect(result.failures).toContainEqual(expect.stringContaining("## 完成证据"));
  });
});

describe("weekly cron contract", () => {
  test("requires Bash and an explicit local-Monday/observed_through input", () => {
    const failures = auditWeeklyCronConfig([
      {
        id: "weekly-report",
        tools: "Read,Write",
        target: { kind: "skill", input: "生成本周周报" },
      },
      {
        id: "memory-consolidate",
        tools: "Bash,Read,Write",
        target: {
          kind: "skill",
          input: "先跑 jspace memory period --json；按本地周一窗口执行并记录 observed_through",
        },
      },
    ]);
    expect(failures).toContainEqual(expect.stringContaining("weekly-report tools must include Bash"));
    expect(failures).toContainEqual(expect.stringContaining("weekly-report input must state"));
    expect(failures.some((failure) => failure.includes("memory-consolidate"))).toBe(false);
  });

  test("requires the canonical period command in weekly cron inputs", () => {
    const failures = auditWeeklyCronConfig([
      {
        id: "workbench-retro",
        tools: "Bash,Read,Write",
        target: { kind: "skill", input: "按本地周一窗口取证并记录 observed_through" },
      },
    ]);
    expect(failures).toContainEqual(expect.stringContaining("recalculating the week"));
  });
});
