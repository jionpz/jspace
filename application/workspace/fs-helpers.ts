// application/workspace/fs-helpers.ts — small file helpers shared within the
// workspace application layer (workspace.ts / journal.ts).
import { readFileSync } from "node:fs";

/** Read a file's UTF-8 content, or null when missing/unreadable. */
export function safeReadFile(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}
