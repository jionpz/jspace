// application/pending/apply.test.ts — create/replace intent, CAS, response-loss
// recovery, transient retry and workbench-owned locking.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GbrainDeps,
  GbrainFailure,
  GbrainPage,
  GbrainPageResult,
  GbrainPutInput,
  GbrainPutResult,
  GbrainWriteReceipt,
  GbrainWriteRequestResult,
} from "../../core/contracts/gbrain.ts";
import { CliError } from "../../core/shared/errors.ts";
import { pendingMutationLockPath } from "../lock.ts";
import { applyPending } from "./apply.ts";
import { readEnvelopes, stageEnvelope, writeEnvelope } from "./envelope.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-pending-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fail(code: GbrainFailure["code"], message: string = code): GbrainFailure {
  return { ok: false, code, message };
}

function page(slug: string, revision: string, content = "normalized body"): GbrainPage {
  return {
    slug,
    revision,
    contentHash: `hash-${revision}`,
    content,
    tags: ["project"],
  };
}

function nextRevision(existing: GbrainPage | undefined): string {
  if (existing === undefined) return "revision-1";
  const current = Number(existing.revision.replace(/^revision-/, ""));
  return `revision-${current + 1}`;
}

type Overrides = {
  getPage?: (slug: string) => Promise<GbrainPageResult>;
  putPage?: (input: GbrainPutInput) => Promise<GbrainPutResult>;
  getWriteRequest?: (requestId: string) => Promise<GbrainWriteRequestResult>;
};

function stub(overrides: Overrides = {}) {
  const pages = new Map<string, GbrainPage>();
  const receipts = new Map<string, GbrainWriteReceipt>();
  const puts: GbrainPutInput[] = [];
  const pageReads: string[] = [];
  const deps: GbrainDeps = {
    getPage: async (slug) => {
      pageReads.push(slug);
      if (overrides.getPage) return overrides.getPage(slug);
      const p = pages.get(slug);
      return p ? { ok: true, page: p } : fail("not_found");
    },
    listPages: async () => ({ ok: true, rows: [] }),
    putPage: async (input) => {
      puts.push(input);
      if (overrides.putPage) return overrides.putPage(input);
      const existing = pages.get(input.slug);
      if (input.expectedRevision !== undefined && existing?.revision !== input.expectedRevision) {
        return fail("revision_conflict", `expected ${input.expectedRevision}, got ${existing?.revision ?? "none"}`);
      }
      if (input.expectedRevision === undefined && existing) {
        return fail("revision_required", "existing page requires expected_revision");
      }
      const revision = nextRevision(existing);
      const next = page(input.slug, revision);
      pages.set(input.slug, next);
      const receipt: GbrainWriteReceipt = {
        requestId: input.requestId,
        state: "committed",
        revision,
        operation: existing ? "update" : "create",
        outcome: "created_or_updated",
        slug: input.slug,
      };
      receipts.set(input.requestId, receipt);
      return {
        ok: true,
        requestId: input.requestId,
        state: "committed",
        revision,
        operation: receipt.operation!,
        outcome: receipt.outcome!,
      };
    },
    getWriteRequest: async (requestId) => {
      if (overrides.getWriteRequest) return overrides.getWriteRequest(requestId);
      const receipt = receipts.get(requestId);
      return receipt ? { ok: true, receipt } : fail("not_found");
    },
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
  return { deps, pages, receipts, puts, pageReads };
}

function statuses() {
  return readEnvelopes(root).records.map((e) => e.status);
}

test("stage writes schema 2 under the workbench, not a filehub", () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  expect(env.schema_version).toBe(2);
  expect(env.status).toBe("staged");
  expect(env.requestId).toBe(env.id);
  expect(existsSync(join(root, ".jspace", "state", "pending", `${env.id}.APPLY.json`))).toBe(true);
  expect(existsSync(join(root, ".jspace-logs"))).toBe(false);
});

