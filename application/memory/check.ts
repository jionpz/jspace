// application/memory/check.ts — read-only structural audit for JSpace-owned
// gbrain namespaces. It never rewrites pages. Coverage that cannot be proven
// complete (pagination/backlink/budget/read failures) is reported as partial.
import { existsSync, lstatSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  checkStatus,
  countFindings,
  type CheckCoverage,
  type CheckFinding,
  type CheckStatus,
} from "../../core/contracts/check.ts";
import type { GbrainDeps, GbrainPage } from "../../core/contracts/gbrain.ts";
import {
  declaresSupersedes,
  isKnowledgeRole,
  lifecycleTags,
  memoryOwnerEquals,
  memoryRole,
  parseMemoryMarkdown,
  provenanceTags,
  supersedesTargets,
  uniqueTags,
  type MemoryRole,
  type ParsedMemoryMarkdown,
} from "../../core/contracts/memory.ts";
import { portabilityIssues } from "../../core/contracts/paths.ts";
import { listPageInventory } from "../gbrain/page-inventory.ts";
import { mapLimit } from "../concurrency.ts";

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_LIST_PAGES = 50;
const DEFAULT_MAX_LIST_ROWS = 5000;
const DEFAULT_MAX_BACKLINK_PAGES = 20;
const DEFAULT_MAX_BACKLINK_ROWS = 1000;
const GET_CONCURRENCY = 8;
const STATE_SOFT_LIMIT_BYTES = 16 * 1024;
const DEFAULT_ENFORCEMENT_SINCE = "2026-10-19T00:00:00+08:00";
const ALLOWED_STATUS_TAGS = new Set([
  "status:provisional",
  "status:settled",
  "status:superseded",
  "status:deprecated",
  "status:archived",
]);
const INACTIVE_STATUS_TAGS = new Set([
  "status:superseded",
  "status:deprecated",
  "status:archived",
]);

export interface MemoryCheckOptions {
  pageLimit?: number;
  maxListPages?: number;
  maxListRows?: number;
  maxBacklinkPages?: number;
  maxBacklinkRows?: number;
  stateSoftLimitBytes?: number;
  /** Metadata rules apply to pages updated at or after this instant. Older
   *  pages retain an explicit unknown gap instead of being retroactively
   *  assigned a source, project or lifecycle they never declared. */
  enforcementSince?: string;
}

interface HistoricalMetadataGaps {
  pages: number;
  source_unknown: number;
  provenance_unknown: number;
  project_unknown: number;
  tags_unknown: number;
  routing_tag_unknown: number;
  project_mismatch: number;
  weekly_identity: number;
}

export interface MemoryCheckReport {
  schema_version: 1;
  status: CheckStatus;
  coverage: {
    pages: CheckCoverage & {
      scanned_rows: number;
      list_calls: number;
      owned_pages: number;
    };
    backlinks: CheckCoverage & {
      checked_pages: number;
      calls: number;
    };
    filehub: CheckCoverage;
  };
  counts: {
    owned_pages: number;
    by_role: Partial<Record<MemoryRole, number>>;
    historical_metadata: HistoricalMetadataGaps;
    findings: ReturnType<typeof countFindings>;
  };
  findings: CheckFinding[];
}

interface LoadedPage {
  page: GbrainPage;
  parsed: ParsedMemoryMarkdown;
  tags: string[];
}

interface BacklinkRead {
  rows: { slug: string }[];
  complete: boolean;
  detail?: string;
}

function enforcementState(page: GbrainPage, sinceMs: number): "current" | "historical" {
  if (page.updatedAt === undefined) return "historical";
  const updatedMs = Date.parse(page.updatedAt);
  return Number.isFinite(updatedMs) && updatedMs >= sinceMs ? "current" : "historical";
}

