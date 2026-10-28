// application/context/project-states.test.ts — R3 project state collection.
// Run: bun test application/context/project-states.test.ts
import { expect, test } from "bun:test";
import type {
  GbrainDeps,
  GbrainListOptions,
  GbrainListRow,
} from "../../core/contracts/gbrain.ts";
import {
  collectActiveProjects,
  collectActiveProfiles,
  collectRecentKnowledge,
  summarizeStateCard,
  summarizeProfilePage,
  isArchivedGbrainNote,
  parseNoteTags,
  MAX_ACTIVE_PROJECTS,
  MAX_ACTIVE_PROFILES,
  MAX_RECENT_KNOWLEDGE,
  PROJECT_COLLECT_TIMEOUT_MS,
  type ProfileState,
  type ProjectState,
  type RecentKnowledgeEntry,
} from "./project-states.ts";

type TestListResult =
  | { ok: true; rows: Pick<GbrainListRow, "slug" | "updatedAt">[] }
  | { ok: false; error?: string };

type TestPageResult =
  | { ok: true; content: string }
  | { ok: false };

interface TestOverrides {
  list?: (opts?: GbrainListOptions) => TestListResult | Promise<TestListResult>;
  get?: (slug: string) => TestPageResult | Promise<TestPageResult>;
}

function fakeGbrain(over: TestOverrides = {}): GbrainDeps {
  return {
    getPage: async (slug) => {
      const result = over.get ? await over.get(slug) : { ok: false as const };
      if (!result.ok) return { ok: false, code: "not_found", message: "not found" };
      return {
        ok: true,
        page: {
          slug,
          revision: "revision-1",
          contentHash: "hash",
          content: result.content,
          tags: [],
        },
      };
    },
    listPages: async (opts) => {
      const result = over.list ? await over.list(opts) : { ok: true as const, rows: [] };
      return result.ok
        ? { ok: true, rows: result.rows }
        : { ok: false, code: "process_error", message: result.error ?? "list failed" };
    },
    putPage: async (input) => ({
      ok: true,
      requestId: input.requestId,
      state: "committed",
      revision: "revision-1",
    }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "not found" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

/** This file pins selection / backfill semantics; the read-status matrix lives
 *  in project-states.pagination.test.ts, so assertions here read `items`. */
async function collectProjects(
  g: GbrainDeps,
  o?: Parameters<typeof collectActiveProjects>[1],
): Promise<ProjectState[]> {
  return (await collectActiveProjects(g, o)).items;
}
async function collectProfiles(g: GbrainDeps): Promise<ProfileState[]> {
  return (await collectActiveProfiles(g)).items;
}
async function collectKnowledge(g: GbrainDeps): Promise<RecentKnowledgeEntry[]> {
  return (await collectRecentKnowledge(g)).items;
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
  const r = await collectProjects(g);
  expect(r).toHaveLength(2);
  expect(r[0]).toEqual({ id: "jspace", summary: "记忆模型重构设计期,P1 任务规划完成。", updatedAt: "2026-08-10" });
  expect(r[1]).toEqual({ id: "wms", summary: "", updatedAt: "2026-08-05" });
});

test("collectActiveProjects: list failure or no state cards -> empty, never throws", async () => {
  expect(await collectProjects(fakeGbrain({ list: async () => ({ ok: false, error: "lock" }) }))).toEqual([]);
  expect(await collectProjects(fakeGbrain({ list: async () => ({ ok: true, rows: [] }) }))).toEqual([]);
  expect(
    await collectProjects(fakeGbrain({ list: async () => ({ ok: true, rows: [{ slug: "knowledge/x", updatedAt: "d" }] }) })),
  ).toEqual([]);
});

test("collectActiveProjects: caps at MAX_ACTIVE_PROJECTS", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ slug: `project/p${i}/state`, updatedAt: `2026-08-${i + 1}` }));
  const g = fakeGbrain({ list: async () => ({ ok: true, rows }) });
  const r = await collectProjects(g);
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
  const r = await collectProjects(g);
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
  const r = await collectProjects(g, { excludeProjectIds: new Set(["paused"]) });
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
  const r = await collectProjects(g);
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
  const r = await collectProfiles(g);
  expect(r).toHaveLength(2);
  expect(r[0]).toEqual({ theme: "沟通偏好", summary: "一句话：先结论后细节。", updatedAt: "2026-08-10" });
  expect(r[1]).toEqual({ theme: "报告格式", summary: "", updatedAt: "2026-08-08" });
});

