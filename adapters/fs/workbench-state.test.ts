// adapters/fs/workbench-state.test.ts — filesystem repository tests: read
// outcomes, deterministic atomic writes, and paired hub/local mutation with
// injected second-write failure compensation.
// Run: bun test adapters/fs/workbench-state.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubV1 } from "../../core/contracts/hub.ts";
import type { LocalStateV1 } from "../../core/contracts/local.ts";
import type { WorkbenchMarkerV1 } from "../../core/contracts/workbench.ts";
import {
  formatJson,
  readWorkbenchState,
  writeBytesAtomic,
  writeHubAndLocal,
  writeJsonAtomic,
} from "./workbench-state.ts";

function validHub(): HubV1 {
  return {
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
  };
}

function validLocal(): LocalStateV1 {
  return { schema_version: 1, installation_id: "inst", bindings: { "filehub-primary": "/tmp/fh" } };
}

function tempWorkbench(): string {
  return mkdtempSync(join(tmpdir(), "jspace-ws-"));
}

function writeHubFile(root: string, hub: unknown): string {
  const dir = join(root, ".jspace");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "hub.json");
  writeFileSync(p, formatJson(hub), "utf-8");
  return p;
}

test("readWorkbenchState reads valid hub/local/marker", () => {
  const root = tempWorkbench();
  const hub = validHub();
  const local = validLocal();
  const marker: WorkbenchMarkerV1 = { schema_version: 1, product: "JSpace", workbench_id: "wb-1", template_version: "1.0.3", created_at: "2026-08-03" };
  writeHubFile(root, hub);
  writeJsonAtomic(join(root, ".jspace", "local.json"), local);
  writeJsonAtomic(join(root, ".jspace", "marker.json"), marker);

  const state = readWorkbenchState(root);
  expect(state.hub.status).toBe("ok");
  if (state.hub.status === "ok") expect(state.hub.value).toEqual(hub);
  expect(state.local.status).toBe("ok");
  if (state.local.status === "ok") expect(state.local.value).toEqual(local);
  expect(state.marker.status).toBe("ok");
  rmSync(root, { recursive: true, force: true });
});

test("missing files report status missing; invalid JSON and v3 report invalid", () => {
  const root = tempWorkbench();
  const empty = readWorkbenchState(root);
  expect(empty.hub.status).toBe("missing");
  expect(empty.local.status).toBe("missing");
  expect(empty.marker.status).toBe("missing");

  mkdirSync(join(root, ".jspace"), { recursive: true });
  writeFileSync(join(root, ".jspace", "hub.json"), "{ not json", "utf-8");
  const badJson = readWorkbenchState(root);
  expect(badJson.hub.status).toBe("invalid");
  if (badJson.hub.status === "invalid") expect(badJson.hub.issues[0].code).toBe("hub.json.parse");

  writeHubFile(root, { version: "3", domains: [], resources: [] });
  const v3 = readWorkbenchState(root);
  expect(v3.hub.status).toBe("invalid");
  // P2-2: the legacy string `version` field is no longer a recognized axis —
  // it reports both unknown-field (not in the allowed list) and
  // version.unsupported (schema_version missing).
  if (v3.hub.status === "invalid") {
    const codes = v3.hub.issues.map((i) => i.code);
    expect(codes).toContain("hub.version.unsupported");
    expect(codes).toContain("hub.unknown-field");
  }
  rmSync(root, { recursive: true, force: true });
});

test("writeJsonAtomic writes deterministic two-space JSON with trailing newline", () => {
  const root = tempWorkbench();
  const p = join(root, "out.json");
  writeJsonAtomic(p, { a: 1, b: [1, 2] });
  expect(readFileSync(p, "utf-8")).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
  rmSync(root, { recursive: true, force: true });
});

test("writeHubAndLocal commits hub and local together", () => {
  const root = tempWorkbench();
  writeHubFile(root, validHub());
  writeHubAndLocal(root, validHub(), validLocal());
  expect(JSON.parse(readFileSync(join(root, ".jspace", "hub.json"), "utf-8"))).toEqual(validHub());
  expect(JSON.parse(readFileSync(join(root, ".jspace", "local.json"), "utf-8"))).toEqual(validLocal());
  rmSync(root, { recursive: true, force: true });
});

test("writeHubAndLocal asserts encoded state decodes before writing", () => {
  const root = tempWorkbench();
  const invalid = { ...validHub(), domains: [{ id: "Bad ID", path: "workspace/x" }] } as unknown as HubV1;
  expect(() => writeHubAndLocal(root, invalid, validLocal())).toThrow(/invariant/);
  expect(existsSync(join(root, ".jspace", "hub.json"))).toBe(false);
  rmSync(root, { recursive: true, force: true });
});

test("writeHubAndLocal compensates hub when the local rename fails", () => {
  const root = tempWorkbench();
  const hubPath = writeHubFile(root, validHub());
  const originalHub = readFileSync(hubPath, "utf-8");
  // local.json exists as a directory → the second rename fails
  mkdirSync(join(root, ".jspace", "local.json"));

  const next = { ...validHub(), domains: [...validHub().domains, { id: "new", path: "workspace/new" }] };
  const local = validLocal();
  expect(() => writeHubAndLocal(root, next, local)).toThrow(/paired write failed/);
  expect(readFileSync(hubPath, "utf-8")).toBe(originalHub);
  // no leftover temp siblings in .jspace/
  const entries = readdirSync(join(root, ".jspace"));
  expect(entries.filter((n) => n.includes(".tmp."))).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("writeBytesAtomic writes exact content and replaces existing file", () => {
  const root = tempWorkbench();
  const p = join(root, "f.txt");
  writeBytesAtomic(p, "one");
  writeBytesAtomic(p, "two");
  expect(readFileSync(p, "utf-8")).toBe("two");
  rmSync(root, { recursive: true, force: true });
});
