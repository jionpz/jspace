// cli/init.test.ts — init integration + workbench template baseline tests.
// Covers the portable marker / machine-local split introduced by the state
// contract, and the clone-without-local path (local missing → bindings unbound).
// Run: bun test cli/init.test.ts
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkbenchState } from "../adapters/fs/workbench-state.ts";
import { decodeHub } from "../core/contracts/hub.ts";
import { decodeLocal } from "../core/contracts/local.ts";
import { decodeMarker } from "../core/contracts/workbench.ts";
import { inspectWorkbench, type InspectEnv } from "../core/registry/inspect.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "./embed.ts";
import { initWorkbench } from "../application/workspace/init.ts";
import { BUNDLE_MANIFEST } from "./manifest.generated.ts";
import { resolvePath } from "./paths.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };
function init(root: string, force = false): void {
  initWorkbench(root, force, initDeps);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

test("init creates portable marker v1 and machine-local v1", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-"));
  init(root);

  const markerPath = join(root, ".jspace", "marker.json");
  const localPath = join(root, ".jspace", "local.json");
  expect(existsSync(markerPath)).toBe(true);
  expect(existsSync(localPath)).toBe(true);

  const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
  expect(marker.schema_version).toBe(1);
  expect(marker.product).toBe("JSpace");
  expect(typeof marker.workbench_id).toBe("string");
  expect(marker.workbench_id.length).toBeGreaterThan(0);
  expect(marker).not.toHaveProperty("source");
  expect(decodeMarker(marker).ok).toBe(true);

  const local = JSON.parse(readFileSync(localPath, "utf-8"));
  expect(local.schema_version).toBe(1);
  expect(typeof local.installation_id).toBe("string");
  expect(local.installation_id.length).toBeGreaterThan(0);
  expect(local.bindings).toEqual({});
  expect(decodeLocal(local).ok).toBe(true);

  // the materialized template hub uses schema_version 1 (embedded assets in sync)
  const hub = JSON.parse(readFileSync(join(root, ".jspace", "hub.json"), "utf-8"));
  expect(hub.schema_version).toBe(1);
  expect(hub.projects).toEqual([]);
  expect(decodeHub(hub).ok).toBe(true);

  // local state and the runtime state slot are gitignored
  const gi = readFileSync(join(root, ".gitignore"), "utf-8");
  expect(gi).toContain(".jspace/local.json");
  expect(gi).toContain(".jspace/state/");

  expect(existsSync(join(root, ".jspace", "logs"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("init materializes the Grok hook file and the .grok/.opencode skill projections", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-grok-"));
  init(root);

  // .grok hooks file (Grok Build session hooks, seed-owned, materialized by init)
  const hookPath = join(root, ".grok", "hooks", "jspace.json");
  expect(isFile(hookPath)).toBe(true);
  const hook = JSON.parse(readFileSync(hookPath, "utf-8"));
  expect(hook.hooks.SessionStart[0].hooks[0].command).toContain("jspace context session-start");
  expect(hook.hooks.UserPromptSubmit[0].hooks[0].command).toContain("jspace context turn");
  expect(hook.hooks.PreCompact[0].hooks[0].command).toContain("jspace context pre-compact");
  expect(hook.hooks.SessionEnd[0].hooks[0].command).toContain("jspace context session-end");

  // skill projections derive from capabilities.yaml workbench_projection
  for (const proj of [".grok/skills", ".opencode/skills", ".claude/skills", ".agents/skills"]) {
    expect(existsSync(join(root, proj, "jspace-use", "SKILL.md"))).toBe(true);
  }

  rmSync(root, { recursive: true, force: true });
});

test("init materializes the Claude + Cursor session hooks incl. session-end (B4)", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-hooks-"));
  init(root);

  const claude = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf-8"));
  expect(claude.hooks.SessionStart[0].hooks[0].command).toContain("jspace context session-start");
  expect(claude.hooks.UserPromptSubmit[0].hooks[0].command).toContain("jspace context turn");
  // SessionEnd shares a 1.5s budget unless a per-hook timeout raises it
  expect(claude.hooks.SessionEnd[0].hooks[0].command).toContain("jspace context session-end");
  expect(claude.hooks.SessionEnd[0].hooks[0].timeout).toBeGreaterThan(1.5);

  const cursor = JSON.parse(readFileSync(join(root, ".cursor", "hooks.json"), "utf-8"));
  expect(cursor.hooks.sessionStart[0].command).toContain("jspace context session-start");
  expect(cursor.hooks.sessionEnd[0].command).toContain("jspace context session-end");

  rmSync(root, { recursive: true, force: true });
});

test("init materializes the OpenCode plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-opencode-"));
  init(root);

  const pluginPath = join(root, ".opencode", "plugins", "jspace.ts");
  expect(isFile(pluginPath)).toBe(true);
  const plugin = readFileSync(pluginPath, "utf-8");
  expect(plugin).toContain("session.created");
  expect(plugin).toContain("session.idle");
  expect(plugin).toContain("experimental.session.compacting");
  expect(plugin).toContain("cron check");
  // P1.7: idle must NOT auto-flush staged writes (no pending apply in the plugin)
  expect(plugin).not.toContain("pending apply");

  rmSync(root, { recursive: true, force: true });
});