test("collectActiveProfiles: list failure or throw -> empty, never throws", async () => {
  expect(await collectProfiles(fakeGbrain({ list: async () => ({ ok: false, error: "lock" }) }))).toEqual([]);
  expect(await collectProfiles(fakeGbrain({ list: async () => ({ ok: true, rows: [] }) }))).toEqual([]);
  expect(
    await collectProfiles(fakeGbrain({ list: async () => ({ ok: true, rows: [{ slug: "knowledge/x", updatedAt: "d" }] }) })),
  ).toEqual([]);
  expect(
    await collectProfiles(
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
  const r = await collectProfiles(g);
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
  const r = await collectProfiles(g);
  expect(r).toHaveLength(MAX_ACTIVE_PROFILES);
  expect(r.map((p) => p.theme)).toEqual(["沟通偏好", "报告格式", "extra", "overflow"]);
});

test("collectActiveProfiles: get failure still yields the theme (recency is the signal)", async () => {
  const g = fakeGbrain({
    list: async () => ({ ok: true, rows: [{ slug: "profile/沟通偏好", updatedAt: "2026-08-10" }] }),
    get: async () => ({ ok: false }),
  });
  const r = await collectProfiles(g);
  expect(r).toEqual([{ theme: "沟通偏好", summary: "", updatedAt: "2026-08-10" }]);
});

test("collectRecentKnowledge: filters decisions/lessons/knowledge, skips archived+superseded", async () => {
  const superseded = `---
type: note
tags: [knowledge, status:superseded]
---
# old
旧的。
`;
  const live = `---
type: note
tags: [knowledge]
---
# naming
ascii slug 约定。
`;
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        { slug: "project/acme/decisions/tech-stack", updatedAt: "2026-08-10" },
        { slug: "project/acme/lessons/deploy", updatedAt: "2026-08-09" },
        { slug: "knowledge/governance/naming", updatedAt: "2026-08-08" },
        { slug: "project/acme/state", updatedAt: "2026-08-07" }, // filtered out (state card)
        { slug: "profile/沟通偏好", updatedAt: "2026-08-06" }, // filtered out (profile)
      ],
    }),
    get: async (slug) => {
      if (slug === "knowledge/governance/naming") return { ok: true, content: live };
      if (slug === "project/acme/decisions/tech-stack") return { ok: true, content: superseded };
      return { ok: false };
    },
  });
  const r = await collectKnowledge(g);
  expect(r).toHaveLength(2);
  expect(r.map((k) => k.slug)).toEqual(["project/acme/lessons/deploy", "knowledge/governance/naming"]);
  expect(r[1].summary).toBe("ascii slug 约定。");
});

test("collectRecentKnowledge: failure -> empty, never throws", async () => {
  expect(await collectKnowledge(fakeGbrain({ list: async () => { throw new Error("boom"); } }))).toEqual([]);
  expect(await collectKnowledge(fakeGbrain({ list: async () => ({ ok: false, error: "lock" }) }))).toEqual([]);
});

test("collectRecentKnowledge: caps at MAX_RECENT_KNOWLEDGE", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ slug: `knowledge/k${i}/topic`, updatedAt: `2026-08-${i + 1}` }));
  const g = fakeGbrain({ list: async () => ({ ok: true, rows }) });
  const r = await collectKnowledge(g);
  expect(r).toHaveLength(MAX_RECENT_KNOWLEDGE);
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