function isCompleteCoverageState(state: string): boolean {
  return state === "complete" || state === "ok";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isMonday(value: string): boolean {
  if (!isIsoDate(value)) return false;
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function shortMessage(error: { code: string; message: string }): string {
  return `${error.code}: ${error.message}`;
}

function roleRoutingTag(role: MemoryRole): string | null {
  if (role === "project-state") return "project";
  if (role === "profile") return "profile";
  if (role === "asset") return "asset";
  if (role === "weekly-consolidate" || role === "weekly-retro") return "weekly";
  if (isKnowledgeRole(role)) return "knowledge";
  return null;
}

function projectIdForSlug(slug: string): string | undefined {
  const match =
    slug.match(/^project\/([^/]+)\//) ??
    slug.match(/^records\/project\/([^/]+)\//);
  return match?.[1];
}

function assetOwnerForSlug(slug: string): string | undefined {
  const match = slug.match(/^assets\/([^/]+)\//);
  return match?.[1];
}

export async function memoryCheck(
  gbrain: GbrainDeps,
  filehubRoot: string | null,
  opts: MemoryCheckOptions = {},
): Promise<MemoryCheckReport> {
  const enforcementSince = Date.parse(opts.enforcementSince ?? DEFAULT_ENFORCEMENT_SINCE);
  if (!Number.isFinite(enforcementSince)) {
    throw new Error(`invalid memory enforcement boundary: ${opts.enforcementSince ?? DEFAULT_ENFORCEMENT_SINCE}`);
  }
  const findings: CheckFinding[] = [];
  const findingKeys = new Set<string>();
  const addFinding = (finding: CheckFinding): void => {
    const key = `${finding.code}\u0000${finding.slug ?? ""}\u0000${finding.path ?? ""}\u0000${finding.message}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(finding);
  };

  const inventory = await listPageInventory(gbrain, {
    limit: opts.pageLimit ?? DEFAULT_PAGE_LIMIT,
    maxPages: opts.maxListPages ?? DEFAULT_MAX_LIST_PAGES,
    maxRows: opts.maxListRows ?? DEFAULT_MAX_LIST_ROWS,
  });
  const pageCoverage: MemoryCheckReport["coverage"]["pages"] = {
    state: inventory.complete ? "complete" : "partial",
    ...(inventory.budgetExhausted ? { detail: "page/row budget exhausted before the keyset ended" } : {}),
    ...(inventory.error !== undefined ? { detail: inventory.error } : {}),
    scanned_rows: inventory.scanned,
    list_calls: inventory.pages,
    owned_pages: 0,
  };
  if (!inventory.complete) {
    addFinding({
      code: "memory.pages.partial",
      severity: "unknown",
      message:
        inventory.error ??
        "page inventory did not reach a complete keyset; namespaces may be missing or duplicated",
    });
  }

  const ownedRows = inventory.rows.filter((row) => memoryRole(row.slug) !== null);
  pageCoverage.owned_pages = ownedRows.length;
  const byRole: Partial<Record<MemoryRole, number>> = {};
  for (const row of ownedRows) {
    const role = memoryRole(row.slug)!;
    byRole[role] = (byRole[role] ?? 0) + 1;
  }

  const cache = new Map<string, LoadedPage>();
  const failures = new Map<string, CheckFinding>();
  const failureCodes = new Map<string, string>();
  const inFlight = new Map<string, Promise<LoadedPage | null>>();

  async function loadPage(slug: string, owner: "inventory" | "supersedes" | "backlink"): Promise<LoadedPage | null> {
    const cached = cache.get(slug);
    if (cached !== undefined) return cached;
    const existing = inFlight.get(slug);
    if (existing !== undefined) return existing;
    const promise = (async (): Promise<LoadedPage | null> => {
      const got = await gbrain.getPage(slug);
      if (!got.ok) {
        failureCodes.set(slug, got.code);
        // A missing explicit replacement target is a complete, actionable
        // finding. Only read failures make the replacement relationship
        // unknowable. Inventory pages remain strict: any getPage failure on
        // an owned row reduces page coverage.
        if (!(owner === "supersedes" && got.code === "not_found")) {
          const finding: CheckFinding = {
            code: owner === "backlink" ? "memory.backlink.page_unreadable" : "memory.page.unreadable",
            severity: "unknown",
            slug,
            message: shortMessage(got),
          };
          failures.set(slug, finding);
          addFinding(finding);
        }
        return null;
      }
      const parsed = parseMemoryMarkdown(got.page.content);
      const loaded = {
        page: got.page,
        parsed,
        tags: uniqueTags([...got.page.tags, ...parsed.tags]),
      };
      cache.set(slug, loaded);
      return loaded;
    })();
    inFlight.set(slug, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(slug);
    }
  }

  await mapLimit(ownedRows, GET_CONCURRENCY, async (row) => {
    await loadPage(row.slug, "inventory");
  });

  let filehubCoverage: CheckCoverage = {
    state: (byRole.asset ?? 0) > 0 ? "unknown" : "not_applicable",
    ...((byRole.asset ?? 0) === 0
      ? { detail: "no asset pointer pages require file resolution" }
      : { detail: "filehub root was not available" }),
  };
  let filehubPath: string | null = null;
  if ((byRole.asset ?? 0) > 0) {
    if (filehubRoot === null) {
      addFinding({
        code: "memory.filehub.unregistered",
        severity: "unknown",
        message: "asset pages exist but the workbench has no registered filehub; rel_path resolution is unknown",
      });
    } else {
      const rootAbs = resolve(filehubRoot);
      try {
        const st = statSync(rootAbs);
        if (!st.isDirectory()) {
          addFinding({
            code: "memory.filehub.not_directory",
            severity: "unknown",
            path: rootAbs,
            message: "registered filehub root is not a directory",
          });
        } else {
          filehubPath = rootAbs;
          filehubCoverage = { state: "complete" };
        }
      } catch {
        addFinding({
          code: "memory.filehub.unreadable",
          severity: "unknown",
          path: rootAbs,
          message: "registered filehub root is missing or unreadable",
        });
      }
    }
  }

  const superseded: string[] = [];
  const edges = new Map<string, string[]>();
  const pageTags = new Map<string, string[]>();
  const historicalGapPages = new Set<string>();
  const historicalMetadata: HistoricalMetadataGaps = {
    pages: 0,
    source_unknown: 0,
    provenance_unknown: 0,
    project_unknown: 0,
    tags_unknown: 0,
    routing_tag_unknown: 0,
    project_mismatch: 0,
    weekly_identity: 0,
  };

  function recordHistoricalGap(
    slug: string,
    key: Exclude<keyof HistoricalMetadataGaps, "pages">,
  ): void {
    historicalMetadata[key]++;
    historicalGapPages.add(slug);
    historicalMetadata.pages = historicalGapPages.size;
  }

  for (const [slug, loaded] of [...cache.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const role = memoryRole(slug);
    if (role === null) continue;
    const { fields, tags: parsedTags, body } = loaded.parsed;
    const tags = loaded.tags;
    pageTags.set(slug, tags);
    const provenance = provenanceTags(tags);
    const statuses = lifecycleTags(tags);
    const routingTag = roleRoutingTag(role);
    const current = enforcementState(loaded.page, enforcementSince) === "current";

    if (parsedTags.length === 0) {
      if (current) {
        addFinding({
          code: "memory.frontmatter.tags_missing",
          severity: "error",
          slug,
          message: "frontmatter must declare tags",
        });
      } else {
        recordHistoricalGap(slug, "tags_unknown");
      }
    }
    if (!fields.source) {
      if (current) {
        addFinding({
          code: "memory.frontmatter.source_missing",
          severity: "error",
          slug,
          message: "frontmatter source must identify the writing harness",
        });
      } else {
        recordHistoricalGap(slug, "source_unknown");
      }
    }
    if (!fields.project) {
      if (current) {
        addFinding({
          code: "memory.frontmatter.project_missing",
          severity: "error",
          slug,
          message: "frontmatter project must identify the owning project/domain",
        });
      } else {
        recordHistoricalGap(slug, "project_unknown");
      }
    }
    if (provenance.length !== 1) {
      if (current) {
        addFinding({
          code: "memory.provenance.invalid",
          severity: "error",
          slug,
          message: `expected exactly one of source:session/source:cron, found ${provenance.length}`,
        });
      } else {
        recordHistoricalGap(slug, "provenance_unknown");
      }
    }
    if (statuses.length > 1) {
      addFinding({
        code: "memory.lifecycle.multiple_status",
        severity: "error",
        slug,
        message: `expected at most one status:* tag, found ${statuses.join(", ")}`,
      });
    }
    const unknownStatuses = statuses.filter((status) => !ALLOWED_STATUS_TAGS.has(status));
    if (unknownStatuses.length > 0) {
      addFinding({
        code: "memory.lifecycle.unknown_status",
        severity: "error",
        slug,
        message: `unsupported status tag(s): ${unknownStatuses.join(", ")}`,
      });
    }
    if (routingTag !== null && !tags.includes(routingTag)) {
      if (current) {
        addFinding({
          code: "memory.routing_tag.missing",
          severity: "error",
          slug,
          message: `role ${role} requires routing tag ${routingTag}`,
        });
      } else {
        recordHistoricalGap(slug, "routing_tag_unknown");
      }
    }
    if (role === "unknown-owned") {
      addFinding({
        code: "memory.slug.unsupported",
        severity: "error",
        slug,
        message: "slug is inside a JSpace namespace but does not match an authorized page form",
      });
      continue;
    }

    if (role === "project-state") {
      const projectId = projectIdForSlug(slug);
      if (fields.project !== projectId) {
        if (current) {
          addFinding({
            code: "memory.project.mismatch",
            severity: "error",
            slug,
            message: `frontmatter project ${fields.project ?? "<missing>"} must equal slug project ${projectId ?? "<missing>"}`,
          });
        } else {
          recordHistoricalGap(slug, "project_mismatch");
        }
      }
      for (const heading of ["## 这个项目是什么·解决什么", "## 现在到哪了", "## 下一步", "## 执行层"]) {
        if (!body.split("\n").some((line) => line.trim() === heading)) {
          addFinding({
            code: "memory.state.skeleton_missing",
            severity: "warning",
            slug,
            message: `state card is missing ${heading}`,
          });
        }
      }
      const bytes = Buffer.byteLength(loaded.page.content, "utf8");
      if (bytes > (opts.stateSoftLimitBytes ?? STATE_SOFT_LIMIT_BYTES)) {
        addFinding({
          code: "memory.state.size_soft_limit",
          severity: "warning",
          slug,
          message: `state card is ${bytes} bytes; keep the current card concise and move durable history out`,
        });
      }
    } else if (isKnowledgeRole(role) || role === "profile") {
      const projectId = projectIdForSlug(slug);
      if (projectId !== undefined && fields.project !== projectId) {
        if (current) {
          addFinding({
            code: "memory.project.mismatch",
            severity: "error",
            slug,
            message: `frontmatter project ${fields.project ?? "<missing>"} must equal slug project ${projectId}`,
          });
        } else {
          recordHistoricalGap(slug, "project_mismatch");
        }
      }
    } else if (role === "asset" && !statuses.some((status) => INACTIVE_STATUS_TAGS.has(status))) {
      const ownerId = assetOwnerForSlug(slug);
      if (!memoryOwnerEquals(fields.project, ownerId)) {
        addFinding({
          code: "memory.asset_owner.mismatch",
          severity: "error",
          slug,
          message: `frontmatter project ${fields.project ?? "<missing>"} must equal asset owner ${ownerId ?? "<missing>"}`,
        });
      }
      const relPath = fields.rel_path;
      if (!relPath) {
        addFinding({
          code: "memory.asset.rel_path_missing",
          severity: "error",
          slug,
          message: "asset page requires rel_path",
        });
      } else {
        const pathIssues = portabilityIssues(relPath);
        if (pathIssues.length > 0) {
          addFinding({
            code: "memory.asset.rel_path_unsafe",
            severity: "error",
            slug,
            path: relPath,
            message: pathIssues.join("; "),
          });
        }
        const declaredKind = fields.owner_kind;
        if (declaredKind !== undefined && declaredKind !== "project" && declaredKind !== "area") {
          addFinding({
            code: "memory.asset.owner_kind_invalid",
            severity: "error",
            slug,
            message: "owner_kind must be project or area when present",
          });
        }
        if (relPath.startsWith("areas/")) {
          const expected = `areas/${ownerId}/`;
          if (!relPath.toLowerCase().startsWith(expected.toLowerCase())) {
            addFinding({
              code: "memory.asset.area_path_mismatch",
              severity: "error",
              slug,
              path: relPath,
              message: `area asset must be under ${expected}`,
            });
          }
          if (declaredKind !== undefined && declaredKind !== "area") {
            addFinding({
              code: "memory.asset.owner_kind_mismatch",
              severity: "error",
              slug,
              message: `owner_kind ${declaredKind} conflicts with rel_path ${relPath}`,
            });
          }
        } else if (relPath.startsWith("projects/")) {
          if (declaredKind !== undefined && declaredKind !== "project") {
            addFinding({
              code: "memory.asset.owner_kind_mismatch",
              severity: "error",
              slug,
              message: `owner_kind ${declaredKind} conflicts with rel_path ${relPath}`,
            });
          }
        } else if (relPath.startsWith("archive/")) {
          // Archive objects are historical but may still have an asset pointer.
          // They are not owned by a live layout, so no owner_kind is required.
        } else {
          addFinding({
            code: "memory.asset.rel_path_boundary",
            severity: "error",
            slug,
            path: relPath,
            message: "asset rel_path must be under projects/, areas/<owner>/ or archive/",
          });
        }
        if (filehubPath !== null && pathIssues.length === 0) {
          const absolute = resolve(filehubPath, relPath);
          if (!within(absolute, filehubPath)) {
            addFinding({
              code: "memory.asset.rel_path_escape",
              severity: "error",
              slug,
              path: relPath,
              message: "asset rel_path escapes the registered filehub root",
            });
          } else if (!existsSync(absolute)) {
            addFinding({
              code: "memory.asset.file_missing",
              severity: "error",
              slug,
              path: relPath,
              message: "asset rel_path does not resolve to an existing file",
            });
          } else {
            try {
              const st = lstatSync(absolute);
              if (st.isSymbolicLink()) {
                addFinding({
                  code: "memory.asset.file_symlink",
                  severity: "unknown",
                  slug,
                  path: relPath,
                  message: "asset rel_path resolves through a symlink; content identity is not verified",
                });
              } else if (!st.isFile()) {
                addFinding({
                  code: "memory.asset.not_file",
                  severity: "error",
                  slug,
                  path: relPath,
                  message: "asset rel_path must identify a regular file",
                });
              }
            } catch {
              addFinding({
                code: "memory.asset.file_unreadable",
                severity: "unknown",
                slug,
                path: relPath,
                message: "asset file metadata could not be read",
              });
            }
          }
        }
      }
    } else if (role === "weekly-consolidate" || role === "weekly-retro") {
      const date = slug.split("/").at(-1) ?? "";
      if (!isIsoDate(date)) {
        addFinding({
          code: "memory.weekly.invalid_date",
          severity: "error",
          slug,
          message: "weekly page slug must end with a real YYYY-MM-DD date",
        });
      } else if (!isMonday(date)) {
        if (current) {
          addFinding({
            code: "memory.weekly.not_monday",
            severity: "error",
            slug,
            message: "weekly page slug must use the workbench-local Monday date",
          });
        } else {
          recordHistoricalGap(slug, "weekly_identity");
        }
      }
      if (!tags.includes("weekly")) {
        addFinding({
          code: "memory.weekly.tag_missing",
          severity: "error",
          slug,
          message: "weekly page requires route tag weekly",
        });
      }
      if (fields.project !== "jspace") {
        addFinding({
          code: "memory.weekly.project_mismatch",
          severity: "error",
          slug,
          message: `weekly page frontmatter project must be jspace, found ${fields.project ?? "<missing>"}`,
        });
      }
    }

    if (tags.includes("status:superseded")) superseded.push(slug);
    const targets = supersedesTargets(body);
    if (targets.length > 0) {
      edges.set(slug, targets);
      for (const target of targets) {
        if (memoryRole(target) !== null) {
          const targetPage = await loadPage(target, "supersedes");
          if (targetPage === null) {
            if (failureCodes.get(target) === "not_found") {
              addFinding({
                code: "memory.supersedes.target_missing",
                severity: "error",
                slug,
                message: `Supersedes target does not exist: ${target}`,
              });
            }
          }
        }
      }
    }
  }

  // Direction-independent cycle detection over explicit replacement edges.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleReported = new Set<string>();
  const visit = (slug: string): void => {
    if (visited.has(slug)) return;
    if (visiting.has(slug)) {
      if (!cycleReported.has(slug)) {
        cycleReported.add(slug);
        addFinding({
          code: "memory.supersedes.cycle",
          severity: "error",
          slug,
          message: "Supersedes edges form a cycle",
        });
      }
      return;
    }
    visiting.add(slug);
    for (const target of edges.get(slug) ?? []) visit(target);
    visiting.delete(slug);
    visited.add(slug);
  };
  for (const slug of [...edges.keys()].sort()) visit(slug);

  let backlinkCalls = 0;
  let backlinkComplete = true;
  let backlinkDetail: string | undefined;

  async function readBacklinks(slug: string): Promise<BacklinkRead> {
    const rows = new Map<string, { slug: string }>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let scanned = 0;
    let complete = true;
    let detail: string | undefined;
    const maxPages = opts.maxBacklinkPages ?? DEFAULT_MAX_BACKLINK_PAGES;
    const maxRows = opts.maxBacklinkRows ?? DEFAULT_MAX_BACKLINK_ROWS;

    while (true) {
      const result = await gbrain.getBacklinks(slug, {
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      backlinkCalls++;
      pages++;
      if (!result.ok) {
        complete = false;
        detail = shortMessage(result);
        break;
      }
      if (!isCompleteCoverageState(result.coverage.state) || result.coverage.degraded) {
        complete = false;
        detail = `backlink coverage ${result.coverage.state}${result.coverage.degraded ? " (degraded)" : ""}`;
      }
      scanned += result.rows.length;
      for (const row of result.rows) rows.set(row.slug, { slug: row.slug });
      if (!result.truncated) break;
      if (result.cursor === undefined) {
        complete = false;
        detail = "backlink response was truncated without a cursor";
        break;
      }
      if (cursors.has(result.cursor)) {
        complete = false;
        detail = "backlink cursor repeated";
        break;
      }
      cursors.add(result.cursor);
      if (pages >= maxPages || scanned >= maxRows) {
        complete = false;
        detail = "backlink page/row budget exhausted before the cursor ended";
        break;
      }
      cursor = result.cursor;
    }
    return { rows: [...rows.values()], complete, ...(detail !== undefined ? { detail } : {}) };
  }

  for (const oldSlug of superseded.sort()) {
    const first = await readBacklinks(oldSlug);
    if (!first.complete) {
      backlinkComplete = false;
      backlinkDetail ??= first.detail;
      addFinding({
        code: "memory.supersedes.backlink_partial",
        severity: "unknown",
        slug: oldSlug,
        message: first.detail ?? "backlink coverage is incomplete",
      });
    }
    const candidates: string[] = [];
    for (const row of first.rows) {
      const candidate = await loadPage(row.slug, "backlink");
      if (candidate === null) continue;
      if (declaresSupersedes(candidate.parsed.body, oldSlug)) candidates.push(row.slug);
    }
    if (candidates.length === 0) {
      addFinding({
        code: first.complete
          ? "memory.supersedes.replacement_missing"
          : "memory.supersedes.replacement_unverified",
        severity: first.complete ? "error" : "unknown",
        slug: oldSlug,
        message: first.complete
          ? "status:superseded page has no backlink candidate that explicitly declares Supersedes"
          : "no explicit replacement was found in the partial backlink coverage",
      });
      continue;
    }
    if (candidates.length > 1) {
      addFinding({
        code: "memory.supersedes.multiple_replacements",
        severity: "error",
        slug: oldSlug,
        message: `multiple explicit replacements found: ${candidates.sort().join(", ")}`,
      });
      continue;
    }

    let current = candidates[0];
    const chain = new Set([oldSlug]);
    let chainComplete = true;
    while (true) {
      if (chain.has(current)) {
        addFinding({
          code: "memory.supersedes.chain_cycle",
          severity: "error",
          slug: current,
          message: `replacement chain from ${oldSlug} cycles`,
        });
        chainComplete = false;
        break;
      }
      chain.add(current);
      const loaded = await loadPage(current, "backlink");
      if (loaded === null) {
        chainComplete = false;
        break;
      }
      const currentTags = loaded.tags;
      if (!currentTags.includes("status:superseded")) {
        if (currentTags.includes("status:deprecated") || currentTags.includes("status:archived")) {
          addFinding({
            code: "memory.supersedes.current_not_active",
            severity: "error",
            slug: current,
            message: `replacement of ${oldSlug} is ${lifecycleTags(currentTags).join(", ") || "not active"}`,
          });
        }
        break;
      }
      const next = await readBacklinks(current);
      if (!next.complete) {
        backlinkComplete = false;
        backlinkDetail ??= next.detail;
        addFinding({
          code: "memory.supersedes.backlink_partial",
          severity: "unknown",
          slug: current,
          message: next.detail ?? "backlink coverage is incomplete",
        });
      }
      const nextCandidates: string[] = [];
      for (const row of next.rows) {
        const candidate = await loadPage(row.slug, "backlink");
        if (candidate !== null && declaresSupersedes(candidate.parsed.body, current)) {
          nextCandidates.push(row.slug);
        }
      }
      if (nextCandidates.length !== 1) {
        addFinding({
          code: "memory.supersedes.chain_ambiguous",
          severity: "error",
          slug: current,
          message: `expected one explicit replacement, found ${nextCandidates.length}`,
        });
        chainComplete = false;
        break;
      }
      current = nextCandidates[0];
    }
    if (!chainComplete && first.complete) {
      // The exact failure is already recorded; this marker keeps no false
      // "complete chain" claim in the summary.
      backlinkComplete = false;
    }
  }

  const backlinksCoverage: MemoryCheckReport["coverage"]["backlinks"] = {
    state:
      superseded.length === 0
        ? "not_applicable"
        : backlinkComplete
          ? "complete"
          : "partial",
    ...(superseded.length === 0 ? { detail: "no status:superseded pages" } : {}),
    ...(backlinkDetail !== undefined ? { detail: backlinkDetail } : {}),
    checked_pages: superseded.length,
    calls: backlinkCalls,
  };

  const complete =
    inventory.complete &&
    ownedRows.every((row) => !failures.has(row.slug)) &&
    backlinksCoverage.state !== "partial" &&
    filehubCoverage.state !== "unknown";
  const status = checkStatus(findings, complete);
  return {
    schema_version: 1,
    status,
    coverage: {
      pages: pageCoverage,
      backlinks: backlinksCoverage,
      filehub: filehubCoverage,
    },
    counts: {
      owned_pages: ownedRows.length,
      by_role: byRole,
      historical_metadata: historicalMetadata,
      findings: countFindings(findings),
    },
    findings,
  };
}

export function renderMemoryCheck(report: MemoryCheckReport): { lines: string[]; exitCode?: number } {
  const f = report.counts.findings;
  const lines = [
    `jspace: memory check: ${report.status} (${report.counts.owned_pages} owned page(s); ${f.error} error, ${f.warning} warning, ${f.unknown} unknown)`,
    `  pages: ${report.coverage.pages.state} (${report.coverage.pages.scanned_rows} row(s), ${report.coverage.pages.list_calls} list call(s))`,
    `  backlinks: ${report.coverage.backlinks.state} (${report.coverage.backlinks.checked_pages} superseded page(s), ${report.coverage.backlinks.calls} call(s))`,
    `  filehub: ${report.coverage.filehub.state}`,
  ];
  if (report.counts.historical_metadata.pages > 0) {
    lines.push(
      `  historical metadata: ${report.counts.historical_metadata.pages} page(s) retain unknown provenance/owner metadata; not backfilled`,
    );
  }
  for (const finding of report.findings) {
    const location = finding.slug ?? finding.path;
    lines.push(`  [${finding.severity}] ${finding.code}${location ? ` (${location})` : ""}: ${finding.message}`);
  }
  lines.push("jspace: memory check is read-only; no page was modified");
  return { lines, ...(report.status === "ok" ? {} : { exitCode: 1 }) };
}