test("tampered envelope content is terminal and never written", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "original",
    intent: "create",
    contentOrigin: "tool_output",
  });
  writeEnvelope(root, { ...env, content: "tampered" });
  const s = stub();
  const res = await applyPending(root, s.deps);
  expect(s.puts).toHaveLength(0);
  expect(res.terminal).toEqual([env.id]);
  expect(readEnvelopes(root).records[0]!.error).toContain("contentHash");
});

test("create applies only when the target is absent and forwards write provenance", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub();
  const res = await applyPending(root, s.deps);
  expect(res.applied).toEqual([env.id]);
  expect(s.puts).toEqual([
    {
      slug: "assets/foo/doc",
      content: "content",
      requestId: env.requestId,
      contentOrigin: "tool_output",
      sourceId: env.sourceId,
    },
  ]);
  expect(statuses()).toEqual(["applied"]);
  expect(readEnvelopes(root).records[0]!.committedRevision).toBe("revision-1");
});

test("create refuses an existing target and never overwrites it", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "new",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub({ getPage: async () => ({ ok: true, page: page(env.slug, "revision-4", "existing") }) });
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(s.puts).toHaveLength(0);
  expect(statuses()).toEqual(["terminal_failed"]);
  expect(readEnvelopes(root).records[0]!.error).toContain("already exists");
});

test("replace uses the revision captured at stage time", async () => {
  const slug = "project/acme/state";
  const env = stageEnvelope(root, {
    producer: "memory-writeback",
    slug,
    content: "replacement",
    intent: "replace",
    expectedRevision: "revision-4",
    contentOrigin: "user_said",
  });
  const s = stub();
  s.pages.set(slug, page(slug, "revision-4"));
  const res = await applyPending(root, s.deps);
  expect(res.applied).toEqual([env.id]);
  expect(s.puts[0]!.expectedRevision).toBe("revision-4");
  expect(s.pages.get(slug)!.revision).toBe("revision-5");
});

test("replace conflict is terminal and preserves the winning page", async () => {
  const slug = "project/acme/state";
  const env = stageEnvelope(root, {
    producer: "memory-writeback",
    slug,
    content: "stale replacement",
    intent: "replace",
    expectedRevision: "revision-4",
    contentOrigin: "user_said",
  });
  const s = stub();
  s.pages.set(slug, page(slug, "revision-5", "winner"));
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(s.pages.get(slug)!.content).toBe("winner");
  expect(readEnvelopes(root).records[0]!.status).toBe("terminal_failed");
  expect(readEnvelopes(root).records[0]!.error).toContain("revision_conflict");
});

test("a committed receipt after response loss recovers without re-writing", async () => {
  const slug = "project/acme/state";
  const env = stageEnvelope(root, {
    producer: "memory-writeback",
    slug,
    content: "replacement",
    intent: "replace",
    expectedRevision: "revision-2",
    contentOrigin: "user_said",
  });
  const s = stub();
  s.pages.set(slug, page(slug, "revision-3"));
  s.receipts.set(env.requestId, {
    requestId: env.requestId,
    state: "committed",
    revision: "revision-3",
    operation: "update",
    outcome: "created_or_updated",
    slug,
  });
  const res = await applyPending(root, s.deps);
  expect(res.recovered).toEqual([env.id]);
  expect(res.applied).toEqual([]);
  expect(s.puts).toHaveLength(0);
  expect(statuses()).toEqual(["applied"]);
});

test("a committed receipt without a matching readback stays terminal", async () => {
  const slug = "project/acme/state";
  const env = stageEnvelope(root, {
    producer: "memory-writeback",
    slug,
    content: "replacement",
    intent: "replace",
    expectedRevision: "revision-2",
    contentOrigin: "user_said",
  });
  const s = stub({ getPage: async () => ({ ok: true, page: page(slug, "revision-9") }) });
  s.receipts.set(env.requestId, { requestId: env.requestId, state: "committed", revision: "revision-3" });
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(readEnvelopes(root).records[0]!.error).toContain("does not match committed revision");
});

