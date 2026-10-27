// application/context/project-states.pagination.test.ts — cross-layer regression
// for the session-start "recent" collectors: real adapter + real collector over
// an injected gbrain process. The old defect was invisible to unit tests because
// the adapter request shape and the collector's page selection were never
// exercised together.
import { expect, test } from "bun:test";
import type { SpawnOpts, SpawnResult } from "../../adapters/process/spawn.ts";
import { realGbrain, type GbrainRun } from "../../adapters/gbrain/gbrain.ts";
import {
  collectActiveProjects,
  collectRecentKnowledge,
  createContextReadBudget,
} from "./project-states.ts";

interface StoredRow {
  slug: string;
  updatedAt: string;
  content?: string;
}

interface ServerOptions {
  rows: StoredRow[];
  /** 0-based index of the list call: return a typed failure for that call. */
  listFailures?: Record<number, { code: string; message: string }>;
  /** Slugs whose body read fails (known candidate, unreadable body). */
  getFailures?: Set<string>;
  listDelayMs?: number;
  /** Emulate a shifted desc dataset: every page after the first starts one row
   *  earlier, so the previous boundary row is returned twice. */
  shiftAfterFirstPage?: boolean;
}

interface RecordedCall {
  method: string;
  args: Record<string, unknown>;
  timeoutMs: number;
}

const okRes = (value: unknown): SpawnResult => {
  const stdout = JSON.stringify(value);
  return { exit: 0, output: stdout, stdout, stderr: "", timedOut: false, stalled: false, forced: false };
};

const failRes = (code: string, message: string): SpawnResult => ({
  exit: 1,
  output: "",
  stdout: "",
  stderr: JSON.stringify({ code, message }),
  timedOut: false,
  stalled: false,
  forced: false,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A tiny but honest gbrain: it orders by `updatedAt` and honours `sort`,
 *  `offset` and `limit`. Tests can therefore observe the request the collector
 *  actually makes instead of handing it a pre-sliced array. */
function fakeGbrainServer(opts: ServerOptions): { run: GbrainRun; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let listCall = 0;
  const ordered = [...opts.rows].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));

  const run: GbrainRun = async (argv, spawn: SpawnOpts) => {
    const method = argv[2] ?? "";
    const args = JSON.parse(argv[3] ?? "{}") as Record<string, unknown>;
    const timeoutMs = spawn.timeoutMs ?? 0;
    calls.push({ method, args, timeoutMs });

    if (method === "list_pages") {
      const callIndex = listCall++;
      const failure = opts.listFailures?.[callIndex];
      if (failure !== undefined) return failRes(failure.code, failure.message);
      const limit = typeof args.limit === "number" ? args.limit : 100;
      const sort = typeof args.sort === "string" ? args.sort : "updated_asc";
      const requestedOffset = typeof args.offset === "number" ? args.offset : 0;
      const offset =
        opts.shiftAfterFirstPage === true && callIndex > 0 ? Math.max(0, requestedOffset - 1) : requestedOffset;
      if (opts.listDelayMs !== undefined) {
        if (opts.listDelayMs >= timeoutMs) {
          await sleep(Math.max(1, timeoutMs));
          return { exit: 0, output: "", stdout: "", stderr: "", timedOut: true, stalled: false, forced: false };
        }
        await sleep(opts.listDelayMs);
      }
      const ascRows = (sort === "updated_desc" ? [...ordered].reverse() : ordered).slice(offset, offset + limit);
      return okRes(ascRows.map((r) => ({ slug: r.slug, type: "note", title: r.slug, updated_at_iso: r.updatedAt })));
    }

    if (method === "get_page") {
      const slug = typeof args.slug === "string" ? args.slug : "";
      if (opts.getFailures?.has(slug)) return failRes("page_not_found", `page not found: ${slug}`);
      const row = opts.rows.find((r) => r.slug === slug);
      if (row === undefined) return failRes("page_not_found", `page not found: ${slug}`);
      return okRes({
        page: {
          slug,
          revision: "revision-1",
          content_hash: "hash-1",
          content: row.content ?? "",
          tags: [],
          updated_at_iso: row.updatedAt,
        },
      });
    }

    return okRes({ ok: true });
  };

  return { run, calls };
}

/** State card with an explicit summary line and an optional lifecycle tag. */
function card(summary: string, tags: string[] = ["project"]): string {
  return `---\ntype: note\ntags: [${tags.join(", ")}]\n---\n\n# 卡片\n\n## 现在到哪了\n${summary}\n\n## 下一步\n继续\n`;
}

