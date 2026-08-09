// adapters/harness/registry.test.ts — capabilities registry contract (single
// source of truth). Decodes the embedded generated module, asserts every
// capability is structurally valid, and pins the derived projection/cron sets.
// Run: bun test adapters/harness/registry.test.ts
import { expect, test } from "bun:test";
import {
  cronHarnessNames,
  getCapability,
  harnessNames,
  loadCapabilities,
  workbenchProjectionDirs,
} from "./registry.ts";
import { getAdapter } from "./index.ts";

test("capabilities file has the full support set (5 session + codex compat)", () => {
  const caps = loadCapabilities();
  expect(harnessNames().sort()).toEqual(["claude", "codex", "cursor", "grok", "opencode", "pi"]);
  expect(caps.schema_version).toBe(1);
  expect(caps.shared_workbench_projection).toContain(".agents/skills");
});

test("every capability is structurally valid", () => {
  const caps = loadCapabilities();
  for (const [key, cap] of Object.entries(caps.harnesses)) {
    // resolved capability carries name = key
    expect(getCapability(key).name).toBe(key);
    // headless-only harnesses never declare a cron enum value (cursor)
    if (cap.headless === null) expect(cap.cron_harness_enum_value).toBeNull();
    else expect(cap.headless.length).toBeGreaterThan(0);
    // lifecycle is fully graded
    expect(cap.lifecycle.session_start).toMatch(/^(automated|best_effort|manual|unsupported)$/);
    expect(cap.lifecycle.session_end).toMatch(/^(automated|best_effort|manual|unsupported)$/);
    expect(cap.lifecycle.fallback).toMatch(/^(automated|best_effort|manual|unsupported)$/);
    expect(cap.lifecycle.crash_recovery).toMatch(/^(automated|best_effort|manual|unsupported)$/);
    // sessions carry a channel source
    for (const s of cap.sessions) expect(["hook", "plugin", "extension"]).toContain(s.source);
  }
});

test("cron harness set excludes cursor (no headless) and matches the contract enum", () => {
  expect(cronHarnessNames().sort()).toEqual(["claude", "codex", "grok", "opencode", "pi"]);
  expect(cronHarnessNames()).not.toContain("cursor");
});

test("workbench projection dirs union per-harness + shared, no duplicates", () => {
  const dirs = workbenchProjectionDirs();
  expect(dirs).toContain(".claude/skills");
  expect(dirs).toContain(".agents/skills");
  expect(dirs).toContain(".grok/skills"); // P2 projection already declared
  expect(dirs).toContain(".opencode/skills"); // P3 projection already declared
  expect(new Set(dirs).size).toBe(dirs.length);
});

test("unknown harness fails loudly through the adapter registry", () => {
  expect(() => getCapability("definitely-not-a-harness")).toThrow(/unsupported harness/);
  expect(() => getAdapter("definitely-not-a-harness")).toThrow(/unsupported harness/);
});

test("every adapter resolves and owns the declared capability", () => {
  for (const name of harnessNames()) {
    const adapter = getAdapter(name);
    expect(adapter.name).toBe(name);
    expect(adapter.capability.name).toBe(name);
  }
});

test("headless-capable harnesses assemble argv through their adapter", () => {
  // spot-check one capability-driven shape end-to-end (registry -> adapter -> argv)
  expect(getAdapter("grok").headlessArgv("x", "darwin", "/bin/grok")).toEqual([
    "/bin/grok",
    "-p",
    "x",
    "--output-format",
    "json",
    "--allow",
    "Bash(*)",
  ]);
});

test("cursor adapter fails on headless argv (IDE-only) but exposes a hook path", () => {
  const cursor = getAdapter("cursor");
  expect(() => cursor.headlessArgv("x", "darwin", "/bin/x")).toThrow(/no headless CLI/);
  expect(cursor.hookFilePath?.("/wb")).toBe("/wb/.cursor/hooks.json");
});
