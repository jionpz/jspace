// core/shared/fs.ts — shared filesystem predicate used by adapters and
// application (no layer-specific logic, so it lives in the shared kernel).
import { statSync } from "node:fs";

/** Mirrors pathlib Path.is_file(): false for directories/missing paths. */
export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
