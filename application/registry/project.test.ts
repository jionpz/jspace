// application/registry/project.test.ts — `jspace project` use cases.
// Run: bun test application/registry/project.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub } from "../workspace/state.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { mutationLockPath } from "../lock.ts";
import { domainAdd } from "./domain.ts";
import { resourceAdd } from "./resource.ts";
import { projectAdd, projectList, projectListStatus } from "./project.ts";
import { ingestBegin } from "../ingest/use-cases.ts";
import { parse, type CmdContext, type CommandSpec } from "../commands/command.ts";
import { COMMANDS } from "../../cli/commands/registry.ts";
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";

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
  expect(existsSync(mutationLockPath(root))).toBe(false);
  projectAdd(root, "books", undefined, undefined, false);
  expect(loadHub(root).projects.map((p) => p.id)).toEqual(["books"]);
});

test("ingest requires a registered project instead of deriving a fallback owner", () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  // register a filehub resource (type=filehub) so ingest can resolve the root
  const fh = join(root, "filehub");
  resourceAdd(root, "filehub", "files", "filehub", fh, undefined, undefined, undefined, false);
  for (const d of ["_inbox", "projects/zeta", "projects/books"]) {
    mkdirSync(join(fh, d), { recursive: true });
  }
  const src = join(fh, "_inbox", "sample.txt");
  writeFileSync(src, "test content");

  expect(() =>
    ingestBegin(root, {
      file: src,
      target: "projects/zeta/sample.txt",
      slug: "assets/zeta/sample",
      ownerKind: "project",
      ownerId: "zeta",
      indexLine: "2026-10-18 | sample | assets/zeta/sample",
    }),
  ).toThrow(/no registered project/);

  projectAdd(root, "books", undefined, undefined, false);
  const registered = ingestBegin(root, {
    file: src,
    target: "projects/books/sample.txt",
    slug: "assets/books/sample",
    ownerKind: "project",
    ownerId: "books",
    indexLine: "2026-10-18 | sample | assets/books/sample",
  });
  expect(registered.lines.some((l) => l.includes("ingest staged"))).toBe(true);
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

function gbrainWith(rows: { slug: string; updatedAt: string; content: string }[]): GbrainDeps {
  return {
    getPage: async (slug: string) => {
      const r = rows.find((x) => x.slug === slug);
      return r
        ? {
            ok: true,
            page: {
              slug,
              revision: "revision-1",
              contentHash: "a".repeat(64),
              content: r.content,
              tags: ["project"],
            },
          }
        : { ok: false, code: "not_found", message: "missing" };
    },
    listPages: async () => ({
      ok: true,
      rows: rows.map((r) => ({ slug: r.slug, title: "", type: "note", updatedAt: r.updatedAt })),
    }),
    putPage: async () => ({ ok: false, code: "process_error", message: "not used" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "not used" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

const EMPTY_GBRAIN: GbrainDeps = {
  getPage: async () => ({ ok: false, code: "not_found", message: "missing" }),
  listPages: async () => ({ ok: false, code: "process_error", message: "unavailable" }),
  putPage: async () => ({ ok: false, code: "process_error", message: "not used" }),
  getWriteRequest: async () => ({ ok: false, code: "not_found", message: "not used" }),
  getBacklinks: async () => ({
    ok: true,
    rows: [],
    total: 0,
    truncated: false,
    coverage: { state: "complete", degraded: false },
  }),
};

test("project list --status: state cards first (incl. unregistered code projects) + hub-only cards flagged", async () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "tiyanying-52", undefined, undefined, false);
  const gbrain = gbrainWith([
    { slug: "project/jspace/state", updatedAt: "2026-08-10", content: CARD },
    { slug: "project/wms/state", updatedAt: "2026-08-05", content: CARD2 },
  ]);
  const r = await projectListStatus(root, false, gbrain);
  // jspace is a state card (no hub entry); tiyanying-52 is hub-only, flagged.
  expect(r.lines[0]).toContain("jspace");
  expect(r.lines[0]).toContain("本地工作控制平面");
  expect(r.lines[0]).toContain("记忆模型重构实现中");
  expect(r.lines[0]).toContain("[相关: 报表模块]");
  expect(r.lines[1]).toContain("wms");
  expect(r.lines[2]).toContain("tiyanying-52");
  expect(r.lines[2]).toContain("无状态卡");
});

test("project list --status --json returns structured cards plus coverage", async () => {
  const gbrain = gbrainWith([{ slug: "project/jspace/state", updatedAt: "2026-08-10", content: CARD }]);
  const r = await projectListStatus(root, true, gbrain);
  const data = (r.data as { projects: unknown[] }).projects;
  expect(data[0]).toEqual({
    id: "jspace", what: "本地工作控制平面", now: "记忆模型重构实现中", next: "迁移脚本",
    related: ["报表模块"], updatedAt: "2026-08-10", hubRegistered: false, hasStateCard: true,
    stateCardEvidence: "present",
  });
  const coverage = (r.data as { coverage: { status: string } }).coverage;
  expect(coverage.status).toBe("complete");
});

test("project list --status: gbrain unavailable degrades to hub-only list and never claims absence", async () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "books", undefined, undefined, false);
  const r = await projectListStatus(root, false, EMPTY_GBRAIN);
  expect(r.lines[0]).toContain("books");
  // A failed scan cannot prove the card is missing — only that it is unconfirmed.
  expect(r.lines[0]).toContain("未确认");
  expect(r.lines[0]).not.toContain("无状态卡");
  expect(r.lines.at(-1)).toContain("盘点不完整");
});

/** Multi-page project inventory: page one fills a page, page two is injected. */
function pagedGbrain(
  firstPage: { slug: string; updatedAt: string }[],
  secondPage: () => Promise<{ ok: false; code: "lock"; message: string }>,
): GbrainDeps {
  const base = gbrainWith([]);
  let calls = 0;
  return {
    ...base,
    listPages: async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: true,
          rows: firstPage.map((r) => ({ slug: r.slug, title: "", type: "note", updatedAt: r.updatedAt })),
          nextCursor: { updatedAfter: "2026-08-01", updatedAfterSlug: "a" },
        };
      }
      return secondPage();
    },
  };
}

