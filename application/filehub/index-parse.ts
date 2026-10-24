// application/filehub/index-parse.ts — one parser for the three index semantics.
//
// An owner index (`projects/<id>/index.md`, `areas/<id>/index.md`) carries three
// different claims, and they must never be confused:
//
//   current    the four-column owning table — this owner holds the file now;
//   history    a bullet under the ASSET-HISTORY markers — this owner used to
//              hold it, and the gbrain page must be inactive;
//   reference  a bullet under the ASSET-REFERENCES markers — another owner (or
//              an external source) is the owner; this doc only points at it.
//
// Only current rows enter ownership, duplicate-ownership, page-active and
// unindexed checks. History rows may cover `asset.unindexed` only after the
// whole record verifies (owner, path, slug, file, inactive page, digest).
// References never own anything and never cover unindexed.
//
// The parser is deliberately section-aware and example-safe: fenced code,
// block quotes and HTML comments (other than the marker lines themselves) are
// skipped, so a template shown in a fence can never become a real row.

export const ASSET_HISTORY_START = "<!-- JSPACE:ASSET-HISTORY:START -->";
export const ASSET_HISTORY_END = "<!-- JSPACE:ASSET-HISTORY:END -->";
export const ASSET_REFERENCES_START = "<!-- JSPACE:ASSET-REFERENCES:START -->";
export const ASSET_REFERENCES_END = "<!-- JSPACE:ASSET-REFERENCES:END -->";

export interface CurrentRow {
  path: string;
  type: string;
  date: string;
  slug: string;
  /** 1-based physical line in the index file. */
  line: number;
}

export interface HistoryRow {
  path: string;
  slug: string;
  label: string;
  line: number;
}

export type ReferenceTargetKind = "relative" | "external" | "anchor";

export interface ReferenceRow {
  target: string;
  kind: ReferenceTargetKind;
  slug?: string;
  digest?: { algorithm: "sha256" | "bundle-sha256"; value: string };
  line: number;
}

export type IndexIssueCode =
  | "history_unregistered"
  | "history_entry_invalid"
  | "reference_entry_invalid"
  | "reference_digest_without_slug"
  | "reference_digest_invalid"
  | "marker_duplicate"
  | "marker_nested"
  | "marker_mismatched"
  | "marker_reverse"
  | "marker_unclosed";

export interface IndexIssue {
  code: IndexIssueCode;
  line: number;
  message: string;
}

export interface ParsedOwnerIndex {
  current: CurrentRow[];
  history: HistoryRow[];
  references: ReferenceRow[];
  issues: IndexIssue[];
  /** Bullet links outside any structured marker section. They stay readable,
   *  but check must not claim the whole document is reference-verified. */
  unmarkedLinks: number;
}

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HISTORY_LINE_RE = /^\s*[-*+]\s+(.*)$/;
const LINK_RE = /\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\)/;
// Strict asset slug: exactly two semantic segments (assets/<owner>/<name>).
const SLUG_RE = /^assets\/[^/\s]+\/[^/\s]+$/;
const DIGEST_RE = /`((?:sha256|bundle-sha256):([^`]*))`/;

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

function cleanCell(value: string): string {
  let cleaned = value.trim();
  const codeSpan = cleaned.match(/^(`+)([\s\S]*)\1$/);
  if (codeSpan !== null) cleaned = codeSpan[2].trim();

  const wiki = cleaned.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]$/);
  if (wiki !== null) return wiki[1].trim();

  const markdown = cleaned.match(
    /^\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\)$/,
  );
  if (markdown !== null) {
    cleaned = (markdown[1] ?? markdown[2] ?? "").trim();
  }
  return cleaned.replace(/^<|>$/g, "").trim();
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells: string[] = [];
  let current = "";
  let squareDepth = 0;
  let parenDepth = 0;
  let escaped = false;
  for (const char of trimmed.slice(1, -1)) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "[") squareDepth++;
    if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "|" && squareDepth === 0 && parenDepth === 0) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCurrentRow(line: string, lineNo: number): CurrentRow | null {
  const cells = tableCells(line);
  if (cells === null || cells.length !== 4) return null;
  const path = cleanCell(cells[0] ?? "");
  const type = cleanCell(cells[1] ?? "");
  const date = cleanCell(cells[2] ?? "");
  const slug = cleanCell(cells[3] ?? "");
  if (path === "" || !SLUG_RE.test(slug)) return null;
  return { path, type, date, slug, line: lineNo };
}

interface ParsedBullet {
  label: string;
  target: string;
  rest: string;
}

function parseBullet(line: string): ParsedBullet | null {
  const bullet = HISTORY_LINE_RE.exec(line);
  if (bullet === null) return null;
  const body = bullet[1] ?? "";
  const link = LINK_RE.exec(body);
  if (link === null) return null;
  const index = body.indexOf(link[0]);
  return {
    label: (link[1] ?? "").trim(),
    target: (link[2] ?? link[3] ?? "").trim(),
    rest: index < 0 ? body : body.slice(index + link[0].length),
  };
}

