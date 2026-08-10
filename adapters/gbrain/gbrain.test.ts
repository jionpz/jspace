// adapters/gbrain/gbrain.test.ts — realGbrain wiring (get reads stdout, put
// feeds stdin, timeout/cap flow through the process adapter) via an injected
// fake runner — the real gbrain CLI is never invoked.
// Run: bun test adapters/gbrain/gbrain.test.ts
import { expect, test } from "bun:test";
import { realGbrain, type GbrainRun } from "./gbrain.ts";
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
