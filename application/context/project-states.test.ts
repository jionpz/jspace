// application/context/project-states.test.ts — R3 project state collection.
// Run: bun test application/context/project-states.test.ts
import { expect, test } from "bun:test";
import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts";
import {
  collectActiveProjects,
  summarizeStateCard,
  MAX_ACTIVE_PROJECTS,
} from "./project-states.ts";

function fakeGbrain(over: Partial<GbrainDeps> = {}): GbrainDeps {
  return {
    get: async () => ({ ok: false }),
    put: async () => ({ ok: true }),
    list: async () => ({ ok: true, rows: [] }),
    ...over,
  };
}

const CARD = `---
type: note
project: jspace
tags: [project]
---

# jspace 现状

## 这个项目是什么·解决什么
JSpace 本地工作控制平面。

## 现在到哪了
记忆模型重构设计期,P1 任务规划完成。

## 下一步
进入实现。
`;

test("collectActiveProjects: filters project/*/state, keeps top-N with summaries", async () => {
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        { slug: "project/jspace/state", updatedAt: "2026-08-10" },
        { slug: "project/wms/state", updatedAt: "2026-08-05" },
        { slug: "knowledge/governance/x", updatedAt: "2026-08-09" }, // filtered out
        { slug: "project/jspace/decisions/x", updatedAt: "2026-08-09" }, // filtered out
      ],
    }),
    get: async (slug) =>
      slug === "project/jspace/state" ? { ok: true, content: CARD } : { ok: false },
  });
  const r = await collectActiveProjects(g);
  expect(r).toHaveLength(2);
  expect(r[0]).toEqual({ id: "jspace", summary: "记忆模型重构设计期,P1 任务规划完成。", updatedAt: "2026-08-10" });
  expect(r[1]).toEqual({ id: "wms", summary: "", updatedAt: "2026-08-05" });
});

test("collectActiveProjects: list failure or no state cards -> empty, never throws", async () => {
  expect(await collectActiveProjects(fakeGbrain({ list: async () => ({ ok: false, error: "lock" }) }))).toEqual([]);
  expect(await collectActiveProjects(fakeGbrain({ list: async () => ({ ok: true, rows: [] }) }))).toEqual([]);
  expect(
    await collectActiveProjects(fakeGbrain({ list: async () => ({ ok: true, rows: [{ slug: "knowledge/x", updatedAt: "d" }] }) })),
  ).toEqual([]);
});

test("collectActiveProjects: caps at MAX_ACTIVE_PROJECTS", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ slug: `project/p${i}/state`, updatedAt: `2026-08-${i + 1}` }));
  const g = fakeGbrain({ list: async () => ({ ok: true, rows }) });
  const r = await collectActiveProjects(g);
  expect(r).toHaveLength(MAX_ACTIVE_PROJECTS);
});

test("collectActiveProjects: get failure still yields the id (recency is the signal)", async () => {
  const g = fakeGbrain({
    list: async () => ({ ok: true, rows: [{ slug: "project/jspace/state", updatedAt: "2026-08-10" }] }),
    get: async () => ({ ok: false }),
  });
  const r = await collectActiveProjects(g);
  expect(r).toEqual([{ id: "jspace", summary: "", updatedAt: "2026-08-10" }]);
});

test("summarizeStateCard: first line of 现在到哪了, truncated at 80 chars", () => {
  expect(summarizeStateCard(CARD)).toBe("记忆模型重构设计期,P1 任务规划完成。");
  const long = CARD.replace("记忆模型重构设计期,P1 任务规划完成。", "字".repeat(120));
  const s = summarizeStateCard(long);
  expect(s.length).toBe(81); // 80 + ellipsis
  expect(s.endsWith("…")).toBe(true);
});

test("summarizeStateCard: no 现在到哪了 -> first non-heading content line; empty -> ''", () => {
  const noSection = CARD.replace("## 现在到哪了\n记忆模型重构设计期,P1 任务规划完成。\n", "");
  expect(summarizeStateCard(noSection)).toBe("JSpace 本地工作控制平面。");
  expect(summarizeStateCard("---\ntype: note\n---\n\n")).toBe("");
});
