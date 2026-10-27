// core/contracts/cron.test.ts — pure decode tests for CronDefinition,
// including the optional skill target (the skill-target cron feature). Existing v1 files with
// `prompt` stay valid; target crons use exactly-one-of(prompt, target).
// Run: bun test core/contracts/cron.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeCrons, type CronsFile } from "./cron.ts";

const TEST_HARNESSES = ["claude", "codex", "grok", "opencode", "pi"] as const;
const decode = (input: unknown) => decodeCrons(input, TEST_HARNESSES);

function promptCron(): CronsFile {
  return {
    schema_version: 1,
    crons: [{ id: "weekly-report", schedule: "0 21 * * 0", harness: "claude", prompt: "生成本周周报…", enabled: true }],
  };
}

function targetCron(): CronsFile {
  return {
    schema_version: 1,
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
  const result = decode(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("existing v1 prompt crons decode unchanged (backward compatible)", () => {
  const result = decode(JSON.parse(JSON.stringify(promptCron())));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.crons[0].prompt).toBe("生成本周周报…");
    expect(result.value.crons[0].target).toBeUndefined();
  }
});

test("skill target crons decode with target and no prompt", () => {
  const result = decode(JSON.parse(JSON.stringify(targetCron())));
  expect(result.ok).toBe(true);
  if (result.ok) {
    const c = result.value.crons[0];
    expect(c.prompt).toBeUndefined();
    expect(c.target).toEqual({ kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "整理 inbox" });
  }
});

test("optional per-cron tools override decodes (write-only crons drop Bash)", () => {
  const input = {
    schema_version: 1,
    crons: [
      { id: "weekly-report", schedule: "0 21 * * 0", harness: "claude", tools: "Read,Write,Edit,mcp__gbrain__*", target: { kind: "skill", skill: "weekly-report", entrypoint: "weekly", input: "周报" }, enabled: true },
    ],
  };
  const result = decode(input);
  expect(result.ok).toBe(true);
  if (result.ok) {
    const c = result.value.crons[0];
    expect(c.tools).toBe("Read,Write,Edit,mcp__gbrain__*");
  }
});

test("non-string tools is rejected", () => {
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", tools: 42, prompt: "p", enabled: true }] }, "cron.tools.invalid");
});

test("optional per-cron model decodes; absent stays undefined (interactive default untouched)", () => {
  const withModel = decode({
    schema_version: 1,
    crons: [
      { id: "weekly-report", schedule: "0 21 * * 0", harness: "claude", model: "acme/turbo-4.1-flash", prompt: "p", enabled: true },
    ],
  });
  expect(withModel.ok).toBe(true);
  if (withModel.ok) expect(withModel.value.crons[0].model).toBe("acme/turbo-4.1-flash");

  // Absent must NOT materialize an empty string — an absent model is the signal
  // to fall through to the harness's own resolution.
  const without = decode({ schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", enabled: true }] });
  expect(without.ok).toBe(true);
  if (without.ok) expect(without.value.crons[0].model).toBeUndefined();
});

test("non-string / empty model is rejected", () => {
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", model: 42, prompt: "p", enabled: true }] }, "cron.model.invalid");
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", model: "   ", prompt: "p", enabled: true }] }, "cron.model.invalid");
});

test("per-cron timeoutSec decodes; absent stays undefined (pre-field bytes untouched)", () => {
  const withTimeout = decode({
    schema_version: 1,
    crons: [{ id: "server-status", schedule: "0 9 * * *", harness: "claude", prompt: "p", timeoutSec: 3600, enabled: true }],
  });
  expect(withTimeout.ok).toBe(true);
  if (withTimeout.ok) expect(withTimeout.value.crons[0].timeoutSec).toBe(3600);
  // Absent must stay absent, not default to 1800: the decoder's job is to report
  // what the file says. Defaulting here would bake 1800 into every entry's
  // installed argv and rewrite every schedule on the next install.
  const without = decode({
    schema_version: 1,
    crons: [{ id: "server-status", schedule: "0 9 * * *", harness: "claude", prompt: "p", enabled: true }],
  });
  expect(without.ok).toBe(true);
  if (without.ok) expect(without.value.crons[0].timeoutSec).toBeUndefined();
});

test("timeoutSec must be a positive integer (0 / negative / float / string rejected)", () => {
  const withTimeout = (timeoutSec: unknown) => ({
    schema_version: 1,
    crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", timeoutSec, enabled: true }],
  });
  expectIssue(withTimeout(0), "cron.timeoutSec.invalid");
  expectIssue(withTimeout(-60), "cron.timeoutSec.invalid");
  expectIssue(withTimeout(1.5), "cron.timeoutSec.invalid");
  expectIssue(withTimeout("3600"), "cron.timeoutSec.invalid");
  expectIssue(withTimeout(Number.NaN), "cron.timeoutSec.invalid");
});

test("per-cron stallSec decodes; 0 disables and absent stays undefined", () => {
  const withStall = (stallSec: unknown) => ({
    schema_version: 1,
    crons: [{ id: "weekly", schedule: "0 9 * * *", harness: "claude", prompt: "p", stallSec, enabled: true }],
  });
  const on = decode(withStall(600));
  expect(on.ok).toBe(true);
  if (on.ok) expect(on.value.crons[0].stallSec).toBe(600);

  const off = decode(withStall(0));
  expect(off.ok).toBe(true);
  if (off.ok) expect(off.value.crons[0].stallSec).toBe(0);

  const absent = decode({ schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", enabled: true }] });
  expect(absent.ok).toBe(true);
  if (absent.ok) expect(absent.value.crons[0].stallSec).toBeUndefined();
});

test("stallSec must be a non-negative integer (-1 / float / string rejected)", () => {
  const withStall = (stallSec: unknown) => ({
    schema_version: 1,
    crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", stallSec, enabled: true }],
  });
  expectIssue(withStall(-1), "cron.stallSec.invalid");
  expectIssue(withStall(1.5), "cron.stallSec.invalid");
  expectIssue(withStall("600"), "cron.stallSec.invalid");
  expectIssue(withStall(Number.NaN), "cron.stallSec.invalid");
});

test("per-cron preventSleep decodes; absent stays undefined (caller defaults to on)", () => {
  const withGuard = (preventSleep: unknown) => ({
    schema_version: 1,
    crons: [{ id: "weekly", schedule: "0 9 * * *", harness: "claude", prompt: "p", preventSleep, enabled: true }],
  });
  const off = decode(withGuard(false));
  expect(off.ok).toBe(true);
  if (off.ok) expect(off.value.crons[0].preventSleep).toBe(false);

  const on = decode(withGuard(true));
  expect(on.ok).toBe(true);
  if (on.ok) expect(on.value.crons[0].preventSleep).toBe(true);

  // Absent must stay absent (not coerced to true at decode): the on-by-default
  // decision belongs to the executor, so an existing cron.json keeps decoding
  // to the exact same object it decoded to before this field existed.
  const absent = decode({ schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", enabled: true }] });
  expect(absent.ok).toBe(true);
  if (absent.ok) expect(absent.value.crons[0].preventSleep).toBeUndefined();
});

test("preventSleep must be a real boolean (a string \"false\" must not read as true)", () => {
  const withGuard = (preventSleep: unknown) => ({
    schema_version: 1,
    crons: [{ id: "x", schedule: "0 9 * * *", harness: "claude", prompt: "p", preventSleep, enabled: true }],
  });
  expectIssue(withGuard("false"), "cron.preventSleep.invalid");
  expectIssue(withGuard(0), "cron.preventSleep.invalid");
});

test("exactly one of prompt | target is required", () => {
  const neither = { schema_version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", enabled: true }] };
  expectIssue(neither, "cron.entry.prompt_or_target");
  const both = {
    schema_version: 1,
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
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", prompt: 42, enabled: true }] }, "cron.prompt.invalid");
});

test("unknown cron entry fields are rejected (including target-aware)", () => {
  const extra = { schema_version: 1, crons: [{ id: "x", schedule: "* * * * *", harness: "claude", prompt: "p", enabled: true, size: 1 }] };
  expectIssue(extra, "cron.entry.unknown-field");
  const also = promptCron() as unknown as Record<string, unknown>;
  (also as { crons: unknown[] }).crons = [{ ...(also as { crons: Record<string, unknown>[] }).crons[0], target: { kind: "skill", skill: "a", entrypoint: "b", input: "c" } }];
  expectIssue(also, "cron.entry.prompt_or_target"); // prompt+target both present
});

test("mixed prompt and target crons decode together", () => {
  const mixed: CronsFile = { schema_version: 1, crons: [...promptCron().crons, ...targetCron().crons] };
  const result = decode(JSON.parse(JSON.stringify(mixed)));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.crons.map((c) => c.id)).toEqual(["weekly-report", "inbox-tidy"]);
  }
});

test("invalid schedule is rejected at decode time (P2-5; no longer deferred to cronAdd)", () => {
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "*/5 * * * *", harness: "claude", prompt: "p", enabled: true }] }, "cron.schedule.invalid");
  expectIssue({ schema_version: 1, crons: [{ id: "x", schedule: "not a cron", harness: "claude", prompt: "p", enabled: true }] }, "cron.schedule.invalid");
});

test("valid schedule still decodes (no false cron.schedule.invalid)", () => {
  const result = decode(JSON.parse(JSON.stringify(promptCron())));
  expect(result.ok).toBe(true);
});

test("headless-capable harness enum accepts grok/opencode/pi, rejects cursor", () => {
  for (const harness of ["grok", "opencode", "pi"]) {
    const input = { schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness, prompt: "p", enabled: true }] };
    expect(decode(input).ok).toBe(true);
  }
  // cursor is an IDE-only session harness (no headless CLI) -> never a cron harness
  expectIssue(
    { schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "cursor", prompt: "p", enabled: true }] },
    "cron.harness.invalid",
  );
  expectIssue(
    { schema_version: 1, crons: [{ id: "x", schedule: "0 9 * * *", harness: "bogus", prompt: "p", enabled: true }] },
    "cron.harness.invalid",
  );
});
