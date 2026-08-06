// application/workspace/agents-block.ts — JSpace block embed/extract utilities.
// JSpace does NOT own the whole workbench AGENTS.md. Like Trellis's
// `<!-- TRELLIS:START -->` pattern, jspace manages only the text between
// `<!-- JSPACE:START -->` and `<!-- JSPACE:END -->`; everything outside that
// block belongs to the user and is never overwritten or deleted.
import { join } from "node:path";

export const JSPACE_BLOCK_START = "<!-- JSPACE:START -->";
export const JSPACE_BLOCK_END = "<!-- JSPACE:END -->";

/** Extract the JSpace block (marker lines inclusive) from an AGENTS.md body,
 *  or null when the markers are absent. When only one marker is present the
 *  document is malformed — return null so the caller treats it as user-owned
 *  and never mutates it. */
export function extractAgentsBlock(content: string): string | null {
  const startIdx = content.indexOf(JSPACE_BLOCK_START);
  const endIdx = content.indexOf(JSPACE_BLOCK_END);
  if (startIdx < 0 && endIdx < 0) return null;
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null; // malformed: keep as user-owned
  return content.slice(startIdx, endIdx + JSPACE_BLOCK_END.length);
}

/** Replace the JSpace block in `content` with `block` (marker lines included).
 *  When no block exists, insert it at the top of the document. Throws when the
 *  document has only one marker (malformed — never mutate a damaged file). */
export function replaceAgentsBlock(content: string, block: string): string {
  const startIdx = content.indexOf(JSPACE_BLOCK_START);
  const endIdx = content.indexOf(JSPACE_BLOCK_END);
  if (startIdx < 0 && endIdx < 0) {
    return `${block}\n${content}`;
  }
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error("AGENTS.md has a malformed JSPACE block (only one marker); refusing to touch user content");
  }
  return `${content.slice(0, startIdx)}${block}${content.slice(endIdx + JSPACE_BLOCK_END.length)}`;
}

/** The workbench-relative AGENTS.md path. */
function agentsRel(): string {
  return "AGENTS.md";
}

/** Absolute AGENTS.md path under a workbench root. */
export function agentsPath(root: string): string {
  return join(root, agentsRel());
}
