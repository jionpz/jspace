// adapters/gbrain/gbrain.test.ts — realGbrain wiring (get reads stdout, put
// feeds stdin, timeout/cap flow through the process adapter) via an injected
// fake runner — the real gbrain CLI is never invoked.
// Run: bun test adapters/gbrain/gbrain.test.ts
import { expect, test } from "bun:test";
import { realGbrain, resolveGbrainCliBin, type GbrainRun } from "./gbrain.ts";
import type { SpawnOpts, SpawnResult } from "../process/spawn.ts";

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

const okRes = (stdout = ""): SpawnResult => ({ exit: 0, output: stdout, stdout, stderr: "", timedOut: false });

test("get: exit 0 -> ok with stdout content", async () => {
  const { run } = fakeRun(() => okRes("page body"));
  const g = realGbrain(run, 1234);
  expect(await g.get("assets/foo/doc")).toEqual({ ok: true, content: "page body" });
});

test("get: exit != 0 -> ok false", async () => {
  const { run } = fakeRun(() => ({ exit: 1, output: "", stdout: "", stderr: "no such page", timedOut: false }));
  const g = realGbrain(run);
  expect(await g.get("x")).toEqual({ ok: false });
});

test("get: timedOut -> ok false (a stalled gbrain never hangs the hook, issue #8 #8)", async () => {
  const { run } = fakeRun(() => ({ exit: 0, output: "", stdout: "", stderr: "", timedOut: true }));
  const g = realGbrain(run);
  expect(await g.get("x")).toEqual({ ok: false });
});

test("put: exit 0 -> ok true (stderr noise ignored)", async () => {
  const { run } = fakeRun(() => ({ exit: 0, output: "", stdout: "", stderr: "warning", timedOut: false }));
  const g = realGbrain(run);
  expect(await g.put("x", "content")).toEqual({ ok: true });
});

test("put: exit 1 -> ok false with the error surfaced", async () => {
  const { run } = fakeRun(() => ({ exit: 1, output: "", stdout: "", stderr: "gbrain lock held", timedOut: false }));
  const g = realGbrain(run);
  const r = await g.put("x", "content");
  expect(r.ok).toBe(false);
  expect(r.error).toContain("gbrain lock held");
});

test("put feeds content via stdin and carries the timeout; get passes no stdin", async () => {
  const { run, calls } = fakeRun(() => okRes());
  const g = realGbrain(run, 5000);
  await g.put("assets/foo/doc", "page body");
  expect(calls).toHaveLength(1);
  expect(calls[0].argv).toEqual(["gbrain", "put", "assets/foo/doc"]);
  expect(calls[0].opts.input).toBe("page body");
  expect(calls[0].opts.timeoutMs).toBe(5000);
  await g.get("assets/foo/doc");
  expect(calls).toHaveLength(2);
  expect(calls[1].argv).toEqual(["gbrain", "get", "assets/foo/doc"]);
  expect(calls[1].opts.input).toBeUndefined();
});

test("list: builds filter argv and parses TSV rows (slug/type/date/title)", async () => {
  const { run, calls } = fakeRun(() =>
    okRes("project/jspace/state\tnote\t2026-08-10\tjspace 当前状态\nproject/wms/state\tnote\t2026-08-05\twms 当前状态\n"),
  );
  const g = realGbrain(run, 2000);
  const r = await g.list({ type: "note", tag: "project", limit: 50 });
  expect(r.ok).toBe(true);
  expect(calls[0].argv).toEqual(["gbrain", "list", "--type", "note", "--tag", "project", "--limit", "50"]);
  expect(calls[0].opts.timeoutMs).toBe(2000);
  expect(r.rows).toEqual([
    { slug: "project/jspace/state", updatedAt: "2026-08-10" },
    { slug: "project/wms/state", updatedAt: "2026-08-05" },
  ]);
});

test("list: no filters -> bare gbrain list", async () => {
  const { run, calls } = fakeRun(() => okRes("a/b\tnote\t2026-08-01\ttitle\n"));
  const g = realGbrain(run);
  await g.list();
  expect(calls[0].argv).toEqual(["gbrain", "list"]);
});

test("list: exit != 0 or timeout -> ok false with error", async () => {
  const { run } = fakeRun(() => ({ exit: 1, output: "", stdout: "", stderr: "lock held", timedOut: false }));
  const g = realGbrain(run);
  const r = await g.list({ tag: "project" });
  expect(r.ok).toBe(false);
  expect(r.error).toContain("lock held");
});

test("list: empty output -> ok true, zero rows", async () => {
  const { run } = fakeRun(() => okRes(""));
  const g = realGbrain(run);
  const r = await g.list();
  expect(r.ok).toBe(true);
  expect(r.rows).toEqual([]);
});

test("explicit bin arg overrides argv[0] for get/put/list (CLI shim path)", async () => {
  const { run, calls } = fakeRun(() => okRes("s\tnote\t2026-08-01\tt\n"));
  const g = realGbrain(run, 1000, "/opt/kb/gbrain");
  await g.get("x");
  await g.put("x", "body");
  await g.list();
  expect(calls.map((c) => c.argv[0])).toEqual(["/opt/kb/gbrain", "/opt/kb/gbrain", "/opt/kb/gbrain"]);
});

test("resolveGbrainCliBin: $GBRAIN_BIN trimmed; blank/undefined falls back to bare gbrain", () => {
  expect(resolveGbrainCliBin("/tmp/custom-gbrain")).toBe("/tmp/custom-gbrain");
  expect(resolveGbrainCliBin("  /tmp/custom-gbrain  ")).toBe("/tmp/custom-gbrain");
  expect(resolveGbrainCliBin(undefined)).toBe("gbrain");
  expect(resolveGbrainCliBin("")).toBe("gbrain");
  expect(resolveGbrainCliBin("   ")).toBe("gbrain");
});

test("realGbrain default bin follows $GBRAIN_BIN at call time", async () => {
  const prev = process.env.GBRAIN_BIN;
  const { run, calls } = fakeRun(() => okRes());
  try {
    process.env.GBRAIN_BIN = "/tmp/custom-gbrain";
    const g = realGbrain(run);
    await g.get("x");
    expect(calls[0].argv[0]).toBe("/tmp/custom-gbrain");
  } finally {
    if (prev === undefined) delete process.env.GBRAIN_BIN;
    else process.env.GBRAIN_BIN = prev;
  }
});
