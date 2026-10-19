// adapters/gbrain/gbrain.test.ts — structured `gbrain call` adapter contract.
// The real CLI/store is never invoked; the process runner is injected.
import { expect, test } from "bun:test";
import type { SpawnOpts, SpawnResult } from "../process/spawn.ts";
import { realGbrain, resolveGbrainCliBin, type GbrainRun } from "./gbrain.ts";

type Call = { argv: string[]; opts: SpawnOpts };

function fakeRun(impl: (argv: string[], opts: SpawnOpts) => SpawnResult): { run: GbrainRun; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: (argv, opts) => {
      calls.push({ argv, opts });
      return Promise.resolve(impl(argv, opts));
    },
  };
}

const okRes = (value: unknown): SpawnResult => {
  const stdout = typeof value === "string" ? value : JSON.stringify(value);
  return { exit: 0, output: stdout, stdout, stderr: "", timedOut: false };
};

const failRes = (code: string, message: string): SpawnResult => ({
  exit: 1,
  output: "",
  stdout: "",
  stderr: JSON.stringify({ code, message }),
  timedOut: false,
});

function argsOf(call: Call): Record<string, unknown> {
  return JSON.parse(call.argv[3] ?? "{}") as Record<string, unknown>;
}

const PAGE = {
  slug: "assets/foo/doc",
  revision: "revision-7",
  content_hash: "abc123",
  content: "---\ntitle: Doc\n---\nbody",
  tags: ["asset", "source:session"],
  type: "note",
  title: "Doc",
  updated_at_iso: "2026-10-18T10:00:00Z",
  origin: "cli:put_page:user_said",
  trust_tier: "agent_written",
};

