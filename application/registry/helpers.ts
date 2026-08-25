// application/registry/helpers.ts — pure helpers shared by registry use cases.
// Moved out of the cli compatibility facade (cli/registry.ts) so the business
// layer owns them; the cli facade is deleted once all commands migrate.
import { isAbsolute, relative, resolve, dirname, basename, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";

/** Mirrors pathlib child.relative_to(parent) succeeding. Purely lexical: the
 *  caller must resolve symlinks first when the path gates a mutating fs op
 *  (see confinedWithin). */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve symlinks in the deepest existing prefix of `p`, returning an
 *  absolute path whose lexical containment can be trusted. A symlinked path
 *  component (e.g. `_inbox/evil -> /etc`) resolves through to the real target,
 *  so a subsequent isWithin cannot be defeated by it. */
export function resolveRealPath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(p);
  let current = abs;
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break; // filesystem root reached
    tail.push(basename(current));
    current = parent;
  }
  let base = realpathSync(current);
  for (let i = tail.length - 1; i >= 0; i--) base = join(base, tail[i]);
  return base;
}

/** Symlink-aware containment: returns the realpath-resolved child when it
 *  resolves inside the realpath-resolved parent, else null. Use this (not the
 *  lexical isWithin) to gate any fs op that deletes or copies by path. */
export function confinedWithin(child: string, parent: string): string | null {
  try {
    const realChild = resolveRealPath(child);
    const realParent = realpathSync(parent);
    return isWithin(realChild, realParent) ? realChild : null;
  } catch {
    return null;
  }
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
