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
  expect(local.version).toBe(1);
  expect(typeof local.installation_id).toBe("string");
  expect(local.installation_id.length).toBeGreaterThan(0);
  expect(local.bindings).toEqual({});
  expect(decodeLocal(local).ok).toBe(true);

  // the materialized template hub is v4 (embedded assets are in sync)
  const hub = JSON.parse(readFileSync(join(root, ".jspace", "hub.json"), "utf-8"));
  expect(hub.version).toBe("4");
  expect(hub.projects).toEqual([]);
  expect(decodeHub(hub).ok).toBe(true);

  // local state and the runtime state slot are gitignored
  const gi = readFileSync(join(root, ".gitignore"), "utf-8");
  expect(gi).toContain(".jspace/local.json");
  expect(gi).toContain(".jspace/state/");

  expect(existsSync(join(root, ".jspace", "logs"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test("workbench template hub is v4 and gitignore ignores local state", () => {
  const repo = devRoot();
  const hub = JSON.parse(
    readFileSync(join(repo, "templates/workbench/.jspace/hub.json"), "utf-8"),
  );
  expect(hub.version).toBe("4");
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
        version: "4",
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
