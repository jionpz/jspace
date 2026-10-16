// adapters/harness/argv.test.ts — headless harness argv shapes.
// These pin the "automated" claim for claude in the lifecycle/argv matrices:
// shapes + permission whitelist must not drift silently.
// Run: bun test adapters/harness/argv.test.ts
import { expect, test } from "bun:test";
import { harnessArgv, resolveHarnessBin } from "./argv.ts";

test("claude headless argv has the permission whitelist and never bypasses", () => {
  const argv = harnessArgv("claude", "整理 inbox", "darwin", "/usr/bin/claude");
  expect(argv).toEqual([
    "/usr/bin/claude",
    "-p",
    "整理 inbox",
    "--output-format",
    "text",
    "--allowedTools",
    "Bash,Read,Write,Edit,mcp__gbrain__*",
  ]);
  expect(argv.some((a) => /bypass/i.test(a))).toBe(false); // unattended: no bypassPermissions
});

test("per-cron tools override replaces the capability default", () => {
  const argv = harnessArgv("claude", "整理 inbox", "darwin", "/usr/bin/claude", "Read,Write,Edit,mcp__gbrain__*");
  expect(argv).toEqual([
    "/usr/bin/claude",
    "-p",
    "整理 inbox",
    "--output-format",
    "text",
    "--allowedTools",
    "Read,Write,Edit,mcp__gbrain__*",
  ]);
  expect(argv.some((a) => /Bash/i.test(a))).toBe(false); // write-only cron: no shell
  const grok = harnessArgv("grok", "do it", "darwin", "/bin/grok", "Read,Write,Edit");
  expect(grok).toContain("--allow");
  expect(grok[grok.length - 1]).toBe("Read,Write,Edit");
});

test("codex and pi headless argv shapes are stable", () => {
  expect(harnessArgv("codex", "do it", "darwin", "/bin/codex")).toEqual(["/bin/codex", "exec", "do it"]);
  expect(harnessArgv("pi", "do it", "darwin", "/bin/pi")).toEqual(["/bin/pi", "-p", "do it"]);
});

// ---- per-cron model: unattended runs must not inherit the interactive default
// (2026-10-13: a rate-limited user-level model made `claude -p` hang until the
// run was killed; all five crons failed nightly). ----

test("per-cron model appends the capability's model flag after permission", () => {
  const argv = harnessArgv("claude", "整理 inbox", "darwin", "/usr/bin/claude", undefined, "acme/turbo-4.1-flash");
  expect(argv).toEqual([
    "/usr/bin/claude",
    "-p",
    "整理 inbox",
    "--output-format",
    "text",
    "--allowedTools",
    "Bash,Read,Write,Edit,mcp__gbrain__*",
    "--model",
    "acme/turbo-4.1-flash",
  ]);
});

test("model flag is per-harness (codex -m, opencode/pi --model)", () => {
  expect(harnessArgv("codex", "do it", "darwin", "/bin/codex", undefined, "gpt-5")).toEqual(["/bin/codex", "exec", "do it", "-m", "gpt-5"]);
  expect(harnessArgv("opencode", "do it", "darwin", "/bin/opencode", undefined, "p/m")).toEqual(["/bin/opencode", "run", "--auto", "do it", "--model", "p/m"]);
  expect(harnessArgv("pi", "do it", "darwin", "/bin/pi", undefined, "p/m")).toEqual(["/bin/pi", "-p", "do it", "--model", "p/m"]);
});

test("absent model leaves the argv byte-identical to before (no empty flag)", () => {
  // Regression guard: materializing an empty --model would break every cron
  // that does not pin a model.
  const argv = harnessArgv("claude", "p", "darwin", "/usr/bin/claude");
  expect(argv).not.toContain("--model");
  expect(argv).toEqual(["/usr/bin/claude", "-p", "p", "--output-format", "text", "--allowedTools", "Bash,Read,Write,Edit,mcp__gbrain__*"]);
});

test("grok headless argv shape (capability-driven flags)", () => {
  expect(harnessArgv("grok", "do it", "darwin", "/bin/grok")).toEqual([
    "/bin/grok",
    "-p",
    "do it",
    "--output-format",
    "json",
    "--allow",
    "Bash(*)",
  ]);
});

test("opencode headless argv auto-approves tools only for cron", () => {
  expect(harnessArgv("opencode", "do it", "darwin", "/bin/opencode")).toEqual([
    "/bin/opencode",
    "run",
    "--auto",
    "do it",
  ]);
});

test("cursor is a session harness with no headless CLI", () => {
  expect(() => harnessArgv("cursor", "p", "darwin", "/bin/x")).toThrow(/no headless CLI/);
});

test("unsupported harness fails loudly", () => {
  expect(() => harnessArgv("definitely-not-a-harness", "p", "darwin", "/bin/x")).toThrow(/unsupported harness/);
});

test("binary resolution falls back to the bare harness name when not on PATH", () => {
  const resolved = resolveHarnessBin("definitely-not-a-real-harness", "darwin");
  expect(resolved).toBe("definitely-not-a-real-harness");
});
