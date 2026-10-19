// application/gbrain/page-inventory.ts — bounded, keyset-paginated listing used
// by read-only audits. Budget exhaustion is data, never an empty complete set.
import type {
  GbrainDeps,
  GbrainListOptions,
  GbrainListRow,
} from "../../core/contracts/gbrain.ts";

export interface PageInventoryOptions {
  tag?: string;
  type?: string;
  limit?: number;
  maxPages?: number;
  maxRows?: number;
}

export interface PageInventory {
  rows: GbrainListRow[];
  complete: boolean;
  pages: number;
  scanned: number;
  error?: string;
  budgetExhausted: boolean;
}

export async function listPageInventory(
  gbrain: GbrainDeps,
  opts: PageInventoryOptions = {},
): Promise<PageInventory> {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const maxRows = opts.maxRows ?? 5000;
  const rows = new Map<string, GbrainListRow>();
  const seenCursors = new Set<string>();
  let cursor: GbrainListOptions["cursor"];
  let pages = 0;
  let scanned = 0;

  while (true) {
    const result = await gbrain.listPages({
      limit,
      ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
      ...(opts.type !== undefined ? { type: opts.type } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (!result.ok) {
      return {
        rows: [...rows.values()],
        complete: false,
        pages,
        scanned,
        error: `${result.code}: ${result.message}`,
        budgetExhausted: false,
      };
    }
    pages++;
    scanned += result.rows.length;
    for (const row of result.rows) {
      if (!rows.has(row.slug)) rows.set(row.slug, row);
    }
    if (result.nextCursor === undefined) {
      return { rows: [...rows.values()], complete: true, pages, scanned, budgetExhausted: false };
    }
    const marker = `${result.nextCursor.updatedAfter}\u0000${result.nextCursor.updatedAfterSlug}`;
    if (seenCursors.has(marker)) {
      return {
        rows: [...rows.values()],
        complete: false,
        pages,
        scanned,
        error: "listPages repeated a pagination cursor",
        budgetExhausted: false,
      };
    }
    seenCursors.add(marker);
    if (pages >= maxPages || scanned >= maxRows) {
      return {
        rows: [...rows.values()],
        complete: false,
        pages,
        scanned,
        budgetExhausted: true,
      };
    }
    cursor = result.nextCursor;
  }
}