test("project list --status: an incomplete inventory keeps partial coverage and unresolved cards", async () => {
  domainAdd(root, "files", undefined, undefined, undefined, false);
  projectAdd(root, "books", undefined, undefined, false);
  const noise = Array.from({ length: 100 }, (_, i) => ({ slug: `project/n${i}/decisions/d`, updatedAt: "2026-08-01" }));
  // Fresh adapter per call: the paged fake advances its own page counter.
  const make = () => pagedGbrain(noise, async () => ({ ok: false, code: "lock", message: "locked" }));

  const human = await projectListStatus(root, false, make());
  const text = human.lines.join("\n");
  expect(text).toContain("books");
  expect(text).toContain("未确认");
  expect(human.lines.at(-1)).toContain("盘点不完整");

  const json = await projectListStatus(root, true, make());
  const coverage = (json.data as { coverage: { status: string } }).coverage;
  expect(coverage.status).toBe("partial");
  const cards = (json.data as { projects: { id: string; stateCardEvidence: string }[] }).projects;
  expect(cards.find((c) => c.id === "books")?.stateCardEvidence).toBe("unknown");
});

test("project list --status: an unreadable card body keeps the card and lowers coverage", async () => {
  const gbrain: GbrainDeps = {
    ...gbrainWith([]),
    listPages: async () => ({
      ok: true,
      rows: [{ slug: "project/jspace/state", title: "", type: "note", updatedAt: "2026-08-10" }],
    }),
  };
  const r = await projectListStatus(root, false, gbrain);
  expect(r.lines.join("\n")).toContain("jspace");
  expect(r.lines.at(-1)).toContain("盘点不完整");
});