test("workbench template hub is v4 and gitignore ignores local state", () => {
  const repo = devRoot();
  const hub = JSON.parse(
    readFileSync(join(repo, "templates/workbench/.jspace/hub.json"), "utf-8"),
  );
  expect(hub.schema_version).toBe(1);
  expect(hub.domains).toEqual([]);
  expect(hub.resources).toEqual([]);
  expect(hub.projects).toEqual([]);
  expect(decodeHub(hub).ok).toBe(true);

  const gi = readFileSync(join(repo, "templates/workbench/.gitignore"), "utf-8");
  expect(gi).toContain(".jspace/local.json");
  expect(gi).toContain(".jspace/state/");
});

test("cloned workbench without local.json reports local missing and unbound bindings", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-clone-"));
  const jspace = join(root, ".jspace");
  mkdirSync(jspace, { recursive: true });
  writeFileSync(
    join(jspace, "hub.json"),
    JSON.stringify(
      {
        schema_version: 1,
        domains: [{ id: "files", path: "workspace/files" }],
        resources: [
          {
            id: "filehub",
            type: "filehub",
            domain: "files",
            entrypoints: [{ id: "primary", kind: "path", binding: "filehub-primary", primary: true }],
          },
        ],
        projects: [],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  writeFileSync(
    join(jspace, "marker.json"),
    JSON.stringify(
      { schema_version: 1, product: "JSpace", workbench_id: "wb-clone", template_version: "1.0.3", created_at: "2026-08-03" },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  // no local.json — local state is gitignored, so a clone arrives without it

  const reads = readWorkbenchState(root);
  expect(reads.local.status).toBe("missing");

  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: () => false,
    isFile,
    readJson: (p) => JSON.parse(readFileSync(p, "utf-8")),
  };
  const codes = inspectWorkbench(env).map((d) => d.code);
  expect(codes).toContain("local.missing");
  expect(codes).toContain("binding.unbound");
  rmSync(root, { recursive: true, force: true });
});

test("init --force refuses an already-initialized workbench (upgrade path)", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-force-"));
  init(root);
  // even --force must not re-materialize over an initialized workbench
  expect(() => init(root, true)).toThrow(/already a JSpace workbench/);
  rmSync(root, { recursive: true, force: true });
});

test("init --force into a dir with a user AGENTS.md embeds the JSPACE block, user content preserved", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-embed-"));
  mkdirSync(root, { recursive: true });
  const userHeader = "# My own project notes\n\nThis directory is not a workbench yet.\n";
  writeFileSync(join(root, "AGENTS.md"), userHeader, "utf-8");
  init(root, true);
  const out = readFileSync(join(root, "AGENTS.md"), "utf-8");
  expect(out.startsWith("<!-- JSPACE:START -->")).toBe(true); // block embedded at the top
  expect(out).toContain("<!-- JSPACE:END -->");
  expect(out).toContain(userHeader); // user content preserved verbatim after the block
  rmSync(root, { recursive: true, force: true });
});

test("init result hints at user-level skills install (P0-4)", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-init-hint-"));
  const r = initWorkbench(root, false, initDeps);
  expect(r.lines.join("\n")).toContain("skills install");
  expect(r.lines.join("\n")).toContain("Next:");
  rmSync(root, { recursive: true, force: true });
});
