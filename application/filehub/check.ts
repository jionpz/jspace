// application/filehub/check.ts — read-only consistency audit across the
// filehub filesystem, owner indexes and gbrain asset pointers. It never moves a
// file, rewrites an index or bumps a gbrain revision.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { GbrainDeps, GbrainPage } from "../../core/contracts/gbrain.ts";
import {
  checkStatus,
  countFindings,
  type CheckCoverage,
  type CheckFinding,
  type CheckStatus,
} from "../../core/contracts/check.ts";
import {
  lifecycleTags,
  memoryOwnerEquals,
  memoryRole,
  parseMemoryMarkdown,
  uniqueTags,
  type ParsedMemoryMarkdown,
} from "../../core/contracts/memory.ts";
import { portabilityIssues } from "../../core/contracts/paths.ts";
import { mapLimit } from "../concurrency.ts";
import { listPageInventory } from "../gbrain/page-inventory.ts";

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_LIST_PAGES = 50;
const DEFAULT_MAX_LIST_ROWS = 5000;
const DEFAULT_MAX_OBJECTS = 20_000;
const DEFAULT_MAX_DEPTH = 30;
const GET_CONCURRENCY = 8;
const HASH_CHUNK_BYTES = 1024 * 1024;

const SUPPORT_DIRS = new Set(["scripts", "_scripts", "tools", "status", "logs"]);
const SKIP_DIRS = new Set([
  "_inbox",
  ".git",
  ".obsidian",
  ".jspace-logs",
  ".trash",
  "node_modules",
]);
const SUPPORT_FILES = new Set([
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "_catalog.json",
  "_manifest.jsonl",
  ".skip-inbox-tidy",
  "requirements.txt",
  "pyproject.toml",
  "package.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "composer.json",
  "composer.lock",
]);
const SUPPORT_EXTENSIONS = new Set([
  "bash",
  "bat",
  "c",
  "cc",
  "cfg",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "cxx",
  "ex",
  "exs",
  "fish",
  "gradle",
  "h",
  "hpp",
  "ini",
  "java",
  "jl",
  "js",
  "jsx",
  "kt",
  "kts",
  "lua",
  "mjs",
  "php",
  "properties",
  "ps1",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "sh",
  "swift",
  "toml",
  "ts",
  "tsx",
  "yaml",
  "yml",
  "zsh",
]);
const LEGACY_TAXONOMY = new Set(["docs", "decks", "data", "notes"]);

export interface FilehubRegistryProject {
  id: string;
  asset_rel_path: string;
  status: string;
}

export interface FilehubCheckInput {
  root: string | null;
  /** null means the registry itself could not be read; this is unknown, not empty. */
  projects: readonly FilehubRegistryProject[] | null;
  registryIssue?: string;
}

export interface FilehubCheckOptions {
  pageLimit?: number;
  maxListPages?: number;
  maxListRows?: number;
  maxObjects?: number;
  maxDepth?: number;
}

export interface FilehubCheckReport {
  schema_version: 1;
  status: CheckStatus;
  coverage: {
    files: CheckCoverage & {
      scanned_objects: number;
      asset_files: number;
      indexes: number;
      companions: number;
      support_files: number;
      archived_files: number;
      restricted_files: number;
      asset_content_hashed: number;
      asset_content_unreadable: number;
    };
    registry: CheckCoverage;
    memory: CheckCoverage & {
      scanned_rows: number;
      list_calls: number;
      asset_pages: number;
      active_asset_pages: number;
      inactive_asset_pages: number;
      /** Active asset pages that declare a usable `source_sha256` (identity comparable). */
      source_digest_present: number;
      /** Active asset pages whose source identity cannot be compared (legacy or malformed). */
      source_digest_absent: number;
    };
  };
  counts: {
    index_rows: number;
    findings: ReturnType<typeof countFindings>;
  };
  findings: CheckFinding[];
}

type FileKind = "asset" | "companion" | "support" | "index" | "archive" | "restricted";

interface IndexRow {
  path: string;
  type: string;
  date: string;
  slug: string;
  line: number;
}

interface IndexedRow extends IndexRow {
  indexPath: string;
  ownerRoot: string;
}

interface IndexDocument {
  relPath: string;
  ownerKind: "project" | "area";
  ownerId: string;
  ownerRoot: string;
  parsed: ParsedMemoryMarkdown;
  supportPaths: string[];
  rows: IndexRow[];
}

interface PathOwner {
  kind: "project" | "area";
  id: string;
  root: string;
}

interface ScannedFile {
  relPath: string;
  kind: FileKind;
}

interface LoadedAssetPage {
  page: GbrainPage;
  parsed: ParsedMemoryMarkdown;
  tags: string[];
  lifecycle: "active" | "inactive";
  inactiveStatus?: string;
  relPath?: string;
  slugOwner?: string;
}

interface ScanResult {
  rootAbs: string;
  files: ScannedFile[];
  directories: string[];
  indexes: Map<string, IndexDocument>;
  scannedObjects: number;
  complete: boolean;
  detail?: string;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function shortError(error: { code: string; message: string }): string {
  return `${error.code}: ${error.message}`;
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

function resolvedIndexPath(index: IndexDocument, row: IndexRow): string {
  const rawPath = normalizeRel(row.path);
  if (
    rawPath.startsWith(`${index.ownerRoot}/`) ||
    rawPath.startsWith("projects/") ||
    rawPath.startsWith("areas/") ||
    rawPath.startsWith("archive/")
  ) {
    return rawPath;
  }
  return normalizeRel(`${index.ownerRoot}/${rawPath}`);
}

function parseIndexRows(raw: string): IndexRow[] {
  const rows: IndexRow[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const cells = tableCells(line);
    if (cells === null || cells.length !== 4) return;
    const path = cleanCell(cells[0] ?? "");
    const type = cleanCell(cells[1] ?? "");
    const date = cleanCell(cells[2] ?? "");
    const slug = cleanCell(cells[3] ?? "");
    if (path === "" || !/^assets\/[^/]+\/[^/]+$/.test(slug)) return;
    rows.push({
      path,
      type,
      date,
      slug,
      line: index + 1,
    });
  });
  return rows;
}

function isRestrictedPath(relPath: string): boolean {
  const segments = relPath.toLowerCase().split("/");
  if (segments.some((segment) => segment === "secrets" || segment === "credentials")) return true;
  const base = segments.at(-1) ?? "";
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    /\.(pem|key|p12|pfx)$/.test(base) ||
    /^id_(rsa|ed25519)/.test(base) ||
    base.includes("credential") ||
    base.includes("secret")
  );
}