// ---- contract: readers must not filter by `type` (2026-09-12 retro) ----
// Writers legitimately produce typed pages (decision/project/lesson/…); an
// earlier read-side `--type note` filter silently dropped every non-note state
// card. These tests pin the port calls so the filter cannot creep back.
test("collectActiveProjects / collectActiveProfiles / collectRecentKnowledge ask gbrain by tag, recent-first, still no type filter", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const g = fakeGbrain({
    list: async (opts) => {
      seen.push(opts as Record<string, unknown>);
      return { ok: true, rows: [] };
    },
  });
  await collectProjects(g);
  await collectProfiles(g);
  await collectKnowledge(g);
  expect(seen.map((o) => ({ tag: o.tag, limit: o.limit, sort: o.sort }))).toEqual([
    { tag: "project", limit: 100, sort: "updated_desc" },
    { tag: "profile", limit: 100, sort: "updated_desc" },
    { tag: "knowledge", limit: 50, sort: "updated_desc" },
  ]);
  for (const opts of seen) {
    expect("type" in opts).toBe(false); // typed pages must never be filtered out
    expect("cursor" in opts).toBe(false); // recent windows never use the audit keyset
    expect("offset" in opts).toBe(false); // first page only
    expect(opts.timeoutMs as number).toBeLessThanOrEqual(PROJECT_COLLECT_TIMEOUT_MS);
  }
});

test("collectActiveProjects: a type: project state card is NOT dropped (agent-infra regression)", async () => {
  const typedCard = CARD.replace("type: note", "type: project").replace("project: jspace", "project: agent-infra");
  const g = fakeGbrain({
    // gbrain applies the tag filter server-side; the reader must not add --type.
    list: async () => ({ ok: true, rows: [{ slug: "project/agent-infra/state", updatedAt: "2026-09-05" }] }),
    get: async () => ({ ok: true, content: typedCard }),
  });
  const r = await collectProjects(g);
  expect(r).toHaveLength(1);
  expect(r[0].id).toBe("agent-infra");
});

// ---- parseNoteTags: both YAML styles the store actually contains ----
test("parseNoteTags handles block-sequence tags and quoted values", () => {
  const block = `---
type: note
project: jspace
tags:
  - retro
  - 'source:session'
  - weekly
---
# x
`;
  expect(parseNoteTags(block)).toEqual(["retro", "source:session", "weekly"]);
  expect(isArchivedGbrainNote(block)).toBe(false);

  // A block-style status:archived must gate injection exactly like the inline form.
  const archivedBlock = `---
tags:
  - project
  - status:archived
---
# old
`;
  expect(isArchivedGbrainNote(archivedBlock)).toBe(true);

  // Inline form keeps working; `status:superseded` is readable either way.
  expect(parseNoteTags(CARD)).toEqual(["project"]);
  const supersededBlock = `---
tags:
  - knowledge
  - status:superseded
---
# x
`;
  expect(parseNoteTags(supersededBlock)).toContain("status:superseded");
});

// ---- canonical-only session-start slots (memory-governance-quality) ----
// Slots are spent on CURRENT answers only. The live store shows why the list
// filter alone is not enough: `list_pages tag=knowledge` never returns an
// `atoms/*` row today (gbrain does not tag its extract output with the routing
// tag), so the derived cases below are the structural invariant — a derived
// page that ever carries the routing tag must still not answer.
//
// `activity:maintenance` is NOT a page class: it marks a housekeeping WRITE and
// sits on 38 live state/lesson/decision pages. A page carrying it is still a
// current answer; only the write-count ledger subtracts it, per write.

