// application/registry/filehub-block.ts — filehub README contract managed block.
//
// The filehub README is user-owned except for the text between the
// `<!-- JSPACE:FILEHUB:START -->` / `<!-- JSPACE:FILEHUB:END -->` markers.
// Same ownership model as the workbench AGENTS.md block, but with filehub
// markers so a README that already has its own markers is never damaged.
//
// Pure string helpers (no I/O): the same algorithm serves init (embedded
// template), `filehub upgrade` (explicit write) and doctor (version probe).

export const FILEHUB_BLOCK_START = "<!-- JSPACE:FILEHUB:START -->";
export const FILEHUB_BLOCK_END = "<!-- JSPACE:FILEHUB:END -->";

/** Current filehub README contract version. Bump only when the managed text
 *  changes in a way installed filehubs should adopt via `jspace filehub upgrade`. */
export const FILEHUB_CONTRACT_VERSION = 2;

const VERSION_RE = /^>\s*filehub-contract-version:\s*(\d+)\s*$/m;

export type FilehubBlockState =
  | { kind: "none" }
  | { kind: "ok"; block: string }
  | { kind: "malformed"; reason: string };

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = content.indexOf(needle, from);
    if (idx < 0) return count;
    count += 1;
    from = idx + needle.length;
  }
}

/** Read-only block probe used by doctor (no throwing): distinguishes "no
 *  markers" from damaged markers so the diagnostic can say which one it is. */
export function inspectFilehubContractBlock(content: string): FilehubBlockState {
  const starts = countOccurrences(content, FILEHUB_BLOCK_START);
  const ends = countOccurrences(content, FILEHUB_BLOCK_END);
  if (starts === 0 && ends === 0) return { kind: "none" };
  if (starts === 0 || ends === 0) return { kind: "malformed", reason: "only one marker present" };
  if (starts > 1 || ends > 1) return { kind: "malformed", reason: "duplicate markers" };
  const startIdx = content.indexOf(FILEHUB_BLOCK_START);
  const endIdx = content.indexOf(FILEHUB_BLOCK_END);
  if (endIdx < startIdx) return { kind: "malformed", reason: "end marker appears before start marker" };
  return { kind: "ok", block: content.slice(startIdx, endIdx + FILEHUB_BLOCK_END.length) };
}

/** Extract the managed block (markers inclusive), or null when the document has
 *  no filehub markers at all. A document with only one marker, duplicated
 *  markers, or the end marker before the start throws: callers refuse to rewrite
 *  it rather than guessing which region is user content. */
export function extractFilehubContractBlock(content: string): string | null {
  const state = inspectFilehubContractBlock(content);
  if (state.kind === "none") return null;
  if (state.kind === "malformed") throw malformedBlockError(state.reason);
  return state.block;
}

/** Human-readable reason shared by upgrade (fail) and doctor (warning). */
export function malformedBlockError(reason: string): Error {
  return new Error(
    `filehub README has a malformed JSPACE:FILEHUB block (${reason}); ` +
      "fix the markers by hand — refusing to touch user content",
  );
}

/** Replace the managed block in `content` with `block` (markers inclusive).
 *  When the README has no block, insert it at the top with one blank line
 *  before the original content; text outside the block is preserved byte-for-byte.
 *  Malformed markers throw — never mutate a damaged file. */
export function replaceFilehubContractBlock(content: string, block: string): string {
  const state = inspectFilehubContractBlock(content);
  if (state.kind === "malformed") throw malformedBlockError(state.reason);
  if (state.kind === "none") return `${block}\n\n${content}`;
  const startIdx = content.indexOf(FILEHUB_BLOCK_START);
  const endIdx = content.indexOf(FILEHUB_BLOCK_END);
  return `${content.slice(0, startIdx)}${block}${content.slice(endIdx + FILEHUB_BLOCK_END.length)}`;
}

/** Parse the `> filehub-contract-version: N` line out of a block; null when the
 *  line is missing or not a number (doctor treats both as stale). */
export function parseFilehubContractVersion(block: string): number | null {
  const m = VERSION_RE.exec(block);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}