function projectRow(index: number, extra: { archived?: boolean } = {}): StoredRow {
  const id = `p${index}`;
  return {
    slug: `project/${id}/state`,
    updatedAt: `2026-10-${String(index).padStart(2, "0")}T00:00:00Z`,
    content: card(`${id} 现状`, extra.archived === true ? ["project", "status:archived"] : ["project"]),
  };
}

test("cross-layer: a descending window surfaces the newest 8 of 9 projects", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => projectRow(i + 1));
  const server = fakeGbrainServer({ rows });
  const gbrain = realGbrain(server.run, 2000);

  const result = await collectActiveProjects(gbrain);

  // The list request itself must be a recent-first window, not the audit order.
  const listCall = server.calls.find((c) => c.method === "list_pages");
  expect(listCall?.args.sort).toBe("updated_desc");
  expect(listCall?.args.offset).toBeUndefined();
  // Old behaviour returned p1..p8 and silently dropped the newest card.
  expect(result.items.map((p) => p.id)).toEqual(["p9", "p8", "p7", "p6", "p5", "p4", "p3", "p2"]);
  expect(result.status).toBe("complete");
  expect(result.issues).toEqual([]);
  expect(result.stats.pagesRead).toBe(1);
});

test("cross-layer: 6 knowledge pages yield the newest 5", async () => {
  const rows: StoredRow[] = Array.from({ length: 6 }, (_, i) => ({
    slug: `knowledge/topic-${i + 1}`,
    updatedAt: `2026-10-0${i + 1}T00:00:00Z`,
    content: `---\ntype: knowledge\ntags: [knowledge]\n---\n\n知识 ${i + 1}\n`,
  }));
  const server = fakeGbrainServer({ rows });
  const result = await collectRecentKnowledge(realGbrain(server.run, 2000));

  expect(result.items.map((k) => k.slug)).toEqual([
    "knowledge/topic-6",
    "knowledge/topic-5",
    "knowledge/topic-4",
    "knowledge/topic-3",
    "knowledge/topic-2",
  ]);
  expect(result.status).toBe("complete");
});

test("cross-layer: a state card on the second page is found and marked partial", async () => {
  const noise: StoredRow[] = Array.from({ length: 100 }, (_, i) => ({
    slug: `project/noise${i}/decisions/d${i}`,
    updatedAt: `2026-09-30T${String(i % 24).padStart(2, "0")}:00:00Z`,
    content: "---\ntype: note\ntags: [project]\n---\n\nnoise\n",
  }));
  const state = projectRow(5);
  const server = fakeGbrainServer({ rows: [...noise, state] });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items.map((p) => p.id)).toEqual(["p5"]);
  expect(result.status).toBe("partial");
  expect(result.issues.map((i) => i.kind)).toContain("desc_offset");
  expect(result.stats.pagesRead).toBe(2);
  // Namespace filtering happens before body reads: noise rows cost zero gets.
  expect(server.calls.filter((c) => c.method === "get_page")).toHaveLength(1);
});

test("cross-layer: archived cards are skipped and backfilled without consuming slots", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => projectRow(i + 1, { archived: i === 8 }));
  const server = fakeGbrainServer({ rows });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items.map((p) => p.id)).toEqual(["p8", "p7", "p6", "p5", "p4", "p3", "p2", "p1"]);
  expect(result.status).toBe("complete");
});

test("cross-layer: an unreadable body keeps the candidate id but degrades to partial", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => projectRow(i + 1));
  const server = fakeGbrainServer({ rows, getFailures: new Set(["project/p5/state"]) });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items.map((p) => p.id)).toEqual(["p9", "p8", "p7", "p6", "p5", "p4", "p3", "p2"]);
  expect(result.items.find((p) => p.id === "p5")?.summary).toBe("");
  expect(result.status).toBe("partial");
  expect(result.issues.map((i) => i.kind)).toContain("page_read_error");
});

