// application/registry/helpers.ts — pure helpers shared by registry use cases.
// Moved out of the cli compatibility facade (cli/registry.ts) so the business
// layer owns them; the cli facade is deleted once all commands migrate.
import { isAbsolute, relative } from "node:path";

/** Mirrors pathlib child.relative_to(parent) succeeding. */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Trim, drop empties, dedupe in order. */
export function cleanTags(tags: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const s = (t ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function findIndex<T extends { id: string }>(records: readonly T[], id: string): number | null {
  for (let i = 0; i < records.length; i++) {
    if (records[i].id === id) return i;
  }
  return null;
}
