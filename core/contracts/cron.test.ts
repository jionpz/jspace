// core/contracts/cron.test.ts — pure decode tests for CronDefinition,
// including the optional skill target (Child D). Existing v1 files with
// `prompt` stay valid; target crons use exactly-one-of(prompt, target).
// Run: bun test core/contracts/cron.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeCrons, type CronsFile } from "./cron.ts";

function promptCron(): CronsFile {
  return {
    version: 1,
    crons: [{ id: "weekly-report", schedule: "0 21 * * 0", harness: "claude", prompt: "生成本周周报…", enabled: true }],
  };
}

function targetCron(): CronsFile {
  return {
    version: 1,
    crons: [
      {
        id: "inbox-tidy",
        schedule: "0 21 * * *",
        harness: "claude",
        target: { kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "整理 inbox" },
        enabled: true,
      },
    ],
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeCrons(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("existing v1 prompt crons decode unchanged (backward compatible)", () => {
  const result = decodeCrons(JSON.parse(JSON.stringify(promptCron())));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.crons[0].prompt).toBe("生成本周周报…");
    expect(result.value.crons[0].target).toBeUndefined();
  }
});

test("skill target crons decode with target and no prompt", () => {
  const result = decodeCrons(JSON.parse(JSON.stringify(targetCron())));
  expect(result.ok).toBe(true);
  if (result.ok) {
    const c = result.value.crons[0];
    expect(c.prompt).toBeUndefined();
    expect(c.target).toEqual({ kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "整理 inbox" });
  }
});

test("exactly one of prompt | target is required", () => {
  const neither = { version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", enabled: true }] };
  expectIssue(neither, "cron.entry.prompt_or_target");
  const both = {
    version: 1,
    crons: [
      {
        id: "x",
        schedule: "* * * * *",
        harness: "claude",
        prompt: "p",
        target: { kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "i" },
        enabled: true,
      },
    ],
  };
  expectIssue(both, "cron.entry.prompt_or_target");
});

test("target shape is validated", () => {
  const badKind = { ...targetCron(), crons: [{ ...targetCron().crons[0], target: { ...targetCron().crons[0].target, kind: "prompt" } }] };
  expectIssue(badKind, "cron.target.kind.invalid");
  const badSkill = { ...targetCron(), crons: [{ ...targetCron().crons[0], target: { ...targetCron().crons[0].target, skill: "Bad Skill" } }] };
  expectIssue(badSkill, "cron.target.skill.invalid");
  const noInput = { ...targetCron(), crons: [{ ...targetCron().crons[0], target: { ...targetCron().crons[0].target, input: undefined } }] };
  expectIssue(noInput, "cron.target.input.invalid");
  const unknown = { ...targetCron(), crons: [{ ...targetCron().crons[0], target: { ...targetCron().crons[0].target, extra: 1 } }] };
  expectIssue(unknown, "cron.target.unknown-field");
});

test("non-string prompt is rejected", () => {
  expectIssue({ version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", prompt: 42, enabled: true }] }, "cron.prompt.invalid");
});

test("unknown cron entry fields are rejected (including target-aware)", () => {
  const extra = { version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", prompt: "p", enabled: true, size: 1 }] };
  expectIssue(extra, "cron.entry.unknown-field");
  const also = promptCron() as unknown as Record<string, unknown>;
  (also as { crons: unknown[] }).crons = [{ ...(also as { crons: Record<string, unknown>[] }).crons[0], target: { kind: "skill", skill: "a", entrypoint: "b", input: "c" } }];
  expectIssue(also, "cron.entry.prompt_or_target"); // prompt+target both present
});

test("mixed prompt and target crons decode together", () => {
  const mixed: CronsFile = { version: 1, crons: [...promptCron().crons, ...targetCron().crons] };
  const result = decodeCrons(JSON.parse(JSON.stringify(mixed)));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.crons.map((c) => c.id)).toEqual(["weekly-report", "inbox-tidy"]);
  }
});