test("cross-layer: the candidate budget stops a page of archived cards after 12 gets", async () => {
  const rows: StoredRow[] = Array.from({ length: 100 }, (_, i) => ({
    slug: `project/arch${i}/state`,
    updatedAt: `2026-09-30T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    content: card(`arch ${i}`, ["project", "status:archived"]),
  }));
  const server = fakeGbrainServer({ rows });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  const gets = server.calls.filter((c) => c.method === "get_page").length;
  expect(gets).toBe(12);
  expect(result.items).toEqual([]);
  expect(result.status).toBe("partial");
  expect(result.issues.map((i) => i.kind)).toContain("candidate_budget");
});

test("cross-layer: a second-page list failure keeps the first page and marks partial", async () => {
  const noise: StoredRow[] = Array.from({ length: 100 }, (_, i) => ({
    slug: `project/noise${i}/decisions/d${i}`,
    updatedAt: `2026-09-30T${String(i % 24).padStart(2, "0")}:00:00Z`,
  }));
  const server = fakeGbrainServer({ rows: noise, listFailures: { 1: { code: "lock", message: "locked" } } });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items).toEqual([]);
  expect(result.status).toBe("partial");
  expect(result.issues).toContainEqual({ kind: "later_list_error", code: "lock" });
});

test("cross-layer: a shifted dataset (repeated boundary) is reported as page drift", async () => {
  const noise: StoredRow[] = Array.from({ length: 100 }, (_, i) => ({
    slug: `project/noise${i}/decisions/d${i}`,
    updatedAt: `2026-09-30T${String(i % 24).padStart(2, "0")}:00:00Z`,
  }));
  const state = projectRow(5);
  const server = fakeGbrainServer({ rows: [...noise, state], shiftAfterFirstPage: true });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items.map((p) => p.id)).toEqual(["p5"]);
  expect(result.status).toBe("partial");
  expect(result.issues.map((i) => i.kind)).toContain("page_drift");
});

test("cross-layer: a stalled first list fails inside the deadline without a retry", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => projectRow(i + 1));
  const server = fakeGbrainServer({ rows, listDelayMs: 500 });
  const budget = createContextReadBudget({ deadlineMs: 60 });
  const started = Date.now();
  const result = await collectActiveProjects(realGbrain(server.run, 2000), { budget });

  expect(Date.now() - started).toBeLessThan(600);
  expect(result.items).toEqual([]);
  expect(result.status).toBe("failed");
  expect(result.issues).toContainEqual({ kind: "list_error", code: "timeout" });
  // Every call is bounded by min(2s, remaining deadline), never a fresh 2s.
  for (const call of server.calls) expect(call.timeoutMs).toBeLessThanOrEqual(2000);
  expect(server.calls[0]!.timeoutMs).toBeLessThanOrEqual(60);
  expect(server.calls).toHaveLength(1);
});

test("cross-layer: a full second page with more to come stops at the page budget", async () => {
  const noise: StoredRow[] = Array.from({ length: 200 }, (_, i) => ({
    slug: `project/noise${i}/decisions/d${i}`,
    updatedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const server = fakeGbrainServer({ rows: noise });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.stats.pagesRead).toBe(2);
  expect(result.status).toBe("partial");
  expect(result.issues.map((i) => i.kind)).toContain("page_budget");
});

test("cross-layer: a first-page lock failure is failed, not an empty complete set", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => projectRow(i + 1));
  const server = fakeGbrainServer({ rows, listFailures: { 0: { code: "lock", message: "locked" } } });
  const result = await collectActiveProjects(realGbrain(server.run, 2000));

  expect(result.items).toEqual([]);
  expect(result.status).toBe("failed");
  expect(result.issues).toContainEqual({ kind: "list_error", code: "lock" });
  expect(server.calls.filter((c) => c.method === "get_page")).toHaveLength(0);
});

test("budget: 12/8/12 per dimension and 32 in total, reserved atomically", () => {
  const budget = createContextReadBudget();
  expect(budget.reserveCandidates("projects", 100)).toBe(12);
  expect(budget.reserveCandidates("projects", 1)).toBe(0);
  expect(budget.reserveCandidates("profiles", 100)).toBe(8);
  expect(budget.reserveCandidates("knowledge", 100)).toBe(12);
  // 32 spent in total: the next reservation is refused even if a dimension had room.
  const spike = createContextReadBudget({ totalCandidates: 5 });
  expect(spike.reserveCandidates("projects", 5)).toBe(5);
  expect(spike.reserveCandidates("profiles", 1)).toBe(0);
  // A short deadline shrinks the per-call timeout but never below 1ms.
  const tight = createContextReadBudget({ deadlineMs: 30 });
  expect(tight.callTimeoutMs()).toBeLessThanOrEqual(2000);
  expect(tight.callTimeoutMs()).toBeGreaterThan(0);
});