test("readback with the wrong slug is never accepted as applied", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  let reads = 0;
  const s = stub({
    getPage: async () => {
      reads += 1;
      return reads === 1
        ? fail("not_found")
        : { ok: true, page: page("assets/foo/other", "revision-1") };
    },
    putPage: async (input) => {
      return { ok: true, requestId: input.requestId, state: "committed", revision: "revision-1" };
    },
  });
  const res = await applyPending(root, s.deps);
  expect(reads).toBe(2);
  expect(res.terminal).toEqual([env.id]);
  expect(readEnvelopes(root).records[0]!.error).toContain("returned slug");
});

test("transient put failures retry, then terminal_failed at MAX_RETRY", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub({ putPage: async () => fail("lock", "gbrain lock held") });
  await applyPending(root, s.deps);
  expect(readEnvelopes(root).records[0]!.status).toBe("staged");
  expect(readEnvelopes(root).records[0]!.retryCount).toBe(1);
  await applyPending(root, s.deps);
  expect(readEnvelopes(root).records[0]!.retryCount).toBe(2);
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(readEnvelopes(root).records[0]!.status).toBe("terminal_failed");
  expect(readEnvelopes(root).records[0]!.retryCount).toBe(3);
  const again = await applyPending(root, s.deps);
  expect(again.skipped).toEqual([env.id]);
  expect(s.puts).toHaveLength(3);
});

test("idempotency conflict from gbrain is terminal, never retried with a new id", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub({ putPage: async () => fail("idempotency_conflict", "same request id, different intent") });
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(s.puts).toHaveLength(1);
  expect(readEnvelopes(root).records[0]!.status).toBe("terminal_failed");
});

test("a non-transient receipt lookup failure marks the envelope terminal", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub({ getWriteRequest: async () => fail("schema_error", "bad receipt shape") });
  const res = await applyPending(root, s.deps);
  expect(res.terminal).toEqual([env.id]);
  expect(readEnvelopes(root).records[0]!.status).toBe("terminal_failed");
});

test("applying a specific id only touches that envelope", async () => {
  const a = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/a",
    content: "a",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const b = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/b",
    content: "b",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const s = stub();
  const res = await applyPending(root, s.deps, a.id);
  expect(res.applied).toEqual([a.id]);
  expect(readEnvelopes(root).records.find((e) => e.id === b.id)!.status).toBe("staged");
});

function plantForeignPendingLock(): string {
  const p = pendingMutationLockPath(root);
  mkdirSync(join(root, ".jspace", "state", "locks"), { recursive: true });
  writeFileSync(p, "other-process");
  return p;
}

test("apply fails before any gbrain call while another pending mutation holds the lock", async () => {
  const env = stageEnvelope(root, {
    producer: "memory-writeback",
    slug: "project/acme/state",
    content: "content",
    intent: "create",
    contentOrigin: "user_said",
  });
  plantForeignPendingLock();
  const s = stub();
  await expect(applyPending(root, s.deps)).rejects.toThrow(CliError);
  expect(s.puts).toEqual([]);
  expect(s.pageReads).toEqual([]);
  expect(readEnvelopes(root).records[0]!.status).toBe("staged");
  expect(readEnvelopes(root).records[0]!.id).toBe(env.id);
});

test("pending lock is released after the batch", async () => {
  stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/a",
    content: "a",
    intent: "create",
    contentOrigin: "tool_output",
  });
  await applyPending(root, stub().deps);
  expect(existsSync(pendingMutationLockPath(root))).toBe(false);
});

test("terminal envelopes stay terminal until acked", async () => {
  const env = stageEnvelope(root, {
    producer: "asset-ingest",
    slug: "assets/foo/doc",
    content: "content",
    intent: "create",
    contentOrigin: "tool_output",
  });
  writeEnvelope(root, { ...env, status: "terminal_failed", error: "needs decision" });
  const res = await applyPending(root, stub().deps);
  expect(res.skipped).toEqual([env.id]);
});
