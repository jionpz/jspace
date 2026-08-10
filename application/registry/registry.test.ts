// application/registry/registry.test.ts — registry use-case JSON schema + dry-run.
// Run: bun test application/registry/registry.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub } from "../workspace/state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { domainAdd, domainList, domainRemove } from "./domain.ts";
import { inboxStatus } from "./inbox.ts";
import { resourceAdd, resourceList, resourceRemove } from "./resource.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-reg-"));
  initWorkbench(root, false, initDeps);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("domain list --json schema is stable", () => {
  domainAdd(root, "sales", undefined, ["crm"], "CRM", false);
  const { data } = domainList(root, true);
  expect(data).toEqual({ domains: [{ id: "sales", path: "workspace/sales", tags: ["crm"] }] });
});

test("resource list --json schema includes binding resolution", () => {
  domainAdd(root, "sales", undefined, undefined, undefined, false);
  resourceAdd(root, "demo", "sales", undefined, "/tmp/fh", undefined, undefined, "a note", false);
  const { data } = resourceList(root, true);
  const r = data as {
    resources: { id: string; type: string; domain: string; tags: string[]; entrypoints: unknown[] }[];
  };
  expect(r.resources).toHaveLength(1);
  expect(r.resources[0]).toMatchObject({
    id: "demo",
    type: "project",
    domain: "sales",
    tags: [],
    notes: "a note",
  });
  expect(r.resources[0].entrypoints[0]).toMatchObject({
    kind: "path",
    binding: "demo-path",
    resolution: "missing", // bound but path does not exist yet
  });
});

test("inbox status --json schema (no filehub -> inbox null)", () => {
  const { data } = inboxStatus(root, true);
  expect(data).toEqual({ inbox: null, count: 0, files: [] });
});

test("domain add --dry-run leaves hub.json unchanged", () => {
  domainAdd(root, "a", undefined, undefined, undefined, false);
  const before = JSON.stringify(loadHub(root));
  domainAdd(root, "b", undefined, undefined, undefined, true);
  expect(JSON.stringify(loadHub(root))).toBe(before);
  // the real add still works after the dry-run
  domainAdd(root, "b", undefined, undefined, undefined, false);
  expect(loadHub(root).domains.map((d) => d.id)).toEqual(["a", "b"]);
});

test("resource add/remove --dry-run leaves hub+local unchanged", () => {
  domainAdd(root, "sales", undefined, undefined, undefined, false);
  resourceAdd(root, "x", "sales", undefined, "/tmp/fh", undefined, undefined, undefined, false);
  const before = JSON.stringify(loadHub(root));
  resourceAdd(root, "y", "sales", undefined, "/tmp/fh", undefined, undefined, undefined, true);
  resourceRemove(root, "x", true);
  expect(JSON.stringify(loadHub(root))).toBe(before);
});

test("domain remove --dry-run reports plan without mutating", () => {
  domainAdd(root, "sales", undefined, undefined, undefined, false);
  const before = JSON.stringify(loadHub(root));
  const { lines } = domainRemove(root, "sales", false, true);
  expect(lines[0]).toContain("would remove domain: sales");
  expect(JSON.stringify(loadHub(root))).toBe(before);
});

test("domain add rolls back the skeleton when the hub write fails (issue #8 #13)", () => {
  if (process.platform === "win32") return; // chmod-based write failure differs on Windows
  // make .jspace unwritable so writeHubAtomic's temp write throws EACCES
  chmodSync(join(root, ".jspace"), 0o555);
  try {
    expect(() => domainAdd(root, "work", undefined, ["t"], undefined, false)).toThrow();
  } finally {
    chmodSync(join(root, ".jspace"), 0o755); // restore so afterEach can clean up
  }
  expect(existsSync(join(root, "workspace", "work"))).toBe(false); // skeleton rolled back, no orphan
});

test("resource add rejects a second filehub resource (issue #8 #10)", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  resourceAdd(root, "fh", "files", "filehub", "/tmp/fh", undefined, undefined, undefined, false);
  expect(() => resourceAdd(root, "fh2", "files", "filehub", "/tmp/fh2", undefined, undefined, undefined, false)).toThrow(/filehub resource is already registered/);
});