function isCompanion(relPath: string): boolean {
  return relPath.endsWith(".extract.md");
}

function isSupportPath(relPath: string): boolean {
  const segments = relPath.split("/");
  if (segments.some((segment) => SUPPORT_DIRS.has(segment))) return true;
  const base = segments.at(-1) ?? "";
  if (SUPPORT_FILES.has(base)) return true;
  if (base.startsWith(".") && !base.startsWith(".env")) return true;
  const extension = base.includes(".") ? base.split(".").at(-1)?.toLowerCase() : undefined;
  return extension !== undefined && SUPPORT_EXTENSIONS.has(extension);
}

function projectIndexPath(project: FilehubRegistryProject): string {
  return `${normalizeRel(project.asset_rel_path)}/index.md`;
}

function knownProjectIndexes(projects: readonly FilehubRegistryProject[] | null): Set<string> {
  const out = new Set<string>();
  for (const project of projects ?? []) out.add(projectIndexPath(project));
  return out;
}

function indexOwner(
  relPath: string,
  projects: readonly FilehubRegistryProject[] | null,
): Omit<IndexDocument, "parsed" | "supportPaths" | "rows"> | null {
  for (const project of projects ?? []) {
    const root = normalizeRel(project.asset_rel_path);
    if (relPath === `${root}/index.md`) {
      return { relPath, ownerKind: "project", ownerId: project.id, ownerRoot: root };
    }
  }
  const area = relPath.match(/^areas\/([^/]+)\/index\.md$/);
  if (area) {
    return {
      relPath,
      ownerKind: "area",
      ownerId: area[1],
      ownerRoot: `areas/${area[1]}`,
    };
  }
  // Unregistered projects are still inspectable; the registry coverage will
  // explain why their ownership is not considered proven.
  const project = relPath.match(/^projects\/([^/]+)\/index\.md$/);
  if (project) {
    return {
      relPath,
      ownerKind: "project",
      ownerId: project[1],
      ownerRoot: `projects/${project[1]}`,
    };
  }
  return null;
}

function classifyFile(
  relPath: string,
  projects: readonly FilehubRegistryProject[] | null,
): FileKind {
  if (knownProjectIndexes(projects).has(relPath) || /^areas\/[^/]+\/index\.md$/.test(relPath)) {
    return "index";
  }
  if (/^projects\/[^/]+\/index\.md$/.test(relPath)) return "index";
  if (isRestrictedPath(relPath)) return "restricted";
  if (relPath.startsWith("archive/")) return "archive";
  if (relPath === "README.md" || isSupportPath(relPath)) return "support";
  if (isCompanion(relPath)) return "companion";
  return "asset";
}

function shouldSkipDirectory(relPath: string): boolean {
  const base = relPath.split("/").at(-1) ?? "";
  if (SKIP_DIRS.has(base)) return true;
  return base.startsWith(".") && base !== ".";
}

function scanFilehub(
  root: string,
  projects: readonly FilehubRegistryProject[] | null,
  opts: FilehubCheckOptions,
  addFinding: (finding: CheckFinding) => void,
): ScanResult {
  let rootAbs: string;
  try {
    rootAbs = realpathSync(root);
    if (!statSync(rootAbs).isDirectory()) {
      addFinding({
        code: "filehub.root.not_directory",
        severity: "unknown",
        path: root,
        message: "registered filehub root is not a directory",
      });
      return {
        rootAbs,
        files: [],
        directories: [],
        indexes: new Map(),
        scannedObjects: 0,
        complete: false,
        detail: "registered filehub root is not a directory",
      };
    }
  } catch {
    addFinding({
      code: "filehub.root.unreadable",
      severity: "unknown",
      path: root,
      message: "registered filehub root is missing or unreadable",
    });
    return {
      rootAbs: resolve(root),
      files: [],
      directories: [],
      indexes: new Map(),
      scannedObjects: 0,
      complete: false,
      detail: "registered filehub root is missing or unreadable",
    };
  }

  const maxObjects = opts.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const files: ScannedFile[] = [];
  const directories: string[] = [];
  let scanned = 0;
  let complete = true;
  let detail: string | undefined;

  const stop = (message: string): void => {
    if (complete) detail = message;
    complete = false;
  };

  const walk = (relDir: string, depth: number): void => {
    if (!complete) return;
    const absDir = relDir === "" ? rootAbs : join(rootAbs, relDir);
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      addFinding({
        code: "filehub.directory.unreadable",
        severity: "unknown",
        path: relDir || ".",
        message: `directory could not be read: ${(error as Error).message}`,
      });
      stop(`directory unreadable: ${relDir || "."}`);
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = normalizeRel(relDir === "" ? entry.name : `${relDir}/${entry.name}`);
      scanned += 1;
      if (scanned > maxObjects) {
        stop(`object budget exhausted after ${maxObjects} entries`);
        return;
      }
      if (entry.isSymbolicLink()) {
        addFinding({
          code: "filehub.path.symlink",
          severity: "unknown",
          path: relPath,
          message: "symlink was not followed; its target identity is unverified",
        });
        stop(`symlink encountered at ${relPath}`);
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(relPath)) continue;
        if (depth >= maxDepth) {
          stop(`directory depth budget exhausted at ${relPath}`);
          return;
        }
        directories.push(relPath);
        walk(relPath, depth + 1);
        continue;
      }
      if (entry.isFile()) {
        if (entry.name === ".DS_Store") continue;
        files.push({ relPath, kind: classifyFile(relPath, projects) });
        continue;
      }
      addFinding({
        code: "filehub.path.unsupported",
        severity: "unknown",
        path: relPath,
        message: "filesystem object is neither a regular file nor a directory",
      });
      stop(`unsupported object at ${relPath}`);
    }
  };

  walk("", 0);

  const indexes = new Map<string, IndexDocument>();
  for (const file of files) {
    if (file.kind !== "index") continue;
    const owner = indexOwner(file.relPath, projects);
    if (owner === null) continue;
    let raw: string;
    try {
      raw = readFileSync(join(rootAbs, file.relPath), "utf-8");
    } catch (error) {
      addFinding({
        code: "filehub.index.unreadable",
        severity: "unknown",
        path: file.relPath,
        message: `index could not be read: ${(error as Error).message}`,
      });
      stop(`index unreadable: ${file.relPath}`);
      continue;
    }
    const parsed = parseMemoryMarkdown(raw);
    indexes.set(file.relPath, {
      ...owner,
      parsed,
      supportPaths: parsed.lists.support_paths ?? [],
      rows: parseIndexRows(parsed.body),
    });
  }

  applySupportDeclarations(files, directories, indexes, addFinding);

  return {
    rootAbs,
    files,
    directories,
    indexes,
    scannedObjects: scanned,
    complete,
    ...(detail !== undefined ? { detail } : {}),
  };
}

