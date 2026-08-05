// application/registry/filehub.test.ts — `jspace filehub init` use case
// (zero coverage before the review). Real initWorkbench workbench + injected
// FilehubDeps; skeleton/README/dry-run/register paths. Compensation fault
// injection (writeHubAndLocal failure) needs that writer injected — deferred.
// Run: bun test application/registry/filehub.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub, loadLocal } from "../workspace/state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { filehubInit } from "./filehub.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };
const filehubReadme = () => "# 文件管理中心 (Filehub)\n\n测试 README\n";
const fhDeps = (wbRoot: string) => ({ resolvePath, expandTilde, filehubReadme, devRoot, wbRoot });

let wb: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-filehub-"));
  initWorkbench(wb, false, initDeps);
});
afterEach(() => {
  rmSync(wb, { recursive: true, force: true });
});

test("init creates skeleton + README (only when missing); re-run is a no-op", () => {
  const fh = join(wb, "filehub");
  const r1 = filehubInit(fh, false, undefined, fhDeps(wb), false);
  expect(r1.lines[0]).toContain("initialized filehub");
  for (const d of ["_inbox", "projects", "areas", "archive"]) {
    expect(existsSync(join(fh, d))).toBe(true);
  }
  expect(existsSync(join(fh, "README.md"))).toBe(true);
  const r2 = filehubInit(fh, false, undefined, fhDeps(wb), false);
  expect(r2.lines[0]).toContain("already initialized"); // README not overwritten
});

test("dry-run writes nothing", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, false, undefined, fhDeps(wb), true);
  expect(r.lines.some((l) => l.includes("would initialize"))).toBe(true);
  expect(existsSync(fh)).toBe(false);
});

test("register with new domain creates domain skeleton + hub resource + local binding", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, true, "files", fhDeps(wb), false);
  expect(r.lines.some((l) => l.includes("created domain: files"))).toBe(true);
  expect(r.lines.some((l) => l.includes("registered filehub resource"))).toBe(true);
  const hub = loadHub(wb);
  expect(hub.resources.some((res) => res.type === "filehub")).toBe(true);
  expect(loadLocal(wb)?.bindings["filehub-path"]).toBe(resolvePath(fh)); // resolvePath realpaths /var -> /private/var on macOS
  expect(existsSync(join(wb, "workspace", "files"))).toBe(true);
});

test("register dry-run reports plan without writing", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, true, "files", fhDeps(wb), true);
  expect(r.lines.some((l) => l.includes("would create domain: files"))).toBe(true);
  expect(r.lines.some((l) => l.includes("would register filehub resource"))).toBe(true);
  expect(loadHub(wb).resources).toHaveLength(0);
});
