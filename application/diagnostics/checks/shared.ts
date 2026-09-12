// application/diagnostics/checks/shared.ts — shared read-only scan helpers.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** Newest mtime (epoch ms) under a directory tree, or 0 when unreadable/empty.
 *  Missing dir degrades to 0 (never throws — diagnostics are read-only). */
export function lastActivityMs(dir: string): number {
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
      if (st.isDirectory()) {
        walk(p);
      } else if (st.mtimeMs > newest) {
        newest = st.mtimeMs;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
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
