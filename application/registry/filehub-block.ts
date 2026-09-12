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
export const FILEHUB_CONTRACT_VERSION = 3;

const VERSION_RE = /^>\s*filehub-contract-version:\s*(\d+)\s*$/m;

export type FilehubBlockState =
  | { kind: "none" }
  | { kind: "ok"; block: string }
  | { kind: "malformed"; reason: string };

/** A fenced code block delimiter (CommonMark-flavored, deliberately small):
 *  0-3 leading spaces, then a run of 3+ backticks or tildes. A backtick fence's
 *  info string may not contain a backtick; a tilde fence's may contain anything. */
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function fenceOpens(line: string): { char: string; len: number } | null {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  const [, , run, info] = m;
  const char = run[0];
  if (char === "`" && info.includes("`")) return null;
  return { char, len: run.length };
}

/** A closing fence is the same character, at least as long as the opening run,
 *  followed only by whitespace (a closing fence carries no info string). */
function fenceCloses(line: string, open: { char: string; len: number }): boolean {
  const m = FENCE_RE.exec(line);
  if (!m) return false;
  const [, , run, rest] = m;
  return run[0] === open.char && run.length >= open.len && rest.trim() === "";
}

/** Line-anchored marker offsets: a line whose trimmed content is exactly the
 *  marker counts; an inline mention (`see <!-- JSPACE:FILEHUB:START --> xx`)
 *  does not. Returns the offset of the marker token itself, so callers can
 *  slice without assuming the marker sits at column 0.
 *
 *  Fenced code blocks are skipped: a marker shown inside a ```/~~~ example is
 *  documentation, not a managed block. Counting it would make doctor report a
 *  "duplicate markers" that the user cannot find, and `filehub upgrade` would
 *  refuse to write a README that is actually fine. */
function markerLineStarts(content: string, needle: string): number[] {
  const out: number[] = [];
  let at = 0;
  let fence: { char: string; len: number } | null = null;
  for (const raw of content.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (fence === null) {
      const open = fenceOpens(line);
      if (open) fence = open;
      else if (line.trim() === needle) out.push(at + line.indexOf(needle));
    } else if (fenceCloses(line, fence)) {
      fence = null;
    }
    at += raw.length + 1;
  }
  return out;
}

/** Read-only block probe used by doctor (no throwing): distinguishes "no
 *  markers" from damaged markers so the diagnostic can say which one it is. */
export function inspectFilehubContractBlock(content: string): FilehubBlockState {
  const starts = markerLineStarts(content, FILEHUB_BLOCK_START);
  const ends = markerLineStarts(content, FILEHUB_BLOCK_END);
  if (starts.length === 0 && ends.length === 0) return { kind: "none" };
  if (starts.length === 0 || ends.length === 0) {
    return { kind: "malformed", reason: "only one marker present" };
  }
  if (starts.length > 1 || ends.length > 1) return { kind: "malformed", reason: "duplicate markers" };
  const startIdx = starts[0];
  const endIdx = ends[0];
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
 *  When the README has no block, insert it after a leading BOM and any YAML
 *  frontmatter (one blank line before the original content); text outside the
 *  block is preserved byte-for-byte. Malformed markers throw — never mutate a
 *  damaged file. */
const BOM = "\uFEFF";

/** Leading YAML frontmatter: an opening `---` on the first logical line up to the
 *  next `---` on a line of its own. Deliberately strict — an unclosed `---` is
 *  NOT frontmatter, so a stray horizontal rule never pushes the block down. */
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

/** Where an inserted block belongs: after a leading BOM (which must stay at byte
 *  offset 0) and after YAML frontmatter (which must stay at the top of the file,
 *  so `layout:`-style keys keep parsing). */
function insertionOffset(content: string): number {
  const bom = content.startsWith(BOM) ? BOM.length : 0;
  const fm = FRONTMATTER_RE.exec(content.slice(bom));
  return bom + (fm ? fm[0].length : 0);
}

export function replaceFilehubContractBlock(content: string, block: string): string {
  const state = inspectFilehubContractBlock(content);
  if (state.kind === "malformed") throw malformedBlockError(state.reason);
  if (state.kind === "none") {
    const at = insertionOffset(content);
    const nl = content.includes("\r\n") ? "\r\n" : "\n";
    return `${content.slice(0, at)}${block}${nl}${nl}${content.slice(at)}`;
  }
  const startIdx = markerLineStarts(content, FILEHUB_BLOCK_START)[0];
  const endIdx = markerLineStarts(content, FILEHUB_BLOCK_END)[0];
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
