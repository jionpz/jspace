// application/fs.ts — tiny shared filesystem predicates used by use cases.
import { statSync } from "node:fs";

/** Mirrors pathlib Path.is_file(): false for directories/missing paths. */
export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
