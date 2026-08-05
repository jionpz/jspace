// application/registry/project.test.ts — `jspace project` use cases.
// Run: bun test application/registry/project.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub } from "../workspace/state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { domainAdd } from "./domain.ts";
import { resourceAdd } from "./resource.ts";
import { projectAdd, projectList } from "./project.ts";
import { ingestBegin } from "../ingest/use-cases.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-project-"));
  initWorkbench(root, false, initDeps);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("project list --json schema is stable", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "books", undefined, undefined, false);
  const { data } = projectList(root, true);
  expect(data).toEqual({
    projects: [{ id: "books", domain: "files", asset_rel_path: "projects/books", status: "active" }],
  });
});

test("project add defaults domain=files and asset_rel_path=projects/<id>", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  const { lines } = projectAdd(root, "books", undefined, undefined, false);
  expect(lines[0]).toContain("added project: books");
  const proj = loadHub(root).projects.find((p) => p.id === "books");
  expect(proj).toEqual({ id: "books", domain: "files", asset_rel_path: "projects/books", status: "active" });
});

test("project add honors --domain and --asset-rel-path overrides", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  domainAdd(root, "papers", undefined, undefined, undefined, false);
  projectAdd(root, "acme", "papers", "projects/acme/docs", false);
  const proj = loadHub(root).projects.find((p) => p.id === "acme");
  expect(proj).toEqual({ id: "acme", domain: "papers", asset_rel_path: "projects/acme/docs", status: "active" });
});

test("project add fails on duplicate id", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "books", undefined, undefined, false);
  expect(() => projectAdd(root, "books", undefined, undefined, false)).toThrow(/duplicate project id/);
});

test("project add fails on unknown domain (default files not registered)", () => {
  expect(() => projectAdd(root, "books", undefined, undefined, false)).toThrow(/no such domain: files/);
});

test("project add --dry-run leaves hub.json unchanged", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  const before = JSON.stringify(loadHub(root));
  projectAdd(root, "books", undefined, undefined, true);
  expect(JSON.stringify(loadHub(root))).toBe(before);
  projectAdd(root, "books", undefined, undefined, false);
  expect(loadHub(root).projects.map((p) => p.id)).toEqual(["books"]);
});

test("registered project removes the ingest not-registered warning", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  // register a filehub resource (type=filehub) so ingest can resolve the root
  const fh = join(root, "filehub");
  resourceAdd(root, "filehub", "files", "filehub", fh, undefined, undefined, undefined, false);
  for (const d of ["_inbox", "projects/zeta", "projects/books"]) {
    mkdirSync(join(fh, d), { recursive: true });
  }
  const src = join(fh, "_inbox", "sample.txt");
  writeFileSync(src, "test content");

  const unregistered = ingestBegin(root, {
    file: src,
    target: "projects/zeta/sample.txt",
    slug: "assets/zeta/sample",
    project: "zeta",
  });
  expect(unregistered.lines.some((l) => l.includes("not registered"))).toBe(true);

  projectAdd(root, "books", undefined, undefined, false);
  const registered = ingestBegin(root, {
    file: src,
    target: "projects/books/sample.txt",
    slug: "assets/books/sample",
    project: "books",
  });
  expect(registered.lines.some((l) => l.includes("not registered"))).toBe(false);
});