function backtickedSlug(rest: string): string | null {
  for (const match of rest.matchAll(/`([^`]+)`/g)) {
    const value = (match[1] ?? "").trim();
    if (SLUG_RE.test(value)) return value;
  }
  return null;
}

function targetKind(target: string): ReferenceTargetKind {
  if (target.startsWith("#")) return "anchor";
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return "external";
  return "relative";
}

type Region = "history" | "references" | null;

export function parseOwnerIndex(raw: string): ParsedOwnerIndex {
  const current: CurrentRow[] = [];
  const history: HistoryRow[] = [];
  const references: ReferenceRow[] = [];
  const issues: IndexIssue[] = [];
  let unmarkedLinks = 0;

  let fence: { char: string; len: number } | null = null;
  let inComment = false;
  let region: Region = null;
  const seen = new Set<Region>();
  const issue = (code: IndexIssueCode, line: number, message: string): void => {
    issues.push({ code, line, message });
  };

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNo = i + 1;
    const trimmed = rawLine.trim();

    // Markers are checked before the generic comment skip: they ARE comments,
    // but they carry structure. They are ignored inside fences/comments.
    if (fence === null && !inComment) {
      const marker =
        trimmed === ASSET_HISTORY_START
          ? { kind: "history" as const, open: true }
          : trimmed === ASSET_HISTORY_END
            ? { kind: "history" as const, open: false }
            : trimmed === ASSET_REFERENCES_START
              ? { kind: "references" as const, open: true }
              : trimmed === ASSET_REFERENCES_END
                ? { kind: "references" as const, open: false }
                : null;
      if (marker !== null) {
        if (marker.open) {
          if (region !== null) {
            issue("marker_nested", lineNo, `marker for ${marker.kind} opens inside a ${region} block`);
          } else if (seen.has(marker.kind)) {
            issue("marker_duplicate", lineNo, `${marker.kind} marker block appears more than once`);
            region = marker.kind;
          } else {
            seen.add(marker.kind);
            region = marker.kind;
          }
        } else if (region === null) {
          issue("marker_reverse", lineNo, `${marker.kind} end marker has no matching start marker`);
        } else if (region !== marker.kind) {
          issue(
            "marker_mismatched",
            lineNo,
            `${marker.kind} end marker closes a ${region} block`,
          );
        } else {
          region = null;
        }
        continue;
      }
    }

    if (fence !== null) {
      if (fenceCloses(rawLine, fence)) fence = null;
      continue;
    }
    if (inComment) {
      if (rawLine.includes("-->")) inComment = false;
      continue;
    }
    const open = fenceOpens(rawLine);
    if (open !== null) {
      fence = open;
      continue;
    }
    // Marker lines were already consumed. Any other HTML comment is an
    // example, never a row: a same-line comment is skipped whole, and an
    // unterminated one starts a multi-line skip.
    const commentAt = rawLine.indexOf("<!--");
    if (commentAt >= 0) {
      if (!rawLine.slice(commentAt).includes("-->")) inComment = true;
      continue;
    }
    if (trimmed.startsWith(">")) continue;

    if (region === "history") {
      if (trimmed === "") continue;
      const bullet = parseBullet(rawLine);
      if (bullet === null || bullet.target === "") {
        issue("history_entry_invalid", lineNo, "history entry must be a single Markdown bullet link");
        continue;
      }
      const slug = backtickedSlug(bullet.rest);
      if (slug === null) {
        issue(
          "history_unregistered",
          lineNo,
          "history link has no asset slug; it stays plain navigation and cannot prove a removed asset",
        );
        continue;
      }
      history.push({ path: bullet.target, slug, label: bullet.label, line: lineNo });
      continue;
    }
    if (region === "references") {
      if (trimmed === "") continue;
      const bullet = parseBullet(rawLine);
      if (bullet === null || bullet.target === "") {
        issue("reference_entry_invalid", lineNo, "reference entry must be a single Markdown bullet link");
        continue;
      }
      const slug = backtickedSlug(bullet.rest);
      const digestMatch = DIGEST_RE.exec(bullet.rest);
      let digest: ReferenceRow["digest"];
      if (digestMatch !== null) {
        const algorithm = (digestMatch[1] ?? "").startsWith("bundle-") ? "bundle-sha256" : "sha256";
        const value = (digestMatch[2] ?? "").trim();
        if (!/^[0-9a-f]{64}$/.test(value)) {
          issue(
            "reference_digest_invalid",
            lineNo,
            `${algorithm} digest must be 64 lowercase hex characters: ${value || "<empty>"}`,
          );
        } else if (slug === null) {
          issue(
            "reference_digest_without_slug",
            lineNo,
            "a locked reference needs an asset slug next to its digest",
          );
        } else {
          digest = { algorithm, value };
        }
      }
      references.push({
        target: bullet.target,
        kind: targetKind(bullet.target),
        ...(slug !== null ? { slug } : {}),
        ...(digest !== undefined ? { digest } : {}),
        line: lineNo,
      });
      continue;
    }

    const row = parseCurrentRow(rawLine, lineNo);
    if (row !== null) {
      current.push(row);
      continue;
    }
    if (trimmed !== "" && HISTORY_LINE_RE.test(rawLine) && LINK_RE.test(rawLine)) {
      unmarkedLinks += 1;
    }
  }

  if (region !== null) {
    issue("marker_unclosed", lines.length, `${region} marker block is never closed`);
  }

  return { current, history, references, issues, unmarkedLinks };
}

/** True when `lineText` occurs on a physical line that the same parser classifies
 *  as a current ownership row. Ingest uses this after writing: an identical line
 *  inside a fence, the history block or the references block proves nothing. */
export function isCurrentOwnershipLine(content: string, lineText: string): boolean {
  const parsed = parseOwnerIndex(content);
  if (parsed.current.length === 0) return false;
  const currentLines = new Set(parsed.current.map((row) => row.line));
  return content
    .split(/\r?\n/)
    .some((line, index) => line === lineText && currentLines.has(index + 1));
}
