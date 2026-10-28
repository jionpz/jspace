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
  classifyMemoryPage,
  declaresSupersedes,
  derivedSourceSlug,
  hasInactiveStatus,
  isKnowledgeRole,
  lifecycleTags,
  memoryOwnerEquals,
  memoryRole,
  normalizeTopic,
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
import {
  bundleMetadataFromFields,
  entryMember,
  manifestIdentityIssues,
  readBundleManifest,
} from "../filehub/bundle.ts";
import { bundleManifestRelPath } from "../../core/contracts/asset-bundle.ts";

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_LIST_PAGES = 50;
const DEFAULT_MAX_LIST_ROWS = 5000;
const DEFAULT_MAX_BACKLINK_PAGES = 20;
const DEFAULT_MAX_BACKLINK_ROWS = 1000;
const DEFAULT_MAX_DERIVED_PAGES = 200;
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
export interface MemoryCheckOptions {
  pageLimit?: number;
  maxListPages?: number;
  maxListRows?: number;
  maxBacklinkPages?: number;
  maxBacklinkRows?: number;
  stateSoftLimitBytes?: number;
  /** Cap on gbrain-generated pages (`atoms/*`, `extracts/*`) read for the
   *  derived-projection audit. Exceeding it marks that section partial instead
   *  of pretending the projections were all inspected. */
  maxDerivedPages?: number;
  /** Known owner ids for `knowledge/*`'s `project` field: the workbench's
   *  registered projects and domains. `knowledge/<domain>` carries the SOURCE
   *  project (see gbrain.md §4), so the rule is existence, not equality with the
   *  slug segment. Omit the option when the registry is unavailable: unknown is
   *  then reported, never silently passed. */
  knownOwners?: { projects: readonly string[]; domains: readonly string[] };
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

/** Counts for pages that are evidence ABOUT canonical pages, never current
 *  answers themselves. Kept separate from `by_role`, which counts only the
 *  JSpace canonical namespaces. */
interface DerivedProjectionCounts {
  atoms: number;
  extracts: number;
  /** Derived pages carrying a `source_slug` (the page they quote). */
  with_source_slug: number;
  /** Derived pages read for the duplicate/drift audit (bounded by
   *  `maxDerivedPages`). */
  inspected: number;
  /** Atoms generated twice from the same source page with the same title. */
  duplicate_atom_groups: number;
  /** Derived pages whose `source_slug` has no page (upstream provenance drift). */
  source_missing: number;
}

interface TopicCandidateCounts {
  /** Active canonical knowledge pages sharing one normalized title (deterministic:
   *  the same title written twice, with no Supersedes link either way). */
  duplicate_title_groups: number;
  /** Active canonical knowledge pages inspected for the check above. */
  inspected: number;
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
    /** Whether `memory.project.unknown` could be evaluated at all: `unknown`
     *  when the workbench registry was unavailable, so a clean report never
     *  implies the owner rule passed. */
    owners: CheckCoverage;
    /** How much of the derived (atoms/extracts) population was actually
     *  inspected; `partial` means the counts are a lower bound. */
    derived: CheckCoverage;
  };
  counts: {
    owned_pages: number;
    by_role: Partial<Record<MemoryRole, number>>;
    historical_metadata: HistoricalMetadataGaps;
    derived: DerivedProjectionCounts;
    topics: TopicCandidateCounts;
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

/** Validate bundle page scalars, manifest identity and entry membership. This
 *  deliberately does not walk the target tree; filehub check owns tree proof. */
function verifyBundlePageMetadata(
  loaded: LoadedPage,
  ownerId: string,
  filehubPath: string | null,
  addFinding: (finding: CheckFinding) => void,
): void {
  const slug = loaded.page.slug;
  const fields = loaded.parsed.fields;
  const bundleFields = [
    "bundle_root",
    "bundle_manifest",
    "bundle_sha256",
    "bundle_manifest_sha256",
  ].filter((field) => fields[field] !== undefined);
  if (fields.asset_kind !== "bundle") {
    if (bundleFields.length > 0) {
      addFinding({
        code: "memory.asset.bundle_fields_unexpected",
        severity: "error",
        slug,
        message: `bundle fields require asset_kind: bundle (found ${bundleFields.join(", ")})`,
      });
    }
    return;
  }
  const parsed = bundleMetadataFromFields(fields);
  if (!parsed.ok) {
    addFinding({
      code: "memory.asset.bundle_metadata_invalid",
      severity: "error",
      slug,
      message: parsed.detail,
    });
    return;
  }
  const metadata = parsed.metadata;
  const ownerKind = metadata.bundleRoot.startsWith("areas/") ? "area" : "project";
  const ownerPrefix = `${ownerKind === "area" ? "areas" : "projects"}/${ownerId}`;
  if (
    metadata.bundleRoot === ownerPrefix ||
    !metadata.bundleRoot.startsWith(`${ownerPrefix}/`)
  ) {
    addFinding({
      code: "memory.asset.bundle_root_owner",
      severity: "error",
      slug,
      path: metadata.bundleRoot,
      message: `bundle_root must be a directory strictly inside ${ownerPrefix}/`,
    });
  }
  const manifestMatch = metadata.bundleManifest.match(/\/\.jspace\/bundles\/([0-9a-f]{64})\.json$/);
  const expectedManifestName = bundleManifestRelPath("owner", slug).split("/").at(-1);
  if (
    manifestMatch === null ||
    !metadata.bundleManifest.startsWith(`${ownerPrefix}/`) ||
    `${manifestMatch[1]}.json` !== expectedManifestName
  ) {
    addFinding({
      code: "memory.asset.bundle_manifest_path",
      severity: "error",
      slug,
      path: metadata.bundleManifest,
      message: "bundle_manifest must be the managed <ownerRoot>/.jspace/bundles/<sha256(slug)>.json path",
    });
    return;
  }
  const relPath = fields.rel_path;
  if (relPath === undefined || !relPath.startsWith(`${metadata.bundleRoot}/`)) {
    addFinding({
      code: "memory.asset.bundle_entry_outside",
      severity: "error",
      slug,
      path: relPath,
      message: "bundle page rel_path must be a file inside bundle_root",
    });
    return;
  }
  if (filehubPath === null) return;

  const read = readBundleManifest(filehubPath, metadata.bundleManifest);
  if (read.state !== "ok" || read.manifest === undefined || read.manifestSha256 === undefined) {
    addFinding({
      code: "memory.asset.bundle_manifest_unreadable",
      severity: "unknown",
      slug,
      path: metadata.bundleManifest,
      message: `bundle manifest cannot be verified here: ${read.detail ?? read.state}`,
    });
    return;
  }
  if (read.manifestSha256 !== metadata.bundleManifestSha256) {
    addFinding({
      code: "memory.asset.bundle_manifest_changed",
      severity: "error",
      slug,
      path: metadata.bundleManifest,
      message: "bundle_manifest_sha256 does not match the manifest bytes",
    });
    return;
  }
  if (read.manifest.aggregateSha256 !== metadata.bundleSha256) {
    addFinding({
      code: "memory.asset.bundle_aggregate_changed",
      severity: "error",
      slug,
      path: metadata.bundleManifest,
      message: "bundle_sha256 does not match the manifest aggregate",
    });
  }
  const manifestEntry = read.manifest.entry;
  const expectedEntry = relPath.slice(metadata.bundleRoot.length + 1);
  const identity = manifestIdentityIssues(read.manifest, {
    ownerKind,
    ownerId,
    slug,
    rootRelPath: metadata.bundleRoot,
    entry: manifestEntry,
  });
  if (identity.length > 0) {
    addFinding({
      code: "memory.asset.bundle_manifest_identity",
      severity: "error",
      slug,
      path: metadata.bundleManifest,
      message: identity.join("; "),
    });
  }
  if (manifestEntry !== expectedEntry) {
    addFinding({
      code: "memory.asset.bundle_entry_mismatch",
      severity: "error",
      slug,
      path: relPath,
      message: `manifest entry ${manifestEntry} does not match rel_path ${relPath}`,
    });
  }
  const entry = entryMember(read.manifest);
  if (entry === null) {
    addFinding({
      code: "memory.asset.bundle_entry_invalid",
      severity: "error",
      slug,
      path: relPath,
      message: "manifest entry is not a regular member file",
    });
    return;
  }
  const sourceDigest = fields.source_sha256;
  if (sourceDigest === undefined) {
    addFinding({
      code: "memory.asset.bundle_source_digest_missing",
      severity: "error",
      slug,
      path: relPath,
      message: "bundle page requires source_sha256 equal to the entry digest",
    });
  } else if (/^[0-9a-f]{64}$/.test(sourceDigest) && sourceDigest !== entry.sha256) {
    addFinding({
      code: "memory.asset.bundle_source_digest_mismatch",
      severity: "error",
      slug,
      path: relPath,
      message: "source_sha256 does not match the manifest entry digest",
    });
  }
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

  async function loadPage(slug: string, owner: "inventory" | "supersedes" | "backlink" | "derived"): Promise<LoadedPage | null> {
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
        // an owned row reduces page coverage. Derived pages are aggregated
        // into `coverage.derived` instead of one finding per atom — a broken
        // extraction backlog can be hundreds of pages.
        if (owner !== "derived" && !(owner === "supersedes" && got.code === "not_found")) {
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

  // Known owners for the `knowledge/*` provenance rule. Two sources, both
  // needed and neither sufficient:
  //   - the workbench REGISTRY (hub.json) lists only projects carrying filehub
  //     assets — 4 of 15 on the live brain — so it alone reported 14 real
  //     projects (`keel`, `jspace`, `viocein` …) as invented;
  //   - a `project/<id>/state` card is the brain's own declaration that project
  //     `<id>` exists, which is exactly the question asked.
  // State cards only (not any `project/<id>/*` page): otherwise a fabricated
  // page would legitimise its own id.
  const declaredProjects = new Set<string>();
  for (const row of inventory.rows) {
    const stateId = /^project\/([^/]+)\/state$/.exec(row.slug)?.[1];
    if (stateId !== undefined) declaredProjects.add(stateId);
  }
  const knownOwners =
    opts.knownOwners === undefined && declaredProjects.size === 0
      ? undefined
      : {
          projects: [...new Set([...(opts.knownOwners?.projects ?? []), ...declaredProjects])],
          domains: [...new Set(opts.knownOwners?.domains ?? [])],
        };

  // Coverage, not per-page noise: when neither source is available the rule did
  // not run, and a clean report must not be read as "every owner id is real".
  // Counted, not assumed: `not_applicable` when no knowledge page declares a
  // project (nothing was skipped), `unknown` only when something was.
  let ownerChecksSkipped = 0;
  const ownersCoverage = (): CheckCoverage => {
    if (knownOwners !== undefined) return { state: "complete" };
    if (ownerChecksSkipped === 0) {
      return { state: "not_applicable", detail: "no knowledge page declares a source project" };
    }
    return {
      state: "unknown",
      detail: `no workbench registry and no project state card; ${ownerChecksSkipped} knowledge page(s) name a project that could not be verified`,
    };
  };

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
      // `knowledge/*` is exempt: its `project` records the SOURCE project, and a
      // cross-project fact legitimately has none (gbrain.md §4). Requiring it
      // there would push writers to invent an owner — the exact failure the
      // `memory.project.unknown` rule exists to catch.
      if (role === "knowledge") {
        // no gap recorded: "absent" is the honest state for this role
      } else if (current) {
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
    } else if (role === "knowledge") {
      // `knowledge/<domain>` writes the SOURCE project, not the domain: the
      // domain segment is retrieval grouping, the project is provenance. So the
      // rule is "a known owner", not "equals the slug segment" — plus an
      // explicit "missing is fine": a cross-project fact has no source project
      // and must stay blank rather than borrow one. Unknown owner ids are the
      // real defect this catches (the live brain had `gbrain-infra` on three
      // pages and `synology-drive` on one; neither exists in any registry).
      if (fields.project !== undefined && fields.project !== "") {
        const owners = knownOwners;
        // No known-owner source means the rule was not applied — that is ONE
        // coverage fact (`coverage.owners: unknown`), not one finding per
        // knowledge page. Per-page "cannot verify" would drown the report and
        // say nothing the coverage line does not already say.
        if (owners === undefined) {
          ownerChecksSkipped += 1;
        } else if (!owners.projects.includes(fields.project) && !owners.domains.includes(fields.project)) {
          addFinding({
            code: "memory.project.unknown",
            severity: "warning",
            slug,
            message: `frontmatter project ${fields.project} is not a registered project or domain in this workbench; knowledge pages name their source project, so leave it blank instead of inventing one`,
          });
        }
      }
    } else if (role === "project-decision" || role === "project-lesson" || role === "project-record" || role === "profile") {
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
    } else if (role === "asset" && !hasInactiveStatus(tags)) {
      const ownerId = assetOwnerForSlug(slug);
      if (!memoryOwnerEquals(fields.project, ownerId)) {
        addFinding({
          code: "memory.asset_owner.mismatch",
          severity: "error",
          slug,
          message: `frontmatter project ${fields.project ?? "<missing>"} must equal asset owner ${ownerId ?? "<missing>"}`,
        });
      }
      verifyBundlePageMetadata(loaded, ownerId ?? "", filehubPath, addFinding);
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

  // ---- derived projections (atoms / extracts) ----
  // gbrain generates these from a `source_slug` page. They are evidence about
  // that page, never the current answer, and they are NOT in the JSpace
  // canonical namespaces — so they are audited separately and never counted as
  // owned pages. Nothing here writes, merges or deletes anything.
  const derivedRows = inventory.rows.filter((row) => classifyMemoryPage(row.slug, []) === "derived");
  const derived: DerivedProjectionCounts = {
    atoms: derivedRows.filter((row) => row.slug.startsWith("atoms/")).length,
    extracts: derivedRows.filter((row) => row.slug.startsWith("extracts/")).length,
    with_source_slug: 0,
    inspected: 0,
    duplicate_atom_groups: 0,
    source_missing: 0,
  };
  const derivedBudget = opts.maxDerivedPages ?? DEFAULT_MAX_DERIVED_PAGES;
  const derivedToRead = derivedRows.slice(0, derivedBudget);
  // The derived population comes from the same keyset as the inventory, so a
  // partial inventory makes every derived count a lower bound too — say so
  // instead of reporting "complete" over a population that was never listed.
  const derivedDetail = [
    derivedRows.length > derivedToRead.length
      ? `derived audit covered ${derivedToRead.length} of ${derivedRows.length} page(s) (maxDerivedPages)`
      : undefined,
    inventory.complete ? undefined : "derived population comes from a partial page inventory, so the counts are lower bounds",
  ].filter((part): part is string => part !== undefined);
  const derivedCoverage: CheckCoverage =
    derivedDetail.length > 0 ? { state: "partial", detail: derivedDetail.join("; ") } : { state: "complete" };
  const inventorySlugs = new Set(inventory.rows.map((row) => row.slug));
  const atomGroups = new Map<string, string[]>();
  const missingSources = new Map<string, string[]>();
  let derivedReadFailures = 0;
  await mapLimit(derivedToRead, GET_CONCURRENCY, async (row) => {
    // Reuse the shared page cache: an owned page is already loaded, and a
    // derived page read once must not be read twice by another rule.
    const loaded = await loadPage(row.slug, "derived");
    if (loaded === null) {
      derivedReadFailures++;
      return;
    }
    derived.inspected++;
    const source = derivedSourceSlug(loaded.parsed.fields);
    if (source !== undefined) {
      derived.with_source_slug++;
      // Coverage honesty: a missing source page only means drift when the
      // inventory is complete. With a partial keyset the page may simply not
      // have been listed yet.
      if (inventory.complete && !inventorySlugs.has(source)) {
        derived.source_missing++;
        const group = missingSources.get(source);
        if (group === undefined) missingSources.set(source, [row.slug]);
        else group.push(row.slug);
      }
    }
    if (row.slug.startsWith("atoms/") && source !== undefined) {
      const title = normalizeTopic(loaded.parsed.fields.title ?? loaded.page.title ?? "");
      if (title !== "") {
        const key = `${source}\u0000${title}`;
        const group = atomGroups.get(key);
        if (group === undefined) atomGroups.set(key, [row.slug]);
        else group.push(row.slug);
      }
    }
  });
  if (derivedReadFailures > 0) {
    derivedCoverage.state = "partial";
    // Append rather than replace: a capped audit that ALSO failed reads must
    // report both, otherwise "2 of 5" hides that one of the 2 was unreadable.
    const note = `${derivedReadFailures} derived page(s) could not be read`;
    derivedCoverage.detail =
      derivedCoverage.detail === undefined ? note : `${derivedCoverage.detail}; ${note}`;
  }
  for (const [key, slugs] of [...atomGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (slugs.length < 2) continue;
    derived.duplicate_atom_groups++;
    // Same source page, same title, generated more than once: re-extraction
    // produced a second copy. Deterministic and safe to report; the fix is a
    // human decision on the gbrain side (this command never writes).
    addFinding({
      code: "memory.derived.duplicate_atom",
      severity: "warning",
      slug: slugs.sort()[0],
      message: `${slugs.length} atoms from ${key.split("\u0000")[0]} share the same title: ${slugs.sort().join(", ")}`,
    });
  }
  for (const [source, slugs] of [...missingSources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    addFinding({
      code: "memory.derived.source_missing",
      severity: "unknown",
      slug: slugs.sort()[0],
      message: `${slugs.length} derived page(s) quote source_slug ${source}, which no page owns`,
    });
  }

  // ---- deterministic topic duplicates among active canonical knowledge ----
  // Only the same normalized title written twice with no Supersedes link either
  // way. Semantic near-duplicates are deliberately NOT reported: this command
  // has no embeddings and a heuristic threshold would present "similar wording"
  // as a proven duplicate. Such cases stay for human review (see the audit doc).
  const topics: TopicCandidateCounts = { duplicate_title_groups: 0, inspected: 0 };
  const titleGroups = new Map<string, { slug: string; targets: Set<string> }[]>();
  for (const [slug, loaded] of cache.entries()) {
    const role = memoryRole(slug);
    // Topic pages only: decisions / lessons / cross-project knowledge. Sparse
    // `records/project/*` events are dated and may legitimately repeat a title
    // ("release"), so including them would report noise as a duplicate.
    if (role !== "project-decision" && role !== "project-lesson" && role !== "knowledge") continue;
    if (classifyMemoryPage(slug, loaded.tags) !== "canonical") continue;
    const title = normalizeTopic(loaded.parsed.fields.title ?? loaded.page.title ?? "");
    if (title === "") continue;
    topics.inspected++;
    const entry = { slug, targets: new Set(supersedesTargets(loaded.parsed.body)) };
    const group = titleGroups.get(title);
    if (group === undefined) titleGroups.set(title, [entry]);
    else group.push(entry);
  }
  for (const [title, group] of [...titleGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    // Two pages are related when either declares Supersedes for the other; a
    // one-directional link is the canonical replacement protocol, not a dup.
    // Group by relationship CHAINS rather than dropping the whole cluster: a
    // title shared by {A, B linked} and an unrelated C is one replacement chain
    // PLUS one duplicate, and reporting "no Supersedes relation" over all three
    // would be false.
    const parent = new Map<string, string>(group.map((page) => [page.slug, page.slug]));
    const find = (slug: string): string => {
      let root = slug;
      while (parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    for (const left of group) {
      for (const right of group) {
        if (left === right) continue;
        if (!left.targets.has(right.slug) && !right.targets.has(left.slug)) continue;
        const [a, b] = [find(left.slug), find(right.slug)];
        if (a !== b) parent.set(a, b);
      }
    }
    const chains = new Map<string, string[]>();
    for (const page of group) {
      const root = find(page.slug);
      const chain = chains.get(root);
      if (chain === undefined) chains.set(root, [page.slug]);
      else chain.push(page.slug);
    }
    if (chains.size < 2) continue;
    const described = [...chains.values()].map((chain) => chain.sort().join(" + ")).sort();
    topics.duplicate_title_groups++;
    addFinding({
      code: "memory.topics.duplicate_title",
      severity: "warning",
      slug: described[0].split(" + ")[0],
      message: `title "${title}" is claimed by ${chains.size} unrelated page chain(s): ${described.join(" | ")}`,
    });
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

  // Evaluated here, after every page: the state depends on how many owner
  // checks were actually skipped. It feeds `complete` below for the same reason
  // filehub does — an unverified rule must not leave the report looking clean.
  const owners = ownersCoverage();
  const complete =
    inventory.complete &&
    ownedRows.every((row) => !failures.has(row.slug)) &&
    backlinksCoverage.state !== "partial" &&
    filehubCoverage.state !== "unknown" &&
    owners.state !== "unknown" &&
    derivedCoverage.state !== "partial";
  const status = checkStatus(findings, complete);
  return {
    schema_version: 1,
    status,
    coverage: {
      pages: pageCoverage,
      backlinks: backlinksCoverage,
      filehub: filehubCoverage,
      owners,
      derived: derivedCoverage,
    },
    counts: {
      owned_pages: ownedRows.length,
      by_role: byRole,
      historical_metadata: historicalMetadata,
      derived,
      topics,
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
    `  owners: ${report.coverage.owners.state}`,
    `  derived: ${report.coverage.derived.state} (${report.counts.derived.atoms} atom(s), ${report.counts.derived.extracts} extract(s); ${report.counts.derived.inspected} inspected, never served as current answers)`,
    `  topics: ${report.counts.topics.inspected} canonical page(s) with a title, ${report.counts.topics.duplicate_title_groups} duplicate-title group(s)`,
  ];
  if (report.coverage.derived.detail !== undefined) {
    lines.push(`  derived coverage: ${report.coverage.derived.detail}`);
  }
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
