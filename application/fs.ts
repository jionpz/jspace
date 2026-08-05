// application/fs.ts — repository-read helper used by use cases.
// isFile moved to core/shared/fs.ts (shared kernel: adapters also consume it).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContractIssue, DecodeResult } from "../core/contracts/diagnostics.ts";

export { isFile } from "../core/shared/fs.ts";

/** readdir + parse JSON + decode record repository loop, parameterized by ext,
 *  decode and sort. A corrupt/undecodable file is reported as an issue (code +
 *  filename) but never blocks reading the rest — historical collections surface
 *  damaged records instead of silently dropping them. */
export function readJsonRecords<T>(
  dir: string,
  opts: { ext: string; decode: (raw: unknown) => DecodeResult<T>; sort?: (a: T, b: T) => number },
): { records: T[]; issues: ContractIssue[] } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { records: [], issues: [] };
  }
  const records: T[] = [];
  const issues: ContractIssue[] = [];
  for (const n of names) {
    if (!n.endsWith(opts.ext)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, n), "utf-8"));
    } catch {
      issues.push({ code: `${opts.ext.replace(/^\./, "")}.json.parse`, path: n, message: `${n} is not valid JSON` });
      continue;
    }
    const d = opts.decode(raw);
    if (d.ok) {
      records.push(d.value);
    } else {
      issues.push({
        code: `${opts.ext.replace(/^\./, "")}.decode.invalid`,
        path: n,
        message: `${n} failed to decode: ${d.issues.map((i) => i.message).join("; ")}`,
      });
    }
  }
  return { records: opts.sort ? records.sort(opts.sort) : records, issues };
}