/** `support_paths` is the explicit escape hatch for project kits and agent
 * context files that must live with an owner but are not standalone assets.
 * It is owner-relative, directory-prefix aware, and never applies outside the
 * index owner root. Generic extension/dir heuristics remain the fallback. */
function applySupportDeclarations(
  files: ScannedFile[],
  directories: readonly string[],
  indexes: ReadonlyMap<string, IndexDocument>,
  addFinding: (finding: CheckFinding) => void,
): void {
  for (const index of indexes.values()) {
    for (const raw of index.supportPaths) {
      const declared = normalizeRel(raw).replace(/\/+$/, "");
      const issues = portabilityIssues(declared);
      if (
        declared === "" ||
        declared === "." ||
        issues.length > 0 ||
        declared.startsWith("../")
      ) {
        addFinding({
          code: "filehub.index.support_path_invalid",
          severity: "error",
          path: index.relPath,
          message: `support_paths entry must stay below ${index.ownerRoot}/ and name a file or directory: ${raw}`,
        });
        continue;
      }
      const path = declared.startsWith(`${index.ownerRoot}/`)
        ? declared
        : `${index.ownerRoot}/${declared}`;
      if (path === index.ownerRoot || path === index.relPath) {
        addFinding({
          code: "filehub.index.support_path_invalid",
          severity: "error",
          path: index.relPath,
          message: "support_paths cannot reclassify the owner root or index itself",
        });
        continue;
      }
      const exists =
        directories.includes(path) ||
        files.some((file) => file.relPath === path || file.relPath.startsWith(`${path}/`));
      if (!exists) {
        addFinding({
          code: "filehub.index.support_path_missing",
          severity: "error",
          path: index.relPath,
          message: `support_paths entry does not exist: ${path}`,
        });
        continue;
      }
      for (const file of files) {
        if (
          file.kind === "asset" &&
          (file.relPath === path || file.relPath.startsWith(`${path}/`))
        ) {
          file.kind = "support";
        }
      }
    }
  }
}

