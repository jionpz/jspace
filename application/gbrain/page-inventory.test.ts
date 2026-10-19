import { expect, test } from "bun:test";
import type {
  GbrainDeps,
  GbrainListOptions,
  GbrainListResult,
} from "../../core/contracts/gbrain.ts";
import { listPageInventory } from "./page-inventory.ts";

function inventoryGbrain(
  list: (opts: GbrainListOptions | undefined) => GbrainListResult | Promise<GbrainListResult>,
): GbrainDeps {
  return {
    getPage: async () => ({ ok: false, code: "not_found", message: "unused" }),
    listPages: async (opts) => list(opts),
    putPage: async () => ({ ok: false, code: "process_error", message: "unused" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "unused" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

test("listPageInventory walks keyset pages without duplicates", async () => {
  const calls: (GbrainListOptions | undefined)[] = [];
  const gbrain = inventoryGbrain((opts) => {
    calls.push(opts);
    if (opts?.cursor === undefined) {
      return {
        ok: true,
        rows: [
          { slug: "a/one", updatedAt: "2026-10-18T10:00:00Z" },
          { slug: "a/two", updatedAt: "2026-10-18T11:00:00Z" },
        ],
        nextCursor: { updatedAfter: "2026-10-18T11:00:00Z", updatedAfterSlug: "a/two" },
      };
    }
    return {
      ok: true,
      rows: [{ slug: "a/three", updatedAt: "2026-10-18T12:00:00Z" }],
    };
  });

  const result = await listPageInventory(gbrain, { limit: 2, maxPages: 5, maxRows: 10 });
  expect(result).toEqual({
    rows: [
      { slug: "a/one", updatedAt: "2026-10-18T10:00:00Z" },
      { slug: "a/two", updatedAt: "2026-10-18T11:00:00Z" },
      { slug: "a/three", updatedAt: "2026-10-18T12:00:00Z" },
    ],
    complete: true,
    pages: 2,
    scanned: 3,
    budgetExhausted: false,
  });
  expect(calls[1]?.cursor).toEqual({
    updatedAfter: "2026-10-18T11:00:00Z",
    updatedAfterSlug: "a/two",
  });
});

test("listPageInventory reports budget exhaustion instead of an empty complete set", async () => {
  const gbrain = inventoryGbrain(() => ({
    ok: true,
    rows: [
      { slug: "a/one", updatedAt: "2026-10-18T10:00:00Z" },
      { slug: "a/two", updatedAt: "2026-10-18T11:00:00Z" },
    ],
    nextCursor: { updatedAfter: "2026-10-18T11:00:00Z", updatedAfterSlug: "a/two" },
  }));

  const result = await listPageInventory(gbrain, { limit: 2, maxPages: 1, maxRows: 10 });
  expect(result.complete).toBe(false);
  expect(result.budgetExhausted).toBe(true);
  expect(result.rows).toHaveLength(2);
});

test("listPageInventory detects a repeated cursor", async () => {
  const cursor = { updatedAfter: "2026-10-18T10:00:00Z", updatedAfterSlug: "a/one" };
  const gbrain = inventoryGbrain(() => ({
    ok: true,
    rows: [{ slug: "a/one", updatedAt: cursor.updatedAfter }],
    nextCursor: cursor,
  }));

  const result = await listPageInventory(gbrain, { limit: 1, maxPages: 5, maxRows: 10 });
  expect(result.complete).toBe(false);
  expect(result.budgetExhausted).toBe(false);
  expect(result.error).toContain("repeated");
});

test("listPageInventory preserves typed list failure", async () => {
  const result = await listPageInventory(
    inventoryGbrain(() => ({ ok: false, code: "timeout", message: "gbrain timed out" })),
  );
  expect(result).toMatchObject({
    complete: false,
    budgetExhausted: false,
    error: "timeout: gbrain timed out",
  });
});
