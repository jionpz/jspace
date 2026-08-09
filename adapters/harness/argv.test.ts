// adapters/harness/argv.test.ts — headless harness argv shapes (Child D M7).
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

test("codex and pi headless argv shapes are stable", () => {
  expect(harnessArgv("codex", "do it", "darwin", "/bin/codex")).toEqual(["/bin/codex", "exec", "do it"]);
  expect(harnessArgv("pi", "do it", "darwin", "/bin/pi")).toEqual(["/bin/pi", "-p", "do it"]);
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

test("opencode headless argv is positional (opencode run <prompt>)", () => {
  expect(harnessArgv("opencode", "do it", "darwin", "/bin/opencode")).toEqual(["/bin/opencode", "do it"]);
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