function pathOwner(
  relPath: string,
  projects: readonly FilehubRegistryProject[] | null,
): PathOwner | null {
  let best: PathOwner | null = null;
  for (const project of projects ?? []) {
    const root = normalizeRel(project.asset_rel_path);
    if (relPath.startsWith(`${root}/`) && (best === null || root.length > best.root.length)) {
      best = { kind: "project", id: project.id, root };
    }
  }
  if (best !== null) return best;
  const area = relPath.match(/^areas\/([^/]+)\//);
  if (area) return { kind: "area", id: area[1], root: `areas/${area[1]}` };
  if (projects === null) {
    const project = relPath.match(/^projects\/([^/]+)\//);
    if (project) return { kind: "project", id: project[1], root: `projects/${project[1]}` };
  }
  return null;
}

function assetSlugOwner(slug: string): string | undefined {
  return slug.match(/^assets\/([^/]+)\/[^/]+$/)?.[1];
}

const INACTIVE_ASSET_STATUSES = new Set([
  "status:superseded",
  "status:deprecated",
  "status:archived",
]);

function assetLifecycle(tags: readonly string[]): {
  lifecycle: "active" | "inactive";
  inactiveStatus?: string;
} {
  const inactive = lifecycleTags(tags).filter((tag) => INACTIVE_ASSET_STATUSES.has(tag));
  return inactive.length === 0
    ? { lifecycle: "active" }
    : { lifecycle: "inactive", inactiveStatus: inactive.join(", ") };
}

function validateRegistry(
  scan: ScanResult,
  projects: readonly FilehubRegistryProject[] | null,
  addFinding: (finding: CheckFinding) => void,
): CheckCoverage {
  if (projects === null) return { state: "unknown", detail: "workbench registry was not readable" };

  const ids = new Set<string>();
  const roots = new Set<string>();
  for (const project of projects) {
    if (ids.has(project.id)) {
      addFinding({
        code: "filehub.registry.duplicate_id",
        severity: "error",
        message: `project id is registered more than once: ${project.id}`,
      });
    }
    ids.add(project.id);
    const root = normalizeRel(project.asset_rel_path);
    if (roots.has(root)) {
      addFinding({
        code: "filehub.registry.duplicate_path",
        severity: "error",
        path: root,
        message: `asset_rel_path is registered more than once: ${root}`,
      });
    }
    roots.add(root);
    const pathIssues = portabilityIssues(root);
    if (pathIssues.length > 0 || !root.startsWith("projects/")) {
      addFinding({
        code: "filehub.registry.path_invalid",
        severity: "error",
        path: root,
        message: [...pathIssues, ...(!root.startsWith("projects/") ? ["must start with projects/"] : [])].join("; "),
      });
      continue;
    }
    const abs = join(scan.rootAbs, root);
    try {
      if (!statSync(abs).isDirectory()) {
        addFinding({
          code: "filehub.registry.root_not_directory",
          severity: "error",
          path: root,
          message: `registered asset root is not a directory: ${root}`,
        });
      }
    } catch {
      addFinding({
        code: "filehub.registry.root_missing",
        severity: project.status === "archived" ? "warning" : "error",
        path: root,
        message: `registered asset root is missing: ${root}`,
      });
    }
    const indexPath = `${root}/index.md`;
    if (!existsSync(join(scan.rootAbs, indexPath))) {
      addFinding({
        code: "filehub.index.missing",
        severity: "error",
        path: indexPath,
        message: `project root is missing its owner index: ${indexPath}`,
      });
    }
  }

  const projectContainers = new Set(
    scan.directories
      .map((dir) => dir.match(/^projects\/([^/]+)$/)?.[1])
      .filter((value): value is string => value !== undefined),
  );
  for (const container of projectContainers) {
    const registered = projects.some((project) => {
      const root = normalizeRel(project.asset_rel_path);
      return root === `projects/${container}` || root.startsWith(`projects/${container}/`);
    });
    if (!registered) {
      addFinding({
        code: "filehub.project.unregistered",
        severity: "warning",
        path: `projects/${container}`,
        message: `project directory is not registered in the workbench: projects/${container}`,
      });
    }
  }
  return { state: "complete" };
}

function validateIndexes(
  scan: ScanResult,
  projects: readonly FilehubRegistryProject[] | null,
  addFinding: (finding: CheckFinding) => void,
): { rows: number; rowsByPath: Map<string, IndexedRow[]>; rowsBySlug: Map<string, IndexedRow[]> } {
  let rows = 0;
  const rowsByPath = new Map<string, IndexedRow[]>();
  const rowsBySlug = new Map<string, IndexedRow[]>();
  for (const index of scan.indexes.values()) {
    const layout = index.parsed.fields.layout;
    if (
      layout !== undefined &&
      layout !== "" &&
      layout !== "flat" &&
      layout !== "workstream" &&
      layout !== "period"
    ) {
      addFinding({
        code: "filehub.index.layout_invalid",
        severity: "error",
        path: index.relPath,
        message: `layout must be flat, workstream or period: ${layout}`,
      });
    }
    if (index.ownerKind === "project" && (layout === undefined || layout === "")) {
      addFinding({
        code: "filehub.index.layout_missing",
        severity: "error",
        path: index.relPath,
        message: "project index frontmatter must declare layout",
      });
    }
    const seenSlugs = new Map<string, number>();
    for (const row of index.rows) {
      rows += 1;
      const rawPath = normalizeRel(row.path);
      const path = resolvedIndexPath(index, row);
      const normalized: IndexedRow = {
        ...row,
        path,
        indexPath: index.relPath,
        ownerRoot: index.ownerRoot,
      };
      if (!rowsByPath.has(path)) rowsByPath.set(path, []);
      rowsByPath.get(path)!.push(normalized);
      if (!rowsBySlug.has(row.slug)) rowsBySlug.set(row.slug, []);
      rowsBySlug.get(row.slug)!.push(normalized);
      const prior = seenSlugs.get(row.slug);
      if (prior !== undefined) {
        addFinding({
          code: "filehub.index.duplicate_slug",
          severity: "warning",
          path: index.relPath,
          message: `slug appears in more than one index row (lines ${prior}, ${row.line}): ${row.slug}`,
        });
      } else {
        seenSlugs.set(row.slug, row.line);
      }
      const pathIssues = portabilityIssues(rawPath);
      if (pathIssues.length > 0) {
        addFinding({
          code: "filehub.index.path_invalid",
          severity: "error",
          path: index.relPath,
          message: `${row.path}: ${pathIssues.join("; ")}`,
        });
      } else if (!path.startsWith(`${index.ownerRoot}/`)) {
        addFinding({
          code: "filehub.index.path_owner_mismatch",
          severity: "error",
          path: index.relPath,
          message: `index row path must stay under ${index.ownerRoot}/: ${path}`,
        });
      }
      if (memoryRole(row.slug) !== "asset") {
        addFinding({
          code: "filehub.index.slug_invalid",
          severity: "error",
          path: index.relPath,
          message: `index row slug must match assets/<owner>/<semantic>: ${row.slug}`,
        });
      } else if (!memoryOwnerEquals(assetSlugOwner(row.slug), index.ownerId)) {
        addFinding({
          code: "filehub.index.slug_owner_mismatch",
          severity: "error",
          path: index.relPath,
          message: `index owner ${index.ownerId} must match asset slug owner ${assetSlugOwner(row.slug) ?? "<missing>"}: ${row.slug}`,
        });
      }
      const target = scan.files.find((file) => file.relPath === path);
      if (target?.kind === "support") {
        addFinding({
          code: "filehub.index.support_registered",
          severity: "error",
          path: index.relPath,
          message: `index row registers a support file as an asset: ${path}`,
        });
      }
    }
  }

  // Areas are path-owned rather than registry-owned. An area with ordinary
  // files must expose the same minimal index contract as a project.
  for (const dir of scan.directories) {
    const area = dir.match(/^areas\/([^/]+)$/);
    if (!area) continue;
    const hasAsset = scan.files.some(
      (file) => file.kind === "asset" && file.relPath.startsWith(`${dir}/`),
    );
    if (hasAsset && !scan.indexes.has(`${dir}/index.md`)) {
      addFinding({
        code: "filehub.index.missing",
        severity: "error",
        path: `${dir}/index.md`,
        message: `area with assets is missing its owner index: ${dir}/index.md`,
      });
    }
  }

  // A registered project whose root is nested may leave an old parent index
  // around; do not let that index imply ownership outside the registered root.
  for (const index of scan.indexes.values()) {
    if (index.ownerKind !== "project" || projects === null) continue;
    const registered = projects.find((project) => project.id === index.ownerId);
    if (registered !== undefined && normalizeRel(registered.asset_rel_path) !== index.ownerRoot) {
      addFinding({
        code: "filehub.index.unregistered_owner_root",
        severity: "warning",
        path: index.relPath,
        message: `index owner root does not match project ${index.ownerId}: ${index.ownerRoot}`,
      });
    }
  }

  for (const [path, refs] of rowsByPath) {
    const indexPaths = new Set(refs.map((row) => row.indexPath));
    if (indexPaths.size > 1) {
      addFinding({
        code: "filehub.index.path_multiply_owned",
        severity: "error",
        path,
        message: `asset path is registered by more than one owner index: ${[...indexPaths].join(", ")}`,
      });
    }
  }
  return { rows, rowsByPath, rowsBySlug };
}

function byLstat(path: string): { kind: "file" | "symlink" | "other" } | { error: string } {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { kind: "symlink" };
    if (stat.isFile()) return { kind: "file" };
    return { kind: "other" };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Hash a regular asset without loading the full file into memory. O_NOFOLLOW
 *  closes the scanner-to-read race on platforms that provide it; the opened fd
 *  still has to identify a regular file. */
function sha256RegularFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("asset is no longer a regular file");
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function renderFilehubCheck(report: FilehubCheckReport): { lines: string[]; exitCode?: number } {
  const f = report.counts.findings;
  const unhashed =
    report.coverage.files.asset_content_unreadable > 0
      ? `; ${report.coverage.files.asset_content_unreadable} content unreadable`
      : "";
  const lines = [
    `jspace: filehub check: ${report.status} (${report.coverage.files.scanned_objects} object(s); ${f.error} error, ${f.warning} warning, ${f.unknown} unknown)`,
    `  files: ${report.coverage.files.state} (${report.coverage.files.asset_files} asset, ${report.coverage.files.indexes} index, ${report.coverage.files.companions} companion, ${report.coverage.files.support_files} support, ${report.coverage.files.archived_files} archive; ${report.coverage.files.asset_content_hashed} content hashed${unhashed})`,
    `  registry: ${report.coverage.registry.state}`,
    `  memory: ${report.coverage.memory.state} (${report.coverage.memory.active_asset_pages} active + ${report.coverage.memory.inactive_asset_pages} inactive asset page(s), ${report.coverage.memory.list_calls} list call(s); source digests: ${report.coverage.memory.source_digest_present} present / ${report.coverage.memory.source_digest_absent} absent)`,
  ];
  for (const finding of report.findings) {
    const location = finding.path ?? finding.slug;
    lines.push(`  [${finding.severity}] ${finding.code}${location ? ` (${location})` : ""}: ${finding.message}`);
  }
  lines.push("jspace: filehub check is read-only; no file, index or gbrain page was modified");
  return { lines, ...(report.status === "ok" ? {} : { exitCode: 1 }) };
}

export async function filehubCheck(
  gbrain: GbrainDeps,
  input: FilehubCheckInput,
  opts: FilehubCheckOptions = {},
): Promise<FilehubCheckReport> {
  const findings: CheckFinding[] = [];
  const findingKeys = new Set<string>();
  const addFinding = (finding: CheckFinding): void => {
    const key = `${finding.code}\u0000${finding.path ?? ""}\u0000${finding.slug ?? ""}\u0000${finding.message}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(finding);
  };

  const scan: ScanResult =
    input.root === null
      ? {
          rootAbs: "",
          files: [],
          directories: [],
          indexes: new Map(),
          scannedObjects: 0,
          complete: false,
          detail: "no registered filehub",
        }
      : scanFilehub(input.root, input.projects, opts, addFinding);
  if (input.root === null) {
    addFinding({
      code: "filehub.root.unregistered",
      severity: "unknown",
      message: "no filehub is registered for this workbench; filesystem consistency is unknown",
    });
  }

  const registryCoverage = validateRegistry(scan, input.projects, addFinding);
  if (input.registryIssue !== undefined) {
    addFinding({
      code: "filehub.registry.unreadable",
      severity: "unknown",
      message: input.registryIssue,
    });
  }
  const indexRows = validateIndexes(scan, input.projects, addFinding);

  const inventory = await listPageInventory(gbrain, {
    limit: opts.pageLimit ?? DEFAULT_PAGE_LIMIT,
    maxPages: opts.maxListPages ?? DEFAULT_MAX_LIST_PAGES,
    maxRows: opts.maxListRows ?? DEFAULT_MAX_LIST_ROWS,
  });
  const inventoryComplete = inventory.complete;
  const assetRows = inventory.rows.filter((row) => memoryRole(row.slug) === "asset");
  if (!inventory.complete) {
    addFinding({
      code: "filehub.memory.inventory_partial",
      severity: "unknown",
      message:
        inventory.error ??
        (inventory.budgetExhausted
          ? "gbrain page inventory exhausted its page/row budget"
          : "gbrain page inventory did not reach a complete keyset"),
    });
  }

  const unreadableSlugs = new Set<string>();
  const loaded = await mapLimit(assetRows, GET_CONCURRENCY, async (row): Promise<LoadedAssetPage | null> => {
    const got = await gbrain.getPage(row.slug);
    if (!got.ok) {
      unreadableSlugs.add(row.slug);
      addFinding({
        code: "filehub.memory.page_unreadable",
        severity: "unknown",
        slug: row.slug,
        message: shortError(got),
      });
      return null;
    }
    const parsed = parseMemoryMarkdown(got.page.content);
    const tags = uniqueTags([...got.page.tags, ...parsed.tags]);
    const lifecycle = assetLifecycle(tags);
    return {
      page: got.page,
      parsed,
      tags,
      ...lifecycle,
      ...(parsed.fields.rel_path !== undefined ? { relPath: normalizeRel(parsed.fields.rel_path) } : {}),
      ...(assetSlugOwner(row.slug) !== undefined ? { slugOwner: assetSlugOwner(row.slug)! } : {}),
    };
  });
  const readablePages = loaded.filter((page): page is LoadedAssetPage => page !== null);
  const activePages = readablePages.filter((page) => page.lifecycle === "active");
  const inactivePages = readablePages.filter((page) => page.lifecycle === "inactive");
  const pagesBySlug = new Map<string, LoadedAssetPage>();
  for (const page of readablePages) {
    pagesBySlug.set(page.page.slug, page);
  }
  const activePagesByRel = new Map<string, LoadedAssetPage[]>();
  for (const page of activePages) {
    if (page.relPath !== undefined) {
      if (!activePagesByRel.has(page.relPath)) activePagesByRel.set(page.relPath, []);
      activePagesByRel.get(page.relPath)!.push(page);
    }
  }

  // Content digests are read once per asset and shared by the page identity
  // check and the duplicate-content pass below (one hash per file, at most).
  const assetDigests = new Map<string, { digest: string } | { error: string }>();
  const readAssetDigest = (relPath: string): { digest: string } | { error: string } => {
    const cached = assetDigests.get(relPath);
    if (cached !== undefined) return cached;
    let entry: { digest: string } | { error: string };
    try {
      entry = { digest: sha256RegularFile(resolve(scan.rootAbs, relPath)) };
    } catch (error) {
      entry = { error: (error as Error).message };
    }
    assetDigests.set(relPath, entry);
    return entry;
  };
  let sourceDigestPresent = 0;
  let sourceDigestAbsent = 0;

  for (const page of activePages) {
    const slug = page.page.slug;
    const owner = page.slugOwner;
    if (owner === undefined) {
      addFinding({
        code: "filehub.memory.slug_invalid",
        severity: "error",
        slug,
        message: "asset page slug must match assets/<owner>/<semantic>",
      });
      continue;
    }
    if (!page.tags.includes("asset")) {
      addFinding({
        code: "filehub.memory.asset_tag_missing",
        severity: "error",
        slug,
        message: "asset page must include the asset routing tag",
      });
    }
    if (!memoryOwnerEquals(page.parsed.fields.project, owner)) {
      addFinding({
        code: "filehub.memory.owner_mismatch",
        severity: "error",
        slug,
        message: `frontmatter project ${page.parsed.fields.project ?? "<missing>"} must equal asset owner ${owner}`,
      });
    }
    if (page.relPath === undefined || page.relPath === "") {
      addFinding({
        code: "filehub.memory.rel_path_missing",
        severity: "error",
        slug,
        message: "asset page requires rel_path",
      });
      continue;
    }
    const relPath = page.relPath;
    const pathIssues = portabilityIssues(relPath);
    if (pathIssues.length > 0) {
      addFinding({
        code: "filehub.memory.rel_path_invalid",
        severity: "error",
        slug,
        path: relPath,
        message: pathIssues.join("; "),
      });
      continue;
    }
    const abs = resolve(scan.rootAbs, relPath);
    if (scan.rootAbs === "" || !within(abs, scan.rootAbs)) {
      addFinding({
        code: "filehub.memory.rel_path_escape",
        severity: "error",
        slug,
        path: relPath,
        message: "rel_path escapes the registered filehub root",
      });
      continue;
    }
    const ownerByPath = pathOwner(relPath, input.projects);
    if (ownerByPath === null) {
      if (!relPath.startsWith("archive/")) {
        addFinding({
          code: "filehub.memory.rel_path_unowned",
          severity: "error",
          slug,
          path: relPath,
          message: "rel_path is outside a registered project, area or archive",
        });
      }
    } else if (!memoryOwnerEquals(ownerByPath.id, owner)) {
      addFinding({
        code: "filehub.memory.path_owner_mismatch",
        severity: "error",
        slug,
        path: relPath,
        message: `path owner ${ownerByPath.kind}:${ownerByPath.id} does not match asset owner ${owner}`,
      });
    }
    const declaredKind = page.parsed.fields.owner_kind;
    if (declaredKind !== undefined && declaredKind !== "project" && declaredKind !== "area") {
      addFinding({
        code: "filehub.memory.owner_kind_invalid",
        severity: "error",
        slug,
        message: "owner_kind must be project or area when present",
      });
    } else if (ownerByPath !== null && declaredKind !== undefined && declaredKind !== ownerByPath.kind) {
      addFinding({
        code: "filehub.memory.owner_kind_mismatch",
        severity: "error",
        slug,
        path: relPath,
        message: `owner_kind ${declaredKind} conflicts with path owner ${ownerByPath.kind}`,
      });
    }
    const fileState = byLstat(abs);
    if ("error" in fileState) {
      addFinding({
        code: "filehub.memory.file_missing",
        severity: "error",
        slug,
        path: relPath,
        message: "asset rel_path does not resolve to a readable file",
      });
    } else if (fileState.kind === "symlink") {
      addFinding({
        code: "filehub.memory.file_symlink",
        severity: "unknown",
        slug,
        path: relPath,
        message: "asset rel_path resolves through a symlink; identity is unverified",
      });
    } else if (fileState.kind !== "file") {
      addFinding({
        code: "filehub.memory.not_file",
        severity: "error",
        slug,
        path: relPath,
        message: "asset rel_path must identify a regular file",
      });
    } else {
      const scanned = scan.files.find((file) => file.relPath === relPath);
      if (scanned !== undefined && scanned.kind !== "asset" && scanned.kind !== "archive" && scanned.kind !== "restricted") {
        addFinding({
          code: "filehub.memory.target_not_asset",
          severity: "error",
          slug,
          path: relPath,
          message: `asset pointer targets a ${scanned.kind} object`,
        });
      }
      const declaredDigest = page.parsed.fields.source_sha256;
      if (declaredDigest === undefined || declaredDigest === "") {
        // Legacy pages predate the field: coverage records the gap, but per-asset
        // findings stay silent so an un-migrated filehub does not turn noisy.
        sourceDigestAbsent += 1;
      } else if (!/^[0-9a-f]{64}$/.test(declaredDigest)) {
        sourceDigestAbsent += 1;
        addFinding({
          code: "filehub.memory.source_digest_invalid",
          severity: "warning",
          slug,
          path: relPath,
          message: "source_sha256 must be a 64-character lowercase sha256 digest; identity comparison skipped",
        });
      } else {
        sourceDigestPresent += 1;
        const current = readAssetDigest(relPath);
        if ("digest" in current && current.digest !== declaredDigest) {
          addFinding({
            code: "filehub.memory.source_digest_changed",
            severity: "warning",
            slug,
            path: relPath,
            message:
              `source bytes changed since ingest (source_identity=changed, semantic_verification=not_performed): ` +
              `page records ${declaredDigest.slice(0, 12)}…, current file is ${current.digest.slice(0, 12)}…; ` +
              "derived summary/extract may be stale — re-verify before reuse",
          });
        }
      }
    }

    if (ownerByPath === null) continue;
    const indexPath =
      ownerByPath.kind === "project"
        ? `${ownerByPath.root}/index.md`
        : `areas/${ownerByPath.id}/index.md`;
    const doc = scan.indexes.get(indexPath);
    if (doc === undefined) {
      addFinding({
        code: "filehub.index.missing",
        severity: "error",
        path: indexPath,
        message: `cannot verify asset registration because the owner index is missing: ${indexPath}`,
      });
      continue;
    }
    const matchingSlug = doc.rows.filter((row) => row.slug === slug);
    const matchingPath = doc.rows.filter((row) => resolvedIndexPath(doc, row) === relPath);
    if (matchingSlug.length === 0) {
      addFinding({
        code: "filehub.index.asset_unregistered",
        severity: "error",
        slug,
        path: indexPath,
        message: `index has no row for asset slug ${slug}`,
      });
    } else if (!matchingSlug.some((row) => resolvedIndexPath(doc, row) === relPath)) {
      addFinding({
        code: "filehub.index.path_mismatch",
        severity: "error",
        slug,
        path: indexPath,
        message: `index row for ${slug} points to ${matchingSlug.map((row) => row.path).join(", ")}, expected ${relPath}`,
      });
    } else {
    }
    if (matchingPath.some((row) => row.slug !== slug)) {
      addFinding({
        code: "filehub.index.slug_mismatch",
        severity: "error",
        path: indexPath,
        message: `index row for ${relPath} points to ${matchingPath.map((row) => row.slug).join(", ")}, expected ${slug}`,
      });
    }
  }

  for (const [relPath, pages] of activePagesByRel) {
    if (pages.length > 1) {
      addFinding({
        code: "filehub.memory.duplicate_pointer",
        severity: "error",
        path: relPath,
        message: `multiple asset pages point to one file: ${pages.map((page) => page.page.slug).join(", ")}`,
      });
    }
  }

  for (const index of scan.indexes.values()) {
    for (const row of index.rows) {
      const path = resolvedIndexPath(index, row);
      const page = pagesBySlug.get(row.slug);
      if (page === undefined && !unreadableSlugs.has(row.slug)) {
        addFinding({
          code: inventoryComplete ? "filehub.index.page_missing" : "filehub.index.page_unverified",
          severity: inventoryComplete ? "error" : "unknown",
          path: index.relPath,
          message: inventoryComplete
            ? `index row points to a missing asset page: ${row.slug}`
            : `index row page could not be verified because the gbrain inventory is incomplete: ${row.slug}`,
        });
      } else if (page?.lifecycle === "inactive") {
        addFinding({
          code: "filehub.index.page_inactive",
          severity: "error",
          path: index.relPath,
          message: `index row points to a non-current asset page (${page.inactiveStatus ?? "inactive"}): ${row.slug}`,
        });
      }
      const abs = scan.rootAbs === "" ? "" : resolve(scan.rootAbs, path);
      const fileState =
        abs === "" || !within(abs, scan.rootAbs) ? { error: "no root" } : byLstat(abs);
      if ("error" in fileState) {
        addFinding({
          code: abs === "" || !within(abs, scan.rootAbs)
            ? "filehub.index.path_escape"
            : "filehub.index.file_missing",
          severity: "error",
          path: index.relPath,
          message:
            abs === "" || !within(abs, scan.rootAbs)
              ? `index row path escapes the registered filehub: ${path}`
              : `index row points to a missing file: ${path}`,
        });
      } else if (fileState.kind === "symlink") {
        addFinding({
          code: "filehub.index.file_symlink",
          severity: "unknown",
          path: path,
          message: "index row target is a symlink; identity is unverified",
        });
      } else if (fileState.kind !== "file") {
        addFinding({
          code: "filehub.index.target_not_file",
          severity: "error",
          path: index.relPath,
          message: `index row target is not a regular file: ${path}`,
        });
      }
    }
  }

  for (const file of scan.files) {
    if (file.kind !== "asset") continue;
    const pages = activePagesByRel.get(file.relPath) ?? [];
    const rows = indexRows.rowsByPath.get(file.relPath) ?? [];
    const hasCurrentRow = rows.some(
      (row) => pagesBySlug.get(row.slug)?.lifecycle !== "inactive",
    );
    if (scan.complete && inventoryComplete && pages.length === 0 && !hasCurrentRow) {
      addFinding({
        code: "filehub.asset.unindexed",
        severity: "warning",
        path: file.relPath,
        message: "ordinary asset has neither an index row nor a gbrain asset page",
      });
    }
  }

  // Content identity is independent of owner/index metadata: identical bytes at
  // two paths mean the filehub has two physical copies of one asset identity.
  // Restricted, support, archive and companion files are deliberately excluded.
  const assetPathsByHash = new Map<string, string[]>();
  let assetContentHashed = 0;
  let assetContentUnreadable = 0;
  for (const file of scan.files) {
    if (file.kind !== "asset") continue;
    const read = readAssetDigest(file.relPath);
    if ("error" in read) {
      assetContentUnreadable += 1;
      addFinding({
        code: "filehub.asset.content_unreadable",
        severity: "unknown",
        path: file.relPath,
        message: `asset content could not be hashed: ${read.error}`,
      });
      continue;
    }
    assetContentHashed += 1;
    const digest = read.digest;
    if (!assetPathsByHash.has(digest)) assetPathsByHash.set(digest, []);
    assetPathsByHash.get(digest)!.push(file.relPath);
  }
  for (const paths of assetPathsByHash.values()) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    addFinding({
      code: "filehub.asset.duplicate_content",
      severity: "warning",
      path: sorted[0]!,
      message: `identical asset content appears at ${sorted.length} paths: ${sorted.join(", ")}`,
    });
  }

  for (const file of scan.files) {
    if (file.kind !== "companion") continue;
    const base = file.relPath.slice(0, -".extract.md".length);
    const hasExactBase = existsSync(resolve(scan.rootAbs, base));
    const hasStemBase = scan.files.some(
      (candidate) =>
        candidate.kind === "asset" &&
        (candidate.relPath === base || candidate.relPath.startsWith(`${base}.`)),
    );
    if (!hasExactBase && !hasStemBase) {
      addFinding({
        code: "filehub.companion.orphan",
        severity: "warning",
        path: file.relPath,
        message: `companion extract has no base asset: ${base}`,
      });
    }
    if (indexRows.rowsByPath.has(file.relPath)) {
      addFinding({
        code: "filehub.companion.indexed",
        severity: "warning",
        path: file.relPath,
        message: "companion extract must not be registered as an independent asset",
      });
    }
  }

  for (const file of scan.files) {
    if (file.kind !== "asset") continue;
    const owner = pathOwner(file.relPath, input.projects);
    if (owner === null) continue;
    const indexPath =
      owner.kind === "project" ? `${owner.root}/index.md` : `areas/${owner.id}/index.md`;
    const index = scan.indexes.get(indexPath);
    const layout = index?.parsed.fields.layout;
    const withinOwner = file.relPath.slice(owner.root.length + 1);
    const segments = withinOwner.split("/");
    if (segments.some((segment) => LEGACY_TAXONOMY.has(segment))) {
      addFinding({
        code: "filehub.layout.legacy_taxonomy",
        severity: "warning",
        path: file.relPath,
        message: "format-oriented directory is not a stable ownership axis",
      });
    }
    if (layout === "flat" && segments.length > 1) {
      addFinding({
        code: "filehub.layout.flat_nested",
        severity: "warning",
        path: file.relPath,
        message: "flat layout keeps ordinary assets at the owner root",
      });
    } else if ((layout === "workstream" || layout === "period") && segments.length === 1) {
      addFinding({
        code: "filehub.layout.root_asset",
        severity: "warning",
        path: file.relPath,
        message: `${layout} layout expects ordinary assets inside a stable semantic group`,
      });
    }
  }

  const filesCoverage: FilehubCheckReport["coverage"]["files"] = {
    state:
      input.root === null
        ? "unknown"
        : scan.complete && assetContentUnreadable === 0
          ? "complete"
          : "partial",
    ...(scan.detail !== undefined || assetContentUnreadable > 0
      ? {
          detail: [
            ...(scan.detail !== undefined ? [scan.detail] : []),
            ...(assetContentUnreadable > 0
              ? [`${assetContentUnreadable} asset file(s) could not be content-hashed`]
              : []),
          ].join("; "),
        }
      : {}),
    scanned_objects: scan.scannedObjects,
    asset_files: scan.files.filter((file) => file.kind === "asset").length,
    indexes: scan.files.filter((file) => file.kind === "index").length,
    companions: scan.files.filter((file) => file.kind === "companion").length,
    support_files: scan.files.filter((file) => file.kind === "support").length,
    archived_files: scan.files.filter((file) => file.kind === "archive").length,
    restricted_files: scan.files.filter((file) => file.kind === "restricted").length,
    asset_content_hashed: assetContentHashed,
    asset_content_unreadable: assetContentUnreadable,
  };
  const memoryComplete =
    inventoryComplete &&
    unreadableSlugs.size === 0 &&
    loaded.length === assetRows.length;
  const memoryCoverage: FilehubCheckReport["coverage"]["memory"] = {
    state: memoryComplete ? "complete" : "partial",
    ...(memoryComplete ? {} : { detail: "one or more asset pages could not be read completely" }),
    scanned_rows: inventory.scanned,
    list_calls: inventory.pages,
    asset_pages: readablePages.length,
    active_asset_pages: activePages.length,
    inactive_asset_pages: inactivePages.length,
    source_digest_present: sourceDigestPresent,
    source_digest_absent: sourceDigestAbsent,
  };

  const complete =
    input.root !== null &&
    scan.complete &&
    assetContentUnreadable === 0 &&
    registryCoverage.state === "complete" &&
    memoryComplete;
  const status = checkStatus(findings, complete);
  return {
    schema_version: 1,
    status,
    coverage: {
      files: filesCoverage,
      registry: registryCoverage,
      memory: memoryCoverage,
    },
    counts: {
      index_rows: indexRows.rows,
      findings: countFindings(findings),
    },
    findings,
  };
}

export { renderFilehubCheck };
