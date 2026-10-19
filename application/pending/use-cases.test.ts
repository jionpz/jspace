// application/pending/use-cases.test.ts — pending command use cases. Pending
// state is workbench-owned and must work even when no filehub is registered.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GbrainDeps, GbrainPage } from "../../core/contracts/gbrain.ts";
import { pendingMutationLockPath } from "../lock.ts";
import { readEnvelopes, writeEnvelope } from "./envelope.ts";
import { pendingAck, pendingApply, pendingList, pendingStage } from "./use-cases.ts";

let wb: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-pending-uc-"));
});
afterEach(() => rmSync(wb, { recursive: true, force: true }));

function contentFile(body = "page content"): string {
  const p = join(wb, "content.md");
  writeFileSync(p, body, "utf-8");
  return p;
}

function id(): string {
  return readEnvelopes(wb).records[0]!.id;
}

function stub(): GbrainDeps {
  const pages = new Map<string, GbrainPage>();
  return {
    getPage: async (slug) => {
      const p = pages.get(slug);
      return p ? { ok: true, page: p } : { ok: false, code: "not_found", message: "not found" };
    },
    listPages: async () => ({ ok: true, rows: [] }),
    putPage: async (input) => {
      const existing = pages.get(input.slug);
      const revision =
        existing === undefined
          ? "revision-1"
          : `revision-${Number(existing.revision.replace(/^revision-/, "")) + 1}`;
      pages.set(input.slug, {
        slug: input.slug,
        revision,
        contentHash: `hash-${revision}`,
        content: input.content,
        tags: [],
      });
      return { ok: true, requestId: input.requestId, state: "committed", revision };
    },
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "unknown request" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

test("stage writes an envelope without requiring a filehub; list reports it", () => {
  pendingStage(wb, {
    slug: "assets/foo/doc",
    contentFile: contentFile(),
    producer: "asset-ingest",
    intent: "create",
    contentOrigin: "tool_output",
  });
  expect(readEnvelopes(wb).records).toHaveLength(1);
  expect(existsSync(join(wb, ".jspace", "state", "pending"))).toBe(true);
  const res = pendingList(wb, true);
  expect((res.data as { envelopes: unknown[] }).envelopes).toHaveLength(1);
});

test("list surfaces damaged envelopes as warnings, never fake empty-ok", () => {
  mkdirSync(join(wb, ".jspace", "state", "pending"), { recursive: true });
  writeFileSync(join(wb, ".jspace", "state", "pending", "dead.APPLY.json"), "{not-json", "utf-8");
  const res = pendingList(wb, false);
  expect(res.lines[0]).not.toContain("ok: no pending envelopes");
  expect(res.warnings?.some((w) => w.includes("damaged"))).toBe(true);
  const json = pendingList(wb, true);
  expect((json.data as { envelopes: unknown[]; issues: unknown[] }).envelopes).toHaveLength(0);
  expect((json.data as { envelopes: unknown[]; issues: unknown[] }).issues.length).toBeGreaterThan(0);
});

test("apply with a stub gbrain puts once and marks applied", async () => {
  pendingStage(wb, {
    slug: "assets/foo/doc",
    contentFile: contentFile(),
    producer: "asset-ingest",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const res = await pendingApply(wb, undefined, stub());
  expect(res.lines[0]).toContain("applied 1");
  expect(res.exitCode).toBeUndefined();
  expect(readEnvelopes(wb).records[0]!.status).toBe("applied");
});

test("apply forwards damaged envelope issues as warnings", async () => {
  mkdirSync(join(wb, ".jspace", "state", "pending"), { recursive: true });
  writeFileSync(join(wb, ".jspace", "state", "pending", "dead.APPLY.json"), "{not-json", "utf-8");
  const res = await pendingApply(wb, undefined, stub());
  expect(res.warnings?.some((w) => w.includes("damaged"))).toBe(true);
  expect(res.exitCode).toBe(1);
});

test("terminal apply returns a non-zero result instead of looking successful", async () => {
  pendingStage(wb, {
    slug: "project/acme/state",
    contentFile: contentFile("replacement"),
    producer: "memory-writeback",
    intent: "replace",
    contentOrigin: "user_said",
    expectedRevision: "revision-1",
  });
  const deps = stub();
  deps.putPage = async () => ({ ok: false, code: "revision_conflict", message: "newer revision exists" });
  const res = await pendingApply(wb, undefined, deps);
  expect(res.exitCode).toBe(1);
  expect(readEnvelopes(wb).records[0]!.status).toBe("terminal_failed");
});

test("ack only accepts terminal_failed and stops alerting", () => {
  pendingStage(wb, {
    slug: "assets/foo/doc",
    contentFile: contentFile(),
    producer: "asset-ingest",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const envId = id();
  expect(() => pendingAck(wb, envId)).toThrow(/only terminal_failed can be acked/);
  const env = readEnvelopes(wb).records[0]!;
  writeEnvelope(wb, { ...env, status: "terminal_failed", error: "x" });
  const ack = pendingAck(wb, envId);
  expect(ack.lines[0]).toContain("acknowledged");
  expect(readEnvelopes(wb).records[0]!.status).toBe("acked");
});

test("stage requires an existing content file", () => {
  expect(() =>
    pendingStage(wb, {
      slug: "assets/foo/doc",
      contentFile: join(wb, "nope.md"),
      producer: "asset-ingest",
      intent: "create",
      contentOrigin: "tool_output",
    }),
  ).toThrow(/content file not found/);
});

test("stage rejects replace without a captured revision", () => {
  expect(() =>
    pendingStage(wb, {
      slug: "project/acme/state",
      contentFile: contentFile(),
      producer: "memory-writeback",
      intent: "replace",
      contentOrigin: "user_said",
    }),
  ).toThrow(/expectedRevision/);
});

test("ack fails fast while another process holds the pending lock; status unchanged", () => {
  pendingStage(wb, {
    slug: "assets/foo/doc",
    contentFile: contentFile(),
    producer: "asset-ingest",
    intent: "create",
    contentOrigin: "tool_output",
  });
  const envId = id();
  writeEnvelope(wb, { ...readEnvelopes(wb).records[0]!, status: "terminal_failed", error: "x" });

  const lockPath = pendingMutationLockPath(wb);
  mkdirSync(join(wb, ".jspace", "state", "locks"), { recursive: true });
  writeFileSync(lockPath, "other-process");

  expect(() => pendingAck(wb, envId)).toThrow(/modifying this workbench pending state/);
  expect(readEnvelopes(wb).records[0]!.status).toBe("terminal_failed");
});
