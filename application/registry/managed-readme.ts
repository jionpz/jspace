// application/registry/managed-readme.ts — byte-conservative managed blocks in
// user-owned Markdown (filehub README contract + derived navigation).
//
// Ownership rule: text between a marker pair belongs to JSpace; every byte
// outside it belongs to the user. A missing block is INSERTED (never a whole
// file rewrite), a damaged block is refused instead of guessed, and a write is
// re-validated against the bytes we read so a concurrent editor or sync client
// is never clobbered.
//
// Pure planning (no writes) + one explicit apply step, so a command can
// preflight every target file before touching any of them.

import { accessSync, constants, lstatSync, readFileSync } from "node:fs";

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function fenceOpens(line: string): { char: string; len: number } | null {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  const [, , run, info] = m;
  if (run[0] === "`" && info.includes("`")) return null;
  return { char: run[0], len: run.length };
}

function fenceCloses(line: string, open: { char: string; len: number }): boolean {
  const m = FENCE_RE.exec(line);
  if (!m) return false;
  const [, , run, rest] = m;
  return run[0] === open.char && run.length >= open.len && rest.trim() === "";
}

/** Star/end offsets of marker lines, skipping fenced examples. */
export function markerLineStarts(content: string, needle: string): number[] {
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

export type BlockState =
  | { kind: "none" }
  | { kind: "ok"; block: string }
  | { kind: "malformed"; reason: string };

/** Read-only probe. Distinguishes "no markers" from damaged markers so a
 *  command can insert (safe) instead of refusing, or refuse (never guess). */
export function inspectManagedBlock(content: string, start: string, end: string): BlockState {
  const starts = markerLineStarts(content, start);
  const ends = markerLineStarts(content, end);
  if (starts.length === 0 && ends.length === 0) return { kind: "none" };
  if (starts.length === 0 || ends.length === 0) {
    return { kind: "malformed", reason: "only one marker present" };
  }
  if (starts.length > 1 || ends.length > 1) return { kind: "malformed", reason: "duplicate markers" };
  const startIdx = starts[0];
  const endIdx = ends[0];
  if (endIdx < startIdx) return { kind: "malformed", reason: "end marker appears before start marker" };
  return { kind: "ok", block: content.slice(startIdx, endIdx + end.length) };
}

const BOM = "\uFEFF";
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

function insertionOffset(content: string): number {
  const bom = content.startsWith(BOM) ? BOM.length : 0;
  const fm = FRONTMATTER_RE.exec(content.slice(bom));
  return bom + (fm ? fm[0].length : 0);
}

/** Replace the managed block, or insert it after BOM/frontmatter while keeping
 *  every other byte. Throws on a malformed marker pair. */
export function replaceManagedBlock(
  content: string,
  start: string,
  end: string,
  block: string,
): string {
  const state = inspectManagedBlock(content, start, end);
  if (state.kind === "malformed") throw new Error(`malformed managed block: ${state.reason}`);
  if (state.kind === "none") {
    const at = insertionOffset(content);
    const nl = content.includes("\r\n") ? "\r\n" : "\n";
    return `${content.slice(0, at)}${block}${nl}${nl}${content.slice(at)}`;
  }
  const startIdx = markerLineStarts(content, start)[0];
  const endIdx = markerLineStarts(content, end)[0];
  return `${content.slice(0, startIdx)}${block}${content.slice(endIdx + end.length)}`;
}

export interface FileIdentity {
  ino: number;
  size: number;
  mtimeMs: number;
}

export type BlockAction = "create" | "insert" | "update" | "no-op";

export interface BlockPlan {
  path: string;
  action: BlockAction | "conflict";
  /** Proposed full file content; null for no-op and conflict. */
  next: string | null;
  identity: FileIdentity | null;
  mode?: number;
  conflict?: string;
}

/** Strict UTF-8 decode: null instead of U+FFFD substitution. */
export function decodeUtf8Strict(buf: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return null;
  }
}

/** Plan one file. Never throws for a damaged/unreadable target: the caller
 *  aggregates conflicts and refuses the whole command before writing. */
export function planManagedBlock(
  path: string,
  start: string,
  end: string,
  block: string,
): BlockPlan {
  let st: ReturnType<typeof lstatSync> | null = null;
  try {
    st = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        path,
        action: "conflict",
        next: null,
        identity: null,
        conflict: `cannot read file: ${(error as Error).message}`,
      };
    }
  }
  if (st === null) {
    return { path, action: "create", next: `${block}\n`, identity: null };
  }
  if (st.isSymbolicLink()) {
    return {
      path,
      action: "conflict",
      next: null,
      identity: null,
      conflict: "refusing to write a symlinked file (replace it with a regular file first)",
    };
  }
  if (!st.isFile()) {
    return { path, action: "conflict", next: null, identity: null, conflict: "not a regular file" };
  }
  const current = decodeUtf8Strict(readFileSync(path));
  if (current === null) {
    return {
      path,
      action: "conflict",
      next: null,
      identity: null,
      conflict: "not valid UTF-8; refusing to rewrite it and lose bytes",
    };
  }
  const state = inspectManagedBlock(current, start, end);
  if (state.kind === "malformed") {
    return {
      path,
      action: "conflict",
      next: null,
      identity: null,
      conflict: `malformed markers (${state.reason}); fix them by hand`,
    };
  }
  const next = replaceManagedBlock(current, start, end, block);
  const identity: FileIdentity = { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
  if (next === current) {
    return { path, action: "no-op", next: null, identity, mode: st.mode };
  }
  return {
    path,
    action: state.kind === "ok" ? "update" : "insert",
    next,
    identity,
    mode: st.mode,
  };
}

/** Fail-closed checks shared by dry-run and apply, so a preview never promises
 *  a write the apply would refuse. Returns an error string instead of throwing. */
export function checkWritable(plan: BlockPlan): string | null {
  if (plan.action === "conflict") return plan.conflict ?? "conflict";
  if (plan.identity === null) return null;
  try {
    accessSync(plan.path, constants.W_OK);
  } catch {
    return "file is not writable (fix the file mode or ACL, then re-run)";
  }
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(plan.path);
  } catch {
    return "file disappeared while planning (re-run the command)";
  }
  if (st.isSymbolicLink()) return "file became a symlink while planning";
  if (
    st.ino !== plan.identity.ino ||
    st.size !== plan.identity.size ||
    st.mtimeMs !== plan.identity.mtimeMs
  ) {
    return "file changed while planning (concurrent edit or sync); re-run to pick up the new content";
  }
  return null;
}
