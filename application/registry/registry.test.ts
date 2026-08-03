// application/registry/registry.test.ts — registry use-case JSON schema + dry-run.
// Run: bun test application/registry/registry.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub } from "../workspace/state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { domainAdd, domainList, domainRemove } from "./domain.ts";
import { inboxStatus } from "./inbox.ts";
import { resourceAdd, resourceList, resourceRemove } from "./resource.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree };

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
