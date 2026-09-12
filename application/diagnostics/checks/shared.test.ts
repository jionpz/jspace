// application/diagnostics/checks/shared.test.ts — the bounded-walk primitives
// behind the large-filehub scaling fix (short-circuit + entry budget).
// Run: bun test application/diagnostics/checks/shared.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastActivityMs, newActivityScanBudget } from "./shared.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-scan-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const OLD = new Date("2025-01-01T00:00:00Z");
const NEW = new Date();
const DAY = 86_400_000;

function write(rel: string, when: Date): string {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "x");
  utimesSync(p, when, when);
  return p;
}

test("lastActivityMs returns the newest mtime in the tree, 0 when empty/missing", () => {
  expect(lastActivityMs(join(root, "nope"))).toBe(0);
  mkdirSync(join(root, "empty"), { recursive: true });
  expect(lastActivityMs(join(root, "empty"))).toBe(0);
  write("deep/a.md", OLD);
  write("deep/sub/b.md", OLD);
  const newest = write("deep/sub/c.md", NEW);
  expect(lastActivityMs(root)).toBe(statSync(newest).mtimeMs);
});

test("stopWhenNewerThan answers 'touched since?' without a full walk", () => {
  write("a.md", OLD);
  write("sub/b.md", OLD);
  const recent = write("sub/c.md", NEW);
  const cutoff = Date.now() - DAY;
  // anything at all newer than the cutoff satisfies the only question callers ask
  const seen = lastActivityMs(root, { stopWhenNewerThan: cutoff });
  expect(seen).toBeGreaterThan(cutoff);
  expect(seen).toBe(statSync(recent).mtimeMs);
  // a tree that is entirely older reports the true (old) max — no false positive
  write("ancient/x.md", OLD);
  expect(lastActivityMs(join(root, "ancient"), { stopWhenNewerThan: cutoff })).toBeLessThan(cutoff);
});

test("the shared budget bounds the walk and records that it was truncated", () => {
  for (let i = 0; i < 30; i++) write(`f${i}.md`, OLD);
  const budget = newActivityScanBudget(10);
  lastActivityMs(root, { budget });
  expect(budget.truncated).toBe(true);
  expect(budget.remaining).toBe(0);
});

test("a walk that finishes inside its budget is never reported as truncated", () => {
  for (let i = 0; i < 30; i++) write(`f${i}.md`, OLD);
  const budget = newActivityScanBudget(1000);
  const newest = lastActivityMs(root, { budget });
  expect(budget.truncated).toBe(false);
  expect(newest).toBeGreaterThan(0); // a real answer, not a lower bound
});

test("a walk that exits on the cutoff is not truncated — it has its answer", () => {
  const recent = write("a.md", NEW);
  for (let i = 0; i < 30; i++) write(`sub/old${i}.md`, OLD);
  const budget = newActivityScanBudget(1000);
  expect(lastActivityMs(root, { stopWhenNewerThan: Date.now() - DAY, budget })).toBe(statSync(recent).mtimeMs);
  expect(budget.truncated).toBe(false);
});
