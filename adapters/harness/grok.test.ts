// adapters/harness/grok.test.ts — Grok Build adapter contract: the capability-
// driven headless argv + the hook file path. The hook JSON *content* is a
// template asset materialized by init (verified in the workbench template
// regression); this test pins the adapter's declared shape.
// Run: bun test adapters/harness/grok.test.ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { getAdapter } from "./index.ts";
import { getCapability } from "./registry.ts";

const grokAdapter = getAdapter("grok");

test("grok capability declares the four wired session events", () => {
  const cap = getCapability("grok");
  expect(cap.sessions.map((s) => s.name)).toEqual(["SessionStart", "UserPromptSubmit", "PreCompact", "SessionEnd"]);
  // every wired event is a hook-channel event (no plugin/extension)
  expect(cap.sessions.every((s) => s.source === "hook")).toBe(true);
  expect(cap.hook_format).toBe("grok_hooks_json");
  expect(cap.native_memory).toBe("full"); // native memory exists but gbrain stays authoritative (bridge keeps gbrain authoritative)
});

test("grok headless argv shape", () => {
  expect(grokAdapter.headlessArgv("整理 inbox", "darwin", "/usr/bin/grok")).toEqual([
    "/usr/bin/grok",
    "-p",
    "整理 inbox",
    "--output-format",
    "json",
    "--allow",
    "Bash(*)",
  ]);
});

test("grok hook file path is .grok/hooks/jspace.json", () => {
  expect(grokAdapter.hookFilePath?.("/wb")).toBe(join("/wb", ".grok/hooks/jspace.json"));
});
