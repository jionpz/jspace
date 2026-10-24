import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CmdContext } from "../../application/commands/command.ts";
import type { WorkbenchStateReads } from "../../adapters/fs/workbench-state.ts";
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { filehubCheckCommand } from "./filehub.ts";
import { renderProjectsNavBlock, renderRootNavBlock } from "../../application/filehub/navigation.ts";

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function ctx(json: boolean): CmdContext {
  root = mkdtempSync(join(tmpdir(), "jspace-filehub-cli-"));
  return { root, cwd: root, dir: root, json, dryRun: false };
}

function emptyNav(workbench: string): void {
  const input = { projects: [], areas: [], unregistered: [] };
  mkdirSync(join(workbench, "projects"), { recursive: true });
  writeFileSync(join(workbench, "README.md"), `${renderRootNavBlock(input)}\n`);
  writeFileSync(join(workbench, "projects", "README.md"), `${renderProjectsNavBlock(input)}\n`);
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

function emptyState(workbench: string): WorkbenchStateReads {
  return {
    root: workbench,
    hub: {
      status: "ok",
      value: { schema_version: 1, domains: [], resources: [], projects: [] },
    },
    marker: { status: "missing" },
    local: { status: "missing" },
  };
}

test("filehubCheckCommand returns structured JSON and exits zero for a complete empty filehub", async () => {
  const c = ctx(true);
  emptyNav(c.root);
  const result = await filehubCheckCommand(c, {
    gbrain: emptyGbrain,
    filehubRoot: () => c.root,
    readState: emptyState,
  });
  expect(result.exitCode).toBeUndefined();
  expect(result.data).toMatchObject({
    schema_version: 1,
    status: "ok",
    coverage: {
      files: { state: "complete", scanned_objects: 3 },
      registry: { state: "complete" },
      memory: { state: "complete" },
    },
  });
});

test("filehubCheckCommand returns human output and exit 1 when the registry is missing", async () => {
  const c = ctx(false);
  const missing: WorkbenchStateReads = {
    root: c.root,
    hub: { status: "missing" },
    marker: { status: "missing" },
    local: { status: "missing" },
  };
  const result = await filehubCheckCommand(c, {
    gbrain: emptyGbrain,
    filehubRoot: () => null,
    readState: () => missing,
  });
  expect(result.exitCode).toBe(1);
  const text = result.lines?.join("\n") ?? "";
  expect(text).toContain("filehub check: partial");
  expect(text).toContain("filehub.registry.unreadable");
  expect(text).toContain("filehub.root.unregistered");
  expect(text).toContain("read-only");
});

test("filehubCheckCommand surfaces invalid hub issues without attempting a write", async () => {
  const c = ctx(true);
  const invalid: WorkbenchStateReads = {
    root: c.root,
    hub: {
      status: "invalid",
      issues: [
        {
          code: "hub.projects.type",
          path: "hub.projects",
          message: "projects must be an array",
        },
      ],
    },
    marker: { status: "missing" },
    local: { status: "missing" },
  };
  let writes = 0;
  const result = await filehubCheckCommand(c, {
    gbrain: () => ({
      ...emptyGbrain(),
      putPage: async () => {
        writes += 1;
        return { ok: false, code: "process_error", message: "write attempted" };
      },
    }),
    filehubRoot: () => null,
    readState: () => invalid,
  });
  expect(result.exitCode).toBe(1);
  expect(result.data).toMatchObject({ status: "partial" });
  expect(JSON.stringify(result.data)).toContain("hub.projects.type");
  expect(writes).toBe(0);
});
