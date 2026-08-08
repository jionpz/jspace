// application/context/gate.test.ts — injection gate rules.
// Run: bun test application/context/gate.test.ts
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorkbenchRoot, gate, promptHasSkipKeyword } from "./gate.ts";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeWorkbench(): string {
  dir = mkdtempSync(join(tmpdir(), "jspace-gate-"));
  mkdirSync(join(dir, ".jspace"), { recursive: true });
  writeFileSync(join(dir, ".jspace", "marker.json"), "{}");
  return dir;
}

test("findWorkbenchRoot: walks up, supports subdirectory launches", () => {
  const wb = makeWorkbench();
  mkdirSync(join(wb, "workspace", "acme"), { recursive: true });
  expect(findWorkbenchRoot(join(wb, "workspace", "acme"))).toBe(wb);
  expect(findWorkbenchRoot(wb)).toBe(wb);
});

test("findWorkbenchRoot: null when no marker anywhere up the tree", () => {
  dir = mkdtempSync(join(tmpdir(), "jspace-nomarker-"));
  expect(findWorkbenchRoot(dir)).toBeNull();
});

test("promptHasSkipKeyword: standalone no-jspace matches, glued words do not", () => {
  expect(promptHasSkipKeyword("no-jspace")).toBe(true);
  expect(promptHasSkipKeyword("this is no-jspace work")).toBe(true);
  expect(promptHasSkipKeyword("NO-JSPACE")).toBe(true); // case-insensitive
  expect(promptHasSkipKeyword("no-jspacefoo")).toBe(false);
  expect(promptHasSkipKeyword("xno-jspace")).toBe(false);
  expect(promptHasSkipKeyword(undefined)).toBe(false);
  expect(promptHasSkipKeyword("")).toBe(false);
});

test("gate: non-workbench dir -> silent no-workbench", () => {
  dir = mkdtempSync(join(tmpdir(), "jspace-plain-"));
  expect(gate("session-start", undefined, dir)).toEqual({ emit: false, reason: "no-workbench" });
  expect(gate("turn", "hi", dir)).toEqual({ emit: false, reason: "no-workbench" });
});

test("gate: workbench -> emit with resolved root (both modes)", () => {
  const wb = makeWorkbench();
  expect(gate("session-start", undefined, wb)).toEqual({ emit: true, root: wb });
  expect(gate("turn", "hi", wb)).toEqual({ emit: true, root: wb });
});

test("gate: turn + no-jspace keyword -> silent skip-keyword", () => {
  const wb = makeWorkbench();
  expect(gate("turn", "别管这个 no-jspace 让我干活", wb)).toEqual({ emit: false, reason: "skip-keyword" });
  // session-start ignores the keyword (only turn has it)
  expect(gate("session-start", "no-jspace", wb)).toEqual({ emit: true, root: wb });
});

test("gate: JSPACE_HOOKS=0 -> silent hooks-disabled", () => {
  const wb = makeWorkbench();
  const prev = process.env.JSPACE_HOOKS;
  process.env.JSPACE_HOOKS = "0";
  try {
    expect(gate("session-start", undefined, wb)).toEqual({ emit: false, reason: "hooks-disabled" });
  } finally {
    if (prev === undefined) delete process.env.JSPACE_HOOKS;
    else process.env.JSPACE_HOOKS = prev;
  }
});

test("gate: *_NON_INTERACTIVE=1 -> silent non-interactive", () => {
  const wb = makeWorkbench();
  const prev = process.env.CLAUDE_NON_INTERACTIVE;
  process.env.CLAUDE_NON_INTERACTIVE = "1";
  try {
    expect(gate("session-start", undefined, wb)).toEqual({ emit: false, reason: "non-interactive" });
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_NON_INTERACTIVE;
    else process.env.CLAUDE_NON_INTERACTIVE = prev;
  }
});
