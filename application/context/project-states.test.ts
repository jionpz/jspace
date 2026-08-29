// application/context/project-states.test.ts — R3 project state collection.
// Run: bun test application/context/project-states.test.ts
import { expect, test } from "bun:test";
import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts";
import {
  collectActiveProjects,
  collectActiveProfiles,
  summarizeStateCard,
  summarizeProfilePage,
  isArchivedGbrainNote,
  parseNoteTags,
  MAX_ACTIVE_PROJECTS,
  MAX_ACTIVE_PROFILES,
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

test("collectActiveProjects: skips status:archived and backfills slots", async () => {
  const archived = `---
type: note
project: old
tags: [project, status:archived]
---
# old
## 现在到哪了
不应注入。
`;
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        { slug: "project/old/state", updatedAt: "2026-08-10" },
        { slug: "project/new/state", updatedAt: "2026-08-09" },
      ],
    }),
    get: async (slug) => {
      if (slug === "project/old/state") return { ok: true, content: archived };
      if (slug === "project/new/state") return { ok: true, content: CARD };
      return { ok: false };
    },
  });
  const r = await collectActiveProjects(g);
  expect(r).toHaveLength(1);
  expect(r[0].id).toBe("new");
});

test("collectActiveProjects: skips hub archived project ids", async () => {
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [{ slug: "project/paused/state", updatedAt: "2026-08-10" }],
    }),
    get: async () => ({ ok: true, content: CARD }),
  });
  const r = await collectActiveProjects(g, { excludeProjectIds: new Set(["paused"]) });
  expect(r).toEqual([]);
});

test("parseNoteTags / isArchivedGbrainNote", () => {
  expect(parseNoteTags(CARD)).toEqual(["project"]);
  const tagged = CARD.replace("tags: [project]", "tags: [project, status:archived]");
  expect(isArchivedGbrainNote(tagged)).toBe(true);
  expect(isArchivedGbrainNote(CARD)).toBe(false);
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

const PROFILE = `---
type: note
tags: [profile]
---

# 沟通偏好

一句话：先结论后细节。
`;

test("collectActiveProfiles: filters profile/<theme>, drops nested slugs", async () => {
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        { slug: "profile/沟通偏好", updatedAt: "2026-08-10" },
        { slug: "profile/报告格式/nested", updatedAt: "2026-08-09" }, // nested — drop
        { slug: "knowledge/governance/x", updatedAt: "2026-08-09" },
        { slug: "profile/报告格式", updatedAt: "2026-08-08" },
      ],
    }),
    get: async (slug) =>
      slug === "profile/沟通偏好" ? { ok: true, content: PROFILE } : { ok: false },
  });
  const r = await collectActiveProfiles(g);
  expect(r).toHaveLength(2);
  expect(r[0]).toEqual({ theme: "沟通偏好", summary: "一句话：先结论后细节。", updatedAt: "2026-08-10" });
  expect(r[1]).toEqual({ theme: "报告格式", summary: "", updatedAt: "2026-08-08" });
});

test("collectActiveProfiles: list failure or throw -> empty, never throws", async () => {
  expect(await collectActiveProfiles(fakeGbrain({ list: async () => ({ ok: false, error: "lock" }) }))).toEqual([]);
  expect(await collectActiveProfiles(fakeGbrain({ list: async () => ({ ok: true, rows: [] }) }))).toEqual([]);
  expect(
    await collectActiveProfiles(fakeGbrain({ list: async () => ({ ok: true, rows: [{ slug: "knowledge/x", updatedAt: "d" }] }) })),
  ).toEqual([]);
  expect(
    await collectActiveProfiles(
      fakeGbrain({
        list: async () => {
          throw new Error("boom");
        },
      }),
    ),
  ).toEqual([]);
});

test("collectActiveProfiles: caps at MAX_ACTIVE_PROFILES", async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ slug: `profile/t${i}`, updatedAt: `2026-08-${i + 1}` }));
  const g = fakeGbrain({ list: async () => ({ ok: true, rows }) });
  const r = await collectActiveProfiles(g);
  expect(r).toHaveLength(MAX_ACTIVE_PROFILES);
  expect(r.map((p) => p.theme)).toEqual(["t0", "t1", "t2", "t3"]); // recency = list order, not last-N
  expect(MAX_ACTIVE_PROFILES).toBe(4);
  expect(MAX_ACTIVE_PROJECTS).toBe(8); // independent budget
});

test("collectActiveProfiles: skips archived/weekly and backfills slots", async () => {
  const archived = `---
type: note
tags: [profile, status:archived]
---
# old
不应注入。
`;
  const weekly = `---
type: note
tags: [profile, weekly]
---
# weekly-ish
不应注入。
`;
  const live = PROFILE;
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        // First MAX_ACTIVE_PROFILES rows are skips — must not consume the cap
        { slug: "profile/old", updatedAt: "2026-08-10" },
        { slug: "profile/snap", updatedAt: "2026-08-09" },
        { slug: "profile/old2", updatedAt: "2026-08-08" },
        { slug: "profile/snap2", updatedAt: "2026-08-07" },
        { slug: "profile/沟通偏好", updatedAt: "2026-08-06" },
        { slug: "profile/报告格式", updatedAt: "2026-08-05" },
        { slug: "profile/extra", updatedAt: "2026-08-04" },
        { slug: "profile/overflow", updatedAt: "2026-08-03" },
        { slug: "profile/too-many", updatedAt: "2026-08-02" },
      ],
    }),
    get: async (slug) => {
      if (slug === "profile/old" || slug === "profile/old2") return { ok: true, content: archived };
      if (slug === "profile/snap" || slug === "profile/snap2") return { ok: true, content: weekly };
      if (slug === "profile/沟通偏好") return { ok: true, content: live };
      return { ok: false };
    },
  });
  const r = await collectActiveProfiles(g);
  expect(r).toHaveLength(MAX_ACTIVE_PROFILES);
  expect(r.map((p) => p.theme)).toEqual(["沟通偏好", "报告格式", "extra", "overflow"]);
});

test("collectActiveProfiles: get failure still yields the theme (recency is the signal)", async () => {
  const g = fakeGbrain({
    list: async () => ({ ok: true, rows: [{ slug: "profile/沟通偏好", updatedAt: "2026-08-10" }] }),
    get: async () => ({ ok: false }),
  });
  const r = await collectActiveProfiles(g);
  expect(r).toEqual([{ theme: "沟通偏好", summary: "", updatedAt: "2026-08-10" }]);
});

test("summarizeProfilePage: first non-heading line, truncated at 80 chars", () => {
  expect(summarizeProfilePage(PROFILE)).toBe("一句话：先结论后细节。");
  const long = PROFILE.replace("一句话：先结论后细节。", "字".repeat(120));
  const s = summarizeProfilePage(long);
  expect(s.length).toBe(81);
  expect(s.endsWith("…")).toBe(true);
  // unlike summarizeStateCard, does not seek ## 现在到哪了
  const withNow = `---
tags: [profile]
---
# 主题
偏好正文。
## 现在到哪了
项目进度不该当偏好摘要。
`;
  expect(summarizeProfilePage(withNow)).toBe("偏好正文。");
  expect(summarizeStateCard(withNow)).toBe("项目进度不该当偏好摘要。");
});