test("getPage calls get_page with include_content and parses the typed page", async () => {
  const { run, calls } = fakeRun(() => okRes({ page: PAGE }));
  const g = realGbrain(run, 1234);
  const r = await g.getPage("assets/foo/doc");
  expect(r).toEqual({
    ok: true,
    page: {
      slug: "assets/foo/doc",
      revision: "revision-7",
      contentHash: "abc123",
      content: "---\ntitle: Doc\n---\nbody",
      tags: ["asset", "source:session"],
      type: "note",
      title: "Doc",
      updatedAt: "2026-10-18T10:00:00Z",
      origin: "cli:put_page:user_said",
      trustTier: "agent_written",
    },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.argv.slice(0, 3)).toEqual(["gbrain", "call", "get_page"]);
  expect(argsOf(calls[0]!)).toEqual({ slug: "assets/foo/doc", include_content: true });
  expect(calls[0]!.opts.timeoutMs).toBe(1234);
  expect(calls[0]!.opts.input).toBeUndefined();
});

test("getPage normalizes page_not_found from JSON stderr", async () => {
  const { run } = fakeRun(() => failRes("page_not_found", "page not found"));
  const r = await realGbrain(run).getPage("missing");
  expect(r).toEqual({ ok: false, code: "not_found", message: "page not found", rawCode: "page_not_found" });
});

test("getPage timeout is typed and never hangs the hook", async () => {
  const { run } = fakeRun(() => ({ exit: 0, output: "", stdout: "", stderr: "", timedOut: true }));
  const r = await realGbrain(run, 17).getPage("x");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("timeout");
});

test("getPage rejects non-JSON or incomplete successful output as schema_error", async () => {
  const nonJson = await realGbrain(fakeRun(() => okRes("page body")).run).getPage("x");
  expect(nonJson.ok).toBe(false);
  if (!nonJson.ok) expect(nonJson.code).toBe("schema_error");

  const incomplete = await realGbrain(fakeRun(() => okRes({ slug: "x", revision: "revision-1" })).run).getPage("x");
  expect(incomplete.ok).toBe(false);
  if (!incomplete.ok) expect(incomplete.code).toBe("schema_error");

  const numericRevision = await realGbrain(
    fakeRun(() =>
      okRes({
        slug: "x",
        revision: 1,
        content_hash: "hash",
        content: "body",
      }),
    ).run,
  ).getPage("x");
  expect(numericRevision.ok).toBe(false);
  if (!numericRevision.ok) expect(numericRevision.code).toBe("schema_error");
});

test("putPage sends the full write intent and parses its receipt", async () => {
  const { run, calls } = fakeRun(() =>
    okRes({
      state: "committed",
      revision: "revision-8",
      request_id: "11111111-1111-4111-8111-111111111111",
      operation: "update",
      outcome: "created_or_updated",
    }),
  );
  const g = realGbrain(run, 5000);
  const r = await g.putPage({
    slug: "assets/foo/doc",
    content: "body",
    requestId: "11111111-1111-4111-8111-111111111111",
    contentOrigin: "tool_output",
    sourceId: "jspace:pending:test:1",
    expectedRevision: "revision-7",
  });
  expect(r).toEqual({
    ok: true,
    requestId: "11111111-1111-4111-8111-111111111111",
    state: "committed",
    revision: "revision-8",
    operation: "update",
    outcome: "created_or_updated",
  });
  expect(calls[0]!.argv.slice(0, 3)).toEqual(["gbrain", "call", "put_page"]);
  expect(argsOf(calls[0]!)).toEqual({
    slug: "assets/foo/doc",
    content: "body",
    request_id: "11111111-1111-4111-8111-111111111111",
    content_origin: "tool_output",
    source_id: "jspace:pending:test:1",
    expected_revision: "revision-7",
  });
});

test("putPage preserves semantic errors and does not retry another protocol", async () => {
  const { run, calls } = fakeRun(() => failRes("revision_conflict", "revision changed"));
  const r = await realGbrain(run).putPage({
    slug: "x",
    content: "body",
    requestId: "11111111-1111-4111-8111-111111111111",
    contentOrigin: "inferred",
    sourceId: "test",
    expectedRevision: "revision-1",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("revision_conflict");
  expect(calls).toHaveLength(1);
});

test("listPages uses updated_asc keyset and exposes a continuation cursor", async () => {
  const { run, calls } = fakeRun(() =>
    okRes([
      { slug: "a/one", type: "note", title: "One", updated_at_iso: "2026-10-18T10:00:00Z" },
      { slug: "a/two", type: "note", title: "Two", updated_at_iso: "2026-10-18T11:00:00Z" },
    ]),
  );
  const g = realGbrain(run, 2000);
  const r = await g.listPages({
    tag: "project",
    limit: 2,
    cursor: { updatedAfter: "2026-10-17T00:00:00Z", updatedAfterSlug: "a/zero" },
  });
  expect(r).toEqual({
    ok: true,
    rows: [
      { slug: "a/one", type: "note", title: "One", updatedAt: "2026-10-18T10:00:00Z" },
      { slug: "a/two", type: "note", title: "Two", updatedAt: "2026-10-18T11:00:00Z" },
    ],
    nextCursor: { updatedAfter: "2026-10-18T11:00:00Z", updatedAfterSlug: "a/two" },
  });
  expect(calls[0]!.argv.slice(0, 3)).toEqual(["gbrain", "call", "list_pages"]);
  expect(argsOf(calls[0]!)).toEqual({
    limit: 2,
    sort: "updated_asc",
    tag: "project",
    updated_after: "2026-10-17T00:00:00Z",
    updated_after_slug: "a/zero",
  });
});

test("listPages accepts a short empty page and does not invent a cursor", async () => {
  const r = await realGbrain(fakeRun(() => okRes([])).run).listPages({ tag: "project" });
  expect(r).toEqual({ ok: true, rows: [] });
});

test("listPages rejects invalid row payloads", async () => {
  const r = await realGbrain(fakeRun(() => okRes([{ slug: "x" }])).run).listPages();
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("schema_error");
});

test("getWriteRequest parses committed receipts and preserves not_found", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const found = await realGbrain(
    fakeRun(() =>
      okRes({
        request: {
          request_id: requestId,
          state: "committed",
          revision: "revision-9",
          operation: "update",
          outcome: "created_or_updated",
          slug: "assets/foo/doc",
        },
      }),
    ).run,
  ).getWriteRequest(requestId);
  expect(found).toEqual({
    ok: true,
    receipt: {
      requestId,
      state: "committed",
      revision: "revision-9",
      operation: "update",
      outcome: "created_or_updated",
      slug: "assets/foo/doc",
    },
  });

  const missing = await realGbrain(fakeRun(() => failRes("not_found", "unknown request")).run).getWriteRequest(requestId);
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.code).toBe("not_found");
});

test("getBacklinks preserves cursor, truncation, total and coverage", async () => {
  const { run, calls } = fakeRun(() =>
    okRes({
      rows: [{ slug: "knowledge/new", title: "New" }, { slug: "knowledge/newer" }],
      total: 3,
      truncated: true,
      cursor: "next-page",
      coverage: { state: "degraded", degraded: true },
    }),
  );
  const r = await realGbrain(run).getBacklinks("knowledge/old", { limit: 2, cursor: "page-1" });
  expect(r).toEqual({
    ok: true,
    rows: [{ slug: "knowledge/new", title: "New" }, { slug: "knowledge/newer" }],
    total: 3,
    truncated: true,
    cursor: "next-page",
    coverage: { state: "degraded", degraded: true },
  });
  expect(calls[0]!.argv.slice(0, 3)).toEqual(["gbrain", "call", "get_backlinks"]);
  expect(argsOf(calls[0]!)).toEqual({
    slug: "knowledge/old",
    group: "page",
    limit: 2,
    cursor: "page-1",
  });
});

test("explicit bin arg overrides argv[0] for every operation", async () => {
  const { run, calls } = fakeRun((argv) => {
    const method = argv[2];
    if (method === "get_page") return okRes({ page: PAGE });
    if (method === "put_page") return okRes({ state: "committed", revision: "revision-1" });
    if (method === "list_pages") return okRes([]);
    if (method === "get_write_request") return okRes({ request_id: "r", state: "staged" });
    return okRes({ rows: [], total: 0, truncated: false, coverage: { state: "complete", degraded: false } });
  });
  const g = realGbrain(run, 1000, "/opt/kb/gbrain");
  await g.getPage("x");
  await g.putPage({
    slug: "x",
    content: "body",
    requestId: "r",
    contentOrigin: "inferred",
    sourceId: "test",
  });
  await g.listPages();
  await g.getWriteRequest("r");
  await g.getBacklinks("x");
  expect(calls.map((c) => c.argv[0])).toEqual([
    "/opt/kb/gbrain",
    "/opt/kb/gbrain",
    "/opt/kb/gbrain",
    "/opt/kb/gbrain",
    "/opt/kb/gbrain",
  ]);
});

test("resolveGbrainCliBin: $GBRAIN_BIN trimmed; blank/undefined falls back to bare gbrain", () => {
  expect(resolveGbrainCliBin("/tmp/custom-gbrain")).toBe("/tmp/custom-gbrain");
  expect(resolveGbrainCliBin("  /tmp/custom-gbrain  ")).toBe("/tmp/custom-gbrain");
  expect(resolveGbrainCliBin(undefined)).toBe("gbrain");
  expect(resolveGbrainCliBin("")).toBe("gbrain");
  expect(resolveGbrainCliBin("   ")).toBe("gbrain");
});

test("realGbrain default bin follows $GBRAIN_BIN at construction time", async () => {
  const prev = process.env.GBRAIN_BIN;
  const { run, calls } = fakeRun(() => okRes({ page: PAGE }));
  try {
    process.env.GBRAIN_BIN = "/tmp/custom-gbrain";
    const g = realGbrain(run);
    await g.getPage("x");
    expect(calls[0]!.argv[0]).toBe("/tmp/custom-gbrain");
  } finally {
    if (prev === undefined) delete process.env.GBRAIN_BIN;
    else process.env.GBRAIN_BIN = prev;
  }
});
