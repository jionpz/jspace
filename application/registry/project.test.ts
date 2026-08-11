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
import { projectAdd, projectList, projectListStatus } from "./project.ts";
import { ingestBegin } from "../ingest/use-cases.ts";
import { parse, type CmdContext, type CommandSpec } from "../commands/command.ts";
import { COMMANDS } from "../../cli/commands/registry.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };

const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };

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

test("--asset-rel-path argv binds to args.assetRelPath via dest (regression)", () => {
  const out = parse(["project", "add", "books", "--asset-rel-path", "projects/books/docs"], ROOT);
  expect(out.kind).toBe("run");
  const r = out as { args: Record<string, unknown> };
  expect(r.args.assetRelPath).toBe("projects/books/docs");
  expect(r.args.domain).toBeUndefined();
});

test("project add --asset-rel-path via real parser writes the override", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  const out = parse(["project", "add", "books", "--asset-rel-path", "projects/books/docs"], ROOT);
  expect(out.kind).toBe("run");
  const r = out as { args: Record<string, unknown>; spec: CommandSpec };
  const ctx: CmdContext = { root, json: false, dryRun: false, dir: undefined, cwd: root };
  r.spec.handler?.(ctx, r.args);
  expect(loadHub(root).projects[0].asset_rel_path).toBe("projects/books/docs");
});

test("project add rejects non-portable asset_rel_path (.. segment)", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  expect(() => projectAdd(root, "books", "files", "projects/../x", false)).toThrow();
});

const CARD = `---
type: note
project: jspace
tags: [project]
---

# jspace 现状

## 这个项目是什么·解决什么
本地工作控制平面

## 现在到哪了
记忆模型重构实现中

## 下一步
迁移脚本

## 相关项目
- [[project/报表模块/state]]
`;

const CARD2 = `---
type: note
project: wms
tags: [project]
---

# wms 现状

## 这个项目是什么·解决什么
仓储系统

## 现在到哪了
二期开发

## 下一步
联调
`;

function gbrainWith(rows: { slug: string; updatedAt: string; content: string }[]) {
  return {
    get: async (slug: string) => {
      const r = rows.find((x) => x.slug === slug);
      return r ? { ok: true, content: r.content } : { ok: false };
    },
    put: async () => ({ ok: true }),
    list: async () => ({ ok: true, rows: rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt })) }),
  };
}

const EMPTY_GBRAIN = {
  get: async () => ({ ok: false }),
  put: async () => ({ ok: true }),
  list: async () => ({ ok: true, rows: [] }),
};

test("project list --status: state cards first (incl. unregistered code projects) + hub-only cards flagged", async () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "tiyanying-52", undefined, undefined, false);
  const gbrain = gbrainWith([
    { slug: "project/jspace/state", updatedAt: "2026-08-10", content: CARD },
    { slug: "project/wms/state", updatedAt: "2026-08-05", content: CARD2 },
  ]);
  const r = await projectListStatus(root, false, gbrain as never);
  // jspace is a state card (no hub entry); tiyanying-52 is hub-only, flagged.
  expect(r.lines[0]).toContain("jspace");
  expect(r.lines[0]).toContain("本地工作控制平面");
  expect(r.lines[0]).toContain("记忆模型重构实现中");
  expect(r.lines[0]).toContain("[相关: 报表模块]");
  expect(r.lines[1]).toContain("wms");
  expect(r.lines[2]).toContain("tiyanying-52");
  expect(r.lines[2]).toContain("无状态卡");
});

test("project list --status --json returns structured cards", async () => {
  const gbrain = gbrainWith([{ slug: "project/jspace/state", updatedAt: "2026-08-10", content: CARD }]);
  const r = await projectListStatus(root, true, gbrain as never);
  const data = (r.data as { projects: unknown[] }).projects;
  expect(data[0]).toEqual({
    id: "jspace", what: "本地工作控制平面", now: "记忆模型重构实现中", next: "迁移脚本",
    related: ["报表模块"], updatedAt: "2026-08-10", hubRegistered: false, hasStateCard: true,
  });
});

test("project list --status: gbrain unavailable degrades to hub-only list", async () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "books", undefined, undefined, false);
  const r = await projectListStatus(root, false, EMPTY_GBRAIN as never);
  expect(r.lines[0]).toContain("books");
  expect(r.lines[0]).toContain("无状态卡");
});