test("collectRecentKnowledge: derived atoms, weekly projections and inactive pages never take a slot", async () => {
  const canonical = (body: string, tags: string[] = ["knowledge"]) =>
    `---\ntype: knowledge\ntags: [${tags.join(", ")}]\n---\n\n${body}\n`;
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        // Newest first: every one of these must be skipped.
        { slug: "atoms/2026-09-12/纪律-8ae045b2", updatedAt: "2026-09-12" },
        { slug: "extracts/2026-09-17/atoms/default/x/round-single", updatedAt: "2026-09-11" },
        { slug: "records/consolidate/2026-09-10", updatedAt: "2026-09-10" },
        { slug: "project/acme/decisions/hermes", updatedAt: "2026-09-09" },
        { slug: "project/acme/lessons/old", updatedAt: "2026-09-08" },
        { slug: "project/acme/decisions/older", updatedAt: "2026-09-07" },
        // Eligible canonical pages.
        { slug: "knowledge/testing/反例验证纪律", updatedAt: "2026-09-06" },
        { slug: "project/acme/lessons/retry", updatedAt: "2026-09-05" },
      ],
    }),
    get: async (slug) => {
      if (slug.startsWith("atoms/") || slug.startsWith("extracts/")) {
        return { ok: true, content: canonical("atoms 正文", ["knowledge", "source:cron"]) };
      }
      if (slug === "records/consolidate/2026-09-10") {
        return { ok: true, content: canonical("周快照正文", ["consolidate", "weekly"]) };
      }
      if (slug === "project/acme/decisions/hermes") {
        // Housekeeping touched this page last; it is still the current answer.
        return { ok: true, content: canonical("维护重写正文", ["knowledge", "activity:maintenance"]) };
      }
      if (slug === "project/acme/lessons/old") {
        return { ok: true, content: canonical("旧经验正文", ["knowledge", "status:superseded"]) };
      }
      if (slug === "project/acme/decisions/older") {
        return { ok: true, content: canonical("归档正文", ["knowledge", "status:archived"]) };
      }
      return { ok: true, content: canonical(`${slug} 一句话。`) };
    },
  });
  const r = await collectKnowledge(g);
  expect(r.map((k) => k.slug)).toEqual([
    // 5 slots: the maintenance page takes one, the 4 skipped rows do not.
    "project/acme/decisions/hermes",
    "knowledge/testing/反例验证纪律",
    "project/acme/lessons/retry",
  ]);
  // Skipped rows must not cost the caller a read-back slot, and the window is
  // complete — a filtered result is not a partial read.
  expect(r[0].summary).toBe("维护重写正文");
  expect(r.some((k) => k.slug.startsWith("atoms/"))).toBe(false);
  expect(r.some((k) => k.slug.startsWith("extracts/"))).toBe(false);
  expect(r.some((k) => k.slug === "records/consolidate/2026-09-10")).toBe(false);
});

test("collectRecentKnowledge: an unreadable body is kept, not silently treated as derived", async () => {
  // Unknown != excluded (existing invariant): a read failure must not become a
  // silent skip that makes the payload look complete.
  const g = fakeGbrain({
    list: async () => ({ ok: true, rows: [{ slug: "knowledge/testing/evidence", updatedAt: "2026-09-01" }] }),
    get: async () => ({ ok: false }),
  });
  const r = await collectKnowledge(g);
  expect(r.map((k) => k.slug)).toEqual(["knowledge/testing/evidence"]);
});

test("collectRecentKnowledge: atoms are filtered by slug before any body read", async () => {
  // Structural invariant: a derived page must not answer even if it reaches the
  // `knowledge` tag list, so the body read is never spent on it.
  const read: string[] = [];
  const g = fakeGbrain({
    list: async () => ({
      ok: true,
      rows: [
        { slug: "atoms/2026-09-12/x", updatedAt: "2026-09-12" },
        { slug: "knowledge/testing/live", updatedAt: "2026-09-01" },
      ],
    }),
    get: async (slug) => {
      read.push(slug);
      return { ok: true, content: "---\ntags: [knowledge]\n---\n\n正文。\n" };
    },
  });
  await collectKnowledge(g);
  expect(read).toEqual(["knowledge/testing/live"]);
});
