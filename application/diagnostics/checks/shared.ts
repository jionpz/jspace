// application/diagnostics/checks/shared.ts — shared read-only scan helpers.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";

// Retirement thresholds (design §5). Deliberately conservative: mtime is
// rewritten by git clone / cloud-sync, so a false "stale" would be noise.
// These are info-level "take a look", never an assertion that something died.
export const DOMAIN_DORMANT_DAYS = 90;
export const PROJECT_STALE_DAYS = 120;

/** End marker of the JSpace managed block in the workbench AGENTS.md. Content
 *  after it is user-owned: upgrade never rewrites it, so only doctor can
 *  surface a pre-block-era template dump left behind there. */
export const BLOCK_END = "<!-- JSPACE:END -->";

/** Official skill names that no longer ship (single source of truth lives in
 *  application/skills/retired.ts so the installer/projection cleanup and these
 *  read-only diagnostics can never disagree about what counts as retired). */
export { RETIRED_SKILL_NAMES } from "../../skills/retired.ts";

/** A whole-run walk budget shared by every `lastActivityMs` call in one doctor
 *  invocation. Doctor must stay bounded on a filehub with hundreds of thousands
 *  of files, so the walk stops once the budget runs out and `truncated` records
 *  that the answer is a lower bound, not a fact. */
export interface ActivityScanBudget {
  /** Entries left before the walk stops. */
  remaining: number;
  /** True once any walk stopped early on the budget (not on `stopWhenNewerThan`). */
  truncated: boolean;
}

/** Entries one doctor run may stat while answering "was this touched lately?".
 *  Generous for a personal filehub (≥ 20k files) and still a hard bound. */
export const ACTIVITY_SCAN_BUDGET = 20_000;

export function newActivityScanBudget(entries = ACTIVITY_SCAN_BUDGET): ActivityScanBudget {
  return { remaining: entries, truncated: false };
}

export interface LastActivityOpts {
  /** Short-circuit: callers only ask "was anything touched after T?", so an
   *  entry beating T ends the walk. An active project (the common case) costs
   *  O(1) instead of O(tree). */
  stopWhenNewerThan?: number;
  /** Shared budget; when it runs out the walk stops and `truncated` is set. */
  budget?: ActivityScanBudget;
}

/** Newest mtime (epoch ms) under a directory tree, or 0 when unreadable/empty.
 *  Missing dir degrades to 0 (never throws — diagnostics are read-only).
 *  When `opts.budget` exists and is exhausted the walk returns early: the value
 *  is then a lower bound, so callers must consult `budget.truncated` before
 *  concluding "stale" from a small number. */
export function lastActivityMs(dir: string, opts: LastActivityOpts = {}): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      const budget = opts.budget;
      if (budget) {
        if (budget.remaining <= 0) {
          budget.truncated = true;
          return;
        }
        budget.remaining -= 1;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (st.mtimeMs > newest) {
        newest = st.mtimeMs;
        if (opts.stopWhenNewerThan !== undefined && newest > opts.stopWhenNewerThan) return;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

/** Diagnostics that fan out per project must not fan out per hundred projects:
 *  a filehub with 300 unlinked projects has ONE actionable fact, not 300. Keep
 *  the first `limit` concrete entries (script-parseable, specific paths) and
 *  collapse the remainder into a single counted line that names the total. */
export const FANOUT_LIMIT = 5;

export function pushCapped<T>(
  diags: RegistryDiagnostic[],
  items: readonly T[],
  one: (item: T) => RegistryDiagnostic,
  rest: (shown: number, total: number) => RegistryDiagnostic,
  limit = FANOUT_LIMIT,
): void {
  for (const item of items.slice(0, limit)) diags.push(one(item));
  if (items.length > limit) diags.push(rest(limit, items.length));
}

/** Relative paths of files whose bytes differ between two sibling trees.
 *  Files present in only one tree also count as drift (the copies must be
 *  byte-identical, so a file in either copy but not the other is a divergence).
 *  Never throws: unreadable or missing siblings degrade to "differs". */
export function diffDirs(a: string, b: string): string[] {
  const out: string[] = [];
  const files = (base: string): Set<string> => {
    const set = new Set<string>();
    const walk = (dir: string, rel = ""): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.startsWith(".")) continue;
        if (name === "__pycache__") continue;
        const relPath = rel ? `${rel}/${name}` : name;
        const p = join(dir, name);
        let isDir: boolean;
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          continue;
        }
        if (isDir) walk(p, relPath);
        else set.add(relPath);
      }
    };
    if (existsSync(base)) walk(base);
    return set;
  };
  const relsA = files(a);
  const relsB = files(b);
  for (const rel of new Set([...relsA, ...relsB])) {
    let ba: Buffer;
    try {
      ba = readFileSync(join(a, rel));
    } catch {
      out.push(rel);
      continue;
    }
    let bb: Buffer;
    try {
      bb = readFileSync(join(b, rel));
    } catch {
      out.push(rel);
      continue;
    }
    if (!ba.equals(bb)) out.push(rel);
  }
  return out;
}
