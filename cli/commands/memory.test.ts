import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CmdContext } from "../../application/commands/command.ts";
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";
import { memoryCheckCommand, memoryPeriodCommand } from "./memory.ts";

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function ctx(json: boolean): CmdContext {
  root = mkdtempSync(join(tmpdir(), "jspace-memory-cli-"));
  return { root, cwd: root, dir: root, json, dryRun: false };
}

function emptyGbrain(): GbrainDeps {
  return {
    getPage: async () => ({ ok: false, code: "not_found", message: "missing" }),
    listPages: async () => ({ ok: true, rows: [] }),
    putPage: async () => ({ ok: false, code: "process_error", message: "read-only" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "unused" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

test("memoryCheckCommand returns structured JSON and exits zero on an empty complete audit", async () => {
  const result = await memoryCheckCommand(ctx(true), {
    gbrain: emptyGbrain,
    filehubRoot: () => null,
  });
  expect(result.exitCode).toBeUndefined();
  expect(result.data).toMatchObject({
    schema_version: 1,
    status: "ok",
    coverage: {
      pages: { state: "complete", owned_pages: 0 },
      backlinks: { state: "not_applicable" },
      filehub: { state: "not_applicable" },
    },
  });
});

test("memoryCheckCommand returns human output and exit 1 for partial coverage", async () => {
  const result = await memoryCheckCommand(ctx(false), {
    gbrain: () => ({
      ...emptyGbrain(),
      listPages: async () => ({ ok: false, code: "timeout", message: "timed out" }),
    }),
    filehubRoot: () => null,
  });
  expect(result.exitCode).toBe(1);
  expect(result.lines?.join("\n")).toContain("memory check: partial");
  expect(result.lines?.join("\n")).toContain("memory.pages.partial");
  expect(result.lines?.join("\n")).toContain("read-only");
});

test("memoryCheckCommand resolves asset files through the injected filehub root", async () => {
  const c = ctx(false);
  mkdirSync(join(c.root, "projects", "acme"), { recursive: true });
  writeFileSync(join(c.root, "projects", "acme", "report.md"), "report\n");
  const content = `---
type: note
source: codex
project: acme
rel_path: projects/acme/report.md
tags: [asset, source:session]
---
# Report
`;
  const result = await memoryCheckCommand(c, {
    gbrain: () => ({
      ...emptyGbrain(),
      listPages: async () => ({
        ok: true,
        rows: [{ slug: "assets/acme/report", updatedAt: "2026-10-18T12:00:00Z" }],
      }),
      getPage: async (slug) => ({
        ok: true,
        page: {
          slug,
          revision: "revision-1",
          contentHash: "hash",
          content,
          tags: ["asset", "source:session"],
        },
      }),
    }),
    filehubRoot: (r) => r,
  });
  expect(result.exitCode).toBeUndefined();
  expect(result.lines?.join("\n")).toContain("filehub: complete");
});

test("memoryPeriodCommand returns the current local Monday window as structured data", async () => {
  const result = await memoryPeriodCommand(
    ctx(true),
    { timezone: "Asia/Shanghai" },
    { now: () => new Date("2026-10-19T10:00:00Z") },
  );
  expect(result.exitCode).toBeUndefined();
  expect(result.data).toMatchObject({
    schema_version: 1,
    timezone: "Asia/Shanghai",
    week_start: "2026-10-19",
    week_end_exclusive: "2026-10-26",
    observed_through: "2026-10-19T18:00:00+08:00",
    status: "in_progress",
    is_current_week: true,
  });
  expect(result.lines).toEqual([]);
});

test("memoryPeriodCommand supports a completed backfill week and human output", async () => {
  const result = await memoryPeriodCommand(ctx(false), {
    timezone: "Asia/Shanghai",
    week: "2026-10-05",
    now: "2026-10-19T10:00:00Z",
  });
  const text = result.lines?.join("\n") ?? "";
  expect(result.exitCode).toBeUndefined();
  expect(text).toContain("week_start: 2026-10-05");
  expect(text).toContain("week_end_exclusive: 2026-10-12");
  expect(text).toContain("observed_through: 2026-10-12T00:00:00+08:00");
  expect(text).toContain("status: complete");
});

test("memoryPeriodCommand rejects non-Monday targets and invalid timezones as argument errors", async () => {
  const c = ctx(true);
  const tuesday = await memoryPeriodCommand(c, {
    timezone: "Asia/Shanghai",
    week: "2026-10-20",
    now: "2026-10-19T10:00:00Z",
  });
  expect(tuesday.exitCode).toBe(2);
  expect(tuesday.errors?.join("\n")).toContain("Monday");

  const timezone = await memoryPeriodCommand(c, {
    timezone: "Mars/Olympus",
    now: "2026-10-19T10:00:00Z",
  });
  expect(timezone.exitCode).toBe(2);
  expect(timezone.errors?.join("\n")).toContain("memory period");
});
