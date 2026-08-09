// application/pending/apply.test.ts — pending envelope stage + applier
// (idempotency, dedupe, retry, terminal-failure, ack). gbrain is a stub; the
// envelopes live in a temp filehub dir only.
// Run: bun test application/pending/apply.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvelopes, stageEnvelope, writeEnvelope } from "./envelope.ts";
import { applyPending, type GbrainDeps } from "./apply.ts";

let fh: string;
beforeEach(() => {
  fh = mkdtempSync(join(tmpdir(), "jspace-pending-"));
});
afterEach(() => {
  rmSync(fh, { recursive: true, force: true });
});

function stub(overrides: Partial<GbrainDeps> = {}) {
  const puts: string[] = [];
  const gets: string[] = [];
  return {
    puts,
    gets,
    deps: {
      get: (slug: string) => {
        gets.push(slug);
        return overrides.get ? overrides.get(slug) : { ok: false };
      },
      put: (slug: string, content: string) => {
        puts.push(slug);
        return overrides.put ? overrides.put(slug, content) : { ok: true };
      },
    } as GbrainDeps,
  };
}

function statuses(): string[] {
  return readEnvelopes(fh).records.map((e) => e.status);
}

test("stage writes a typed APPLY.json envelope (status staged, idempotency key)", () => {
  const env = stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "---\ntype: reference\n---\ncontent");
  expect(env.status).toBe("staged");
  expect(env.idempotencyKey).toHaveLength(64);
  expect(existsSync(join(fh, ".jspace-logs", `${env.id}.APPLY.json`))).toBe(true);
  expect(readEnvelopes(fh).records).toHaveLength(1);
});

test("apply succeeds: put called once, envelope applied", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "content");
  const s = stub();
  const res = applyPending(fh, s.deps);
  expect(s.puts).toEqual(["assets/foo/doc"]);
  expect(res.applied).toHaveLength(1);
  expect(statuses()).toEqual(["applied"]);
});

test("repeat apply is idempotent: applied envelope is skipped, no extra put", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "content");
  const s = stub();
  applyPending(fh, s.deps);
  const res2 = applyPending(fh, s.deps);
  expect(res2.skipped).toHaveLength(1);
  expect(res2.applied).toHaveLength(0);
  expect(s.puts).toHaveLength(1); // no second write
});

test("dedupe: page already holds identical content -> applied without put", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "identical page");
  const s = stub({ get: () => ({ ok: true, content: "identical page" }) });
  const res = applyPending(fh, s.deps);
  expect(s.puts).toHaveLength(0);
  expect(res.deduped).toHaveLength(1);
  expect(statuses()).toEqual(["applied"]);
});

test("existing page with DIFFERENT content is never overwritten -> terminal_failed", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "my new content");
  const s = stub({ get: () => ({ ok: true, content: "some other stored content" }) });
  const res = applyPending(fh, s.deps);
  expect(s.puts).toHaveLength(0); // no overwrite
  expect(res.terminal).toHaveLength(1);
  expect(readEnvelopes(fh).records[0].status).toBe("terminal_failed");
  expect(readEnvelopes(fh).records[0].error).toContain("different content");
});

test("existing EMPTY page counts as absent -> put proceeds (not terminal)", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "real content");
  const s = stub({ get: () => ({ ok: true, content: "" }) }); // empty existing page
  const res = applyPending(fh, s.deps);
  expect(s.puts).toEqual(["assets/foo/doc"]);
  expect(res.applied).toHaveLength(1);
  expect(statuses()).toEqual(["applied"]);
});

test("put failure retries then reaches terminal_failed at MAX_RETRY", () => {
  stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "content");
  const fail = stub({ put: () => ({ ok: false, error: "gbrain lock held" }) });
  applyPending(fh, fail.deps); // retry 1 -> stays staged
  expect(readEnvelopes(fh).records[0].status).toBe("staged");
  expect(readEnvelopes(fh).records[0].retryCount).toBe(1);
  applyPending(fh, fail.deps); // retry 2 -> stays staged
  expect(readEnvelopes(fh).records[0].status).toBe("staged");
  expect(readEnvelopes(fh).records[0].retryCount).toBe(2);
  const res = applyPending(fh, fail.deps); // retry 3 -> terminal_failed
  expect(res.terminal).toHaveLength(1);
  expect(readEnvelopes(fh).records[0].status).toBe("terminal_failed");
  expect(readEnvelopes(fh).records[0].retryCount).toBe(3);
  // subsequent applies skip it entirely
  const again = applyPending(fh, fail.deps);
  expect(again.skipped).toHaveLength(1);
  expect(fail.puts).toHaveLength(3); // no further puts
});

test("terminal_failed envelope stays terminal until acked (ack is the use-case)", () => {
  const env = stageEnvelope(fh, "asset-ingest", "assets/foo/doc", "content");
  writeEnvelope(fh, { ...env, status: "terminal_failed", error: "x" });
  expect(readEnvelopes(fh).records[0].status).toBe("terminal_failed");
  const s = stub();
  const res = applyPending(fh, s.deps);
  expect(res.skipped).toHaveLength(1); // terminal_failed is never re-applied
});

test("applying a specific id only touches that envelope", () => {
  const a = stageEnvelope(fh, "asset-ingest", "assets/foo/a", "a");
  const b = stageEnvelope(fh, "asset-ingest", "assets/foo/b", "b");
  const s = stub();
  const res = applyPending(fh, s.deps, a.id);
  expect(res.applied).toEqual([a.id]);
  expect(readEnvelopes(fh).records.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  expect(readEnvelopes(fh).records.find((e) => e.id === b.id)!.status).toBe("staged");
});
