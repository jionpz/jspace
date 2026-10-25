// application/filehub/weekly-path.ts — resolve the one weekly-report location.
//
// The default stays `<filehub>/areas/周报/<Monday>-周报.md`. A different place
// is honoured only when the owner index already registers the same week there
// (for example an explicit `areas/周报/<year>/...` path). Two physical copies,
// an index row and a file that disagree, or a damaged index are conflicts: the
// caller must stop instead of writing a third copy.
//
// Resolution is read-only and bounded: one owner index, one directory level of
// year folders, no symlink following, no search outside `areas/周报/`.

import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { join, posix } from "node:path";
import { isMondayDate } from "../../core/contracts/weekly-period.ts";
import { parseOwnerIndex } from "./index-parse.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";

export const WEEKLY_AREA_ID = "周报";
export const WEEKLY_FILE_SUFFIX = "-周报.md";
export const WEEKLY_SLUG_PREFIX = "assets/周报/";

const INDEX_LIMIT_BYTES = 4 * 1024 * 1024;

export type WeeklyIndexState =
  | "ok"
  | "missing"
  | "damaged"
  | "unreadable"
  | "symlink"
  | "not_regular"
  | "too_large";

export type WeeklyPathState = "default" | "reuse" | "conflict";

export type WeeklyPathCode =
  | "index_damaged"
  | "index_unreadable"
  | "area_invalid"
  | "index_path_invalid"
  | "index_path_missing"
  | "index_file_mismatch"
  | "index_slug_mismatch"
  | "duplicate_index_rows"
  | "file_not_registered"
  | "file_not_regular"
  | "duplicate_files";

export interface WeeklyPathCandidate {
  relPath: string;
  source: "index" | "file";
  exists: boolean;
  line?: number;
  slug?: string;
}

export interface WeeklyPathIndex {
  relPath: string;
  state: WeeklyIndexState;
  ready: boolean;
  issue?: string;
}

export interface WeeklyPathResolution {
  monday: string;
  slug: string;
  defaultRelPath: string;
  state: WeeklyPathState;
  code?: WeeklyPathCode;
  /** Chosen target: the reuse location, or the default when state=default.
   *  Absent on conflict — never write a third location. */
  relPath?: string;
  path?: string;
  index: WeeklyPathIndex;
  candidates: WeeklyPathCandidate[];
  warnings: string[];
}

export type WeeklyPathResult =
  | { ok: true; value: WeeklyPathResolution }
  | { ok: false; error: string };

export interface WeeklyPathDeps {
  filehubRoot?: (root: string) => string | null;
}

export function weeklyFileName(monday: string): string {
  return `${monday}${WEEKLY_FILE_SUFFIX}`;
}

export function weeklySlug(monday: string): string {
  return `${WEEKLY_SLUG_PREFIX}${monday}`;
}

