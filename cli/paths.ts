// cli/paths.ts — path.resolve() with Python pathlib.resolve() semantics
// (resolves symlinks, handles non-existent paths by realpath-ing the deepest
// existing ancestor then rejoining the tail).
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export function resolvePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    let cur = p;
    const tail: string[] = [];
    while (!existsSync(cur)) {
      const parent = dirname(cur);
      if (parent === cur) break;
      tail.unshift(basename(cur));
      cur = parent;
    }
    let base: string;
    try {
      base = realpathSync(cur);
    } catch {
      base = resolve(cur);
    }
    return resolve(base, ...tail);
  }
}
