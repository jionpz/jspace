// application/fs.ts — tiny shared filesystem predicates used by use cases.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Mirrors pathlib Path.is_file(): false for directories/missing paths. */
export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** readdir + parse JSON + skip-corrupt repository loop, parameterized by ext,
 *  decode and sort. A corrupt/undecodable file is skipped, never fatal. */
export function readJsonRecords<T>(
  dir: string,
  opts: { ext: string; decode: (raw: unknown) => T | null; sort?: (a: T, b: T) => number },
): T[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const n of names) {
    if (!n.endsWith(opts.ext)) continue;
    try {
      const v = opts.decode(JSON.parse(readFileSync(join(dir, n), "utf-8")));
      if (v !== null) out.push(v);
    } catch {
      /* skip corrupt record */
    }
  }
  return opts.sort ? out.sort(opts.sort) : out;
}