function indexRelPath(): string {
  return `areas/${WEEKLY_AREA_ID}/index.md`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTextBounded(
  path: string,
): { state: "ok"; text: string } | { state: Exclude<WeeklyIndexState, "ok">; issue: string } {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "missing", issue: "owner index does not exist" };
    return { state: "unreadable", issue: `cannot inspect owner index: ${errorText(error)}` };
  }
  if (stat.isSymbolicLink()) return { state: "symlink", issue: "owner index is a symlink" };
  if (!stat.isFile()) return { state: "not_regular", issue: "owner index is not a regular file" };
  if (stat.size > INDEX_LIMIT_BYTES) {
    return { state: "too_large", issue: `owner index exceeds ${INDEX_LIMIT_BYTES} bytes` };
  }
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, offset),
    );
    return { state: "ok", text };
  } catch (error) {
    return { state: "unreadable", issue: `cannot read owner index: ${errorText(error)}` };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Resolve the one weekly-report location for `monday`. */
export function resolveWeeklyPath(
  wbRoot: string,
  monday: string,
  deps: WeeklyPathDeps = {},
): WeeklyPathResult {
  if (!isMondayDate(monday)) {
    return { ok: false, error: "week must be a real Monday date (YYYY-MM-DD)" };
  }
  const filehubRoot = (deps.filehubRoot ?? resolveFilehubRoot)(wbRoot);
  if (filehubRoot === null) {
    return {
      ok: false,
      error: "no registered filehub found; register one with: jspace filehub init <path> --register",
    };
  }

  const slug = weeklySlug(monday);
  const fileName = weeklyFileName(monday);
  const defaultRelPath = `areas/${WEEKLY_AREA_ID}/${fileName}`;
  const areaRelPath = `areas/${WEEKLY_AREA_ID}`;
  const areaPath = join(filehubRoot, "areas", WEEKLY_AREA_ID);
  const indexPath = join(filehubRoot, indexRelPath());
  const warnings: string[] = [];
  const candidates: WeeklyPathCandidate[] = [];

  const indexRead = readTextBounded(indexPath);
  const indexState: WeeklyIndexState = indexRead.state;
  const indexText = indexRead.state === "ok" ? indexRead.text : null;
  const indexIssue = indexRead.state === "ok" ? null : indexRead.issue;
  const index: WeeklyPathIndex = {
    relPath: indexRelPath(),
    state: indexState,
    ready: indexState === "ok",
    ...(indexIssue === null ? {} : { issue: indexIssue }),
  };

  const conflict = (code: WeeklyPathCode, reason: string): WeeklyPathResult => ({
    ok: true,
    value: {
      monday,
      slug,
      defaultRelPath,
      state: "conflict",
      code,
      index,
      candidates,
      warnings: [...warnings, reason],
    },
  });

  if (indexState !== "ok" && indexState !== "missing") {
    return conflict(
      indexState === "unreadable" ? "index_unreadable" : "index_damaged",
      `owner index cannot be verified (${indexState}): ${indexIssue ?? "unknown error"}`,
    );
  }

  let areaStat: Stats;
  try {
    areaStat = lstatSync(areaPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // First weekly report: the skill creates the area index before the body.
      return {
        ok: true,
        value: {
          monday,
          slug,
          defaultRelPath,
          state: "default",
          relPath: defaultRelPath,
          path: join(filehubRoot, defaultRelPath),
          index,
          candidates,
          warnings,
        },
      };
    }
    return conflict("area_invalid", `cannot inspect ${areaRelPath}: ${errorText(error)}`);
  }
  if (areaStat.isSymbolicLink() || !areaStat.isDirectory()) {
    return conflict("area_invalid", `${areaRelPath} is not a regular directory`);
  }

  const registered: Array<{ relPath: string; line: number; slug: string }> = [];
  const sameFileName: Array<{ relPath: string; line: number; slug: string }> = [];

  if (indexText !== null) {
    const parsed = parseOwnerIndex(indexText);
    if (parsed.issues.length > 0) {
      return conflict(
        "index_damaged",
        `owner index has structural issues: ${parsed.issues
          .map((issue) => `${issue.code} at line ${issue.line}`)
          .join(", ")}`,
      );
    }
    for (const row of parsed.current) {
      const normalized = normalizeAreaRelative(row.path);
      if (normalized === null) {
        if (row.slug === slug) {
          return conflict(
            "index_path_invalid",
            `index row at line ${row.line} must point at ${areaRelPath}/<year?>/<Monday>-周报.md`,
          );
        }
        continue;
      }
      if (posix.basename(normalized) === fileName) {
        sameFileName.push({ relPath: normalized, line: row.line, slug: row.slug });
      }
      if (row.slug === slug) {
        registered.push({ relPath: normalized, line: row.line, slug: row.slug });
      }
    }
  }

  const filesOnDisk = scanWeeklyFiles(areaPath, fileName);
  for (const file of filesOnDisk) {
    candidates.push({
      relPath: `${areaRelPath}/${file}`,
      source: "file",
      exists: true,
    });
  }
  for (const row of registered) {
    const exists = isRegularFileInside(areaPath, row.relPath);
    candidates.push({
      relPath: `${areaRelPath}/${row.relPath}`,
      source: "index",
      exists,
      line: row.line,
      slug: row.slug,
    });
  }

  if (registered.length > 1) {
    return conflict(
      "duplicate_index_rows",
      `the owner index registers ${slug} more than once (lines ${registered
        .map((row) => row.line)
        .join(", ")})`,
    );
  }
  for (const row of sameFileName) {
    if (row.slug !== slug) {
      return conflict(
        "index_slug_mismatch",
        `index row at line ${row.line} points at ${fileName} but uses slug ${row.slug}`,
      );
    }
  }
  const distinctFiles = [...new Set(filesOnDisk)];
  if (distinctFiles.length > 1) {
    return conflict(
      "duplicate_files",
      `${fileName} exists in more than one weekly location: ${distinctFiles.join(", ")}`,
    );
  }
  const defaultOnDisk = lstatOrNull(join(areaPath, fileName));
  if (defaultOnDisk !== null && !defaultOnDisk.isFile()) {
    return conflict(
      "file_not_regular",
      `${areaRelPath}/${fileName} exists but is not a regular file (symlink or special node)`,
    );
  }

  if (registered.length === 1) {
    const row = registered[0]!;
    if (!isRegularFileInside(areaPath, row.relPath)) {
      return conflict(
        "index_path_missing",
        `the index registers ${areaRelPath}/${row.relPath} (line ${row.line}) but that file is missing or not regular`,
      );
    }
    if (distinctFiles.length === 1 && distinctFiles[0] !== row.relPath) {
      return conflict(
        "index_file_mismatch",
        `the index points at ${areaRelPath}/${row.relPath} while the file exists at ${areaRelPath}/${distinctFiles[0]}`,
      );
    }
    return {
      ok: true,
      value: {
        monday,
        slug,
        defaultRelPath,
        state: "reuse",
        relPath: `${areaRelPath}/${row.relPath}`,
        path: join(areaPath, ...row.relPath.split("/")),
        index,
        candidates,
        warnings,
      },
    };
  }

  if (distinctFiles.length === 1) {
    return conflict(
      "file_not_registered",
      `an unregistered ${fileName} exists at ${areaRelPath}/${distinctFiles[0]}; register it in ${indexRelPath()} before writing`,
    );
  }

  return {
    ok: true,
    value: {
      monday,
      slug,
      defaultRelPath,
      state: "default",
      relPath: defaultRelPath,
      path: join(filehubRoot, defaultRelPath),
      index,
      candidates,
      warnings,
    },
  };
}

/** Normalise an index cell to a path under the weekly area. Returns null when
 *  the row leaves the area, is absolute, or nests deeper than `<year>/`. */
function normalizeAreaRelative(value: string): string | null {
  let raw = value.trim();
  if (raw === "" || raw.startsWith("/") || raw.includes("\\")) return null;
  if (raw.startsWith("./")) raw = raw.slice(2);
  const parts = raw.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  if (parts.length > 2) return null;
  const fileName = parts[parts.length - 1]!;
  if (!fileName.endsWith(WEEKLY_FILE_SUFFIX)) return null;
  if (parts.length === 2 && !/^\d{4}$/.test(parts[0]!)) return null;
  return parts.join("/");
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isRegularFile(path: string): boolean {
  const stat = lstatOrNull(path);
  return stat !== null && stat.isFile();
}

/** A regular file whose intermediate directories are real (never symlinks), so
 *  an index row cannot reach through a linked year folder. */
function isRegularFileInside(areaPath: string, relPath: string): boolean {
  const parts = relPath.split("/");
  let current = areaPath;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return false;
  }
  return isRegularFile(join(current, parts[parts.length - 1]!));
}

/** List `<Monday>-周报.md` at the area root and in one level of real year
 *  directories. Symlinks are skipped, never followed. */
function scanWeeklyFiles(areaPath: string, fileName: string): string[] {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(areaPath, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile()) {
      if (entry.name === fileName && isRegularFile(join(areaPath, entry.name))) found.push(entry.name);
      continue;
    }
    if (!entry.isDirectory() || !/^\d{4}$/.test(entry.name)) continue;
    const yearPath = join(areaPath, entry.name);
    try {
      if (!statSync(yearPath).isDirectory()) continue;
    } catch {
      continue;
    }
    if (isRegularFile(join(yearPath, fileName))) found.push(`${entry.name}/${fileName}`);
  }
  return found;
}

/** Text rendering for the CLI (no JSON). */
export function renderWeeklyPath(value: WeeklyPathResolution): string[] {
  const lines = [
    `week: ${value.monday}`,
    `slug: ${value.slug}`,
    `state: ${value.state}${value.code === undefined ? "" : ` (${value.code})`}`,
    `index: ${value.index.relPath} — ${value.index.state}${value.index.ready ? "" : " (not ready)"}`,
  ];
  if (value.relPath !== undefined) lines.push(`path: ${value.relPath}`);
  for (const candidate of value.candidates) {
    lines.push(
      `  candidate: ${candidate.relPath} — ${candidate.source}${candidate.exists ? "" : " (missing)"}`,
    );
  }
  for (const warning of value.warnings) lines.push(`warning: ${warning}`);
  if (value.state === "default" && !value.index.ready && value.index.state === "missing") {
    lines.push(`next: create ${value.index.relPath} before writing the report`);
  }
  return lines;
}
