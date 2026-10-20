// application/context/project-states.ts — project status collection for the
// session-start injection leg (R3). Unlike the synchronous workbench collectors
// (domains/pending/cron/inbox), this one reads gbrain through the async
// GbrainDeps port with a short per-call timeout: a stalled gbrain must never
// block a harness hook (settings.json caps session-start at 10s).
//
// Two read purposes are kept apart on purpose:
//   * full audits (`application/gbrain/page-inventory.ts`) walk `updated_asc`
//     keyset pages with no deadline;
//   * "recent" selection here reads a bounded `updated_desc` window and reports
//     complete / partial / failed instead of pretending a page is the whole set.
// A failure never throws; it becomes a typed status the payload can show.
import type {
  GbrainDeps,
  GbrainErrorCode,
  GbrainListResult,
  GbrainListRow,
} from "../../core/contracts/gbrain.ts";
import { listPageInventory } from "../gbrain/page-inventory.ts";

/** Max project state cards surfaced in the session-start injection line. */
export const MAX_ACTIVE_PROJECTS = 8;

/** Max workbench preference cards surfaced in the session-start injection line.
 *  Independent of MAX_ACTIVE_PROJECTS — profiles must not crowd out projects. */
export const MAX_ACTIVE_PROFILES = 4;

/** Per-call gbrain budget — short so a stuck gbrain releases the hook fast;
 *  far under the 10s session-start hook cap even with a retry. */
export const PROJECT_COLLECT_TIMEOUT_MS = 2000;

/** Absolute read deadline shared by the three collectors in one session-start.
 *  Not `2s × pages`: a single slow request may consume the rest of the budget,
 *  after which no new call is dispatched. Leaves ~6s for process kill grace and
 *  payload rendering under the 10s hook cap. */
export const CONTEXT_READ_DEADLINE_MS = 4000;

/** Total body reads the three collectors may spend together. A page of 100
 *  candidates must not become 100 process spawns. */
export const CONTEXT_CANDIDATE_TOTAL = 32;

/** Per-dimension share of the candidate budget, so one dimension cannot starve
 *  the others. */
export const CONTEXT_CANDIDATE_LIMITS: Record<ContextCollectorKind, number> = {
  projects: 12,
  profiles: 8,
  knowledge: 12,
};

/** Max concurrent `gbrain get` spawns per batch. Every get is a process spawn
 *  (~0.5s, almost all startup cost), so serial fetching dominated the
 *  session-start hook (measured 4.87s / 20 calls / 6 serial waves against a 10s
 *  cap). The bound keeps a 100-row candidate list from spawning 100 processes
 *  at once; measured safe at 32 concurrent.
 *
 *  Value picked by sweep on the live workbench (9 projects + 8 profiles + 25
 *  knowledge candidates): 4 -> 2.33s, 8 -> 2.06s, 12 -> 1.71s, 16 -> 1.82s,
 *  24 -> 2.09s. 12 is the measured optimum — past it the extra spawns contend
 *  more than they overlap. */
export const GET_CONCURRENCY = 12;

/** Page size per collector, unchanged from the single-page implementation. */
const PAGE_SIZE: Record<ContextCollectorKind, number> = { projects: 100, profiles: 100, knowledge: 50 };

/** A recent window never reads more than two pages. */
const MAX_PAGES = 2;

export type ContextCollectorKind = "projects" | "profiles" | "knowledge";
export type ContextReadStatus = "complete" | "partial" | "failed";

export type ContextReadIssue =
  | { kind: "list_error"; code: GbrainErrorCode }
  | { kind: "later_list_error"; code: GbrainErrorCode }
  | { kind: "page_budget"; pages: number }
  | { kind: "row_budget"; rows: number }
  | { kind: "candidate_budget"; reads: number }
  | { kind: "deadline"; elapsedMs: number }
  | { kind: "desc_offset"; pages: number }
  | { kind: "page_drift"; detail: string }
  | { kind: "page_read_error"; count: number; codes: GbrainErrorCode[] }
  | { kind: "unexpected"; message: string };

export interface ContextReadStats {
  pagesRead: number;
  rowsScanned: number;
  candidatesRead: number;
}

export interface ContextCollection<T> {
  items: T[];
  status: ContextReadStatus;
  issues: ContextReadIssue[];
  stats: ContextReadStats;
}

/** Lightweight projection carried on WorkbenchState (the items themselves stay
 *  in their existing arrays). */
export interface ContextReadSummary {
  status: ContextReadStatus;
  issues: ContextReadIssue[];
  pagesRead: number;
  rowsScanned: number;
}

export function toContextReadSummary(collection: ContextCollection<unknown>): ContextReadSummary {
  return {
    status: collection.status,
    issues: collection.issues,
    pagesRead: collection.stats.pagesRead,
    rowsScanned: collection.stats.rowsScanned,
  };
}

/** Boundary defense: a collector that somehow throws still becomes a typed
 *  failed collection instead of an empty list that looks like "no data". */
export function failedCollection<T>(message: string): ContextCollection<T> {
  return {
    items: [],
    status: "failed",
    issues: [{ kind: "unexpected", message }],
    stats: { pagesRead: 0, rowsScanned: 0, candidatesRead: 0 },
  };
}

/** Boundary defense: a collector that somehow throws still becomes a typed
 *  failed summary instead of an empty list that looks like "no data". */
export function failedReadSummary(message: string): ContextReadSummary {
  return {
    status: "failed",
    issues: [{ kind: "unexpected", message }],
    pagesRead: 0,
    rowsScanned: 0,
  };
}

/** Shared budget for one session-start read: a monotonic deadline plus an
 *  atomically reserved candidate-read quota. */
export interface ContextReadBudget {
  readonly deadlineAt: number;
  hasTime(): boolean;
  remainingMs(): number;
  elapsedMs(): number;
  /** Timeout for the next call: never more than the adapter cap, never more
   *  than what is left of the deadline. */
  callTimeoutMs(): number;
  /** Reserve up to `wanted` body reads for `kind`; returns how many were
   *  granted (0 once the total or per-dimension quota is spent). */
  reserveCandidates(kind: ContextCollectorKind, wanted: number): number;
}

export interface ContextReadBudgetOptions {
  deadlineMs?: number;
  totalCandidates?: number;
  perCollector?: Partial<Record<ContextCollectorKind, number>>;
  /** Injectable clock for tests. */
  now?: () => number;
}

export function createContextReadBudget(opts: ContextReadBudgetOptions = {}): ContextReadBudget {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const deadlineAt = startedAt + (opts.deadlineMs ?? CONTEXT_READ_DEADLINE_MS);
  const total = opts.totalCandidates ?? CONTEXT_CANDIDATE_TOTAL;
  const per: Record<ContextCollectorKind, number> = { ...CONTEXT_CANDIDATE_LIMITS, ...opts.perCollector };
  let usedTotal = 0;
  const usedByKind: Record<ContextCollectorKind, number> = { projects: 0, profiles: 0, knowledge: 0 };

  return {
    deadlineAt,
    hasTime: () => now() < deadlineAt,
    remainingMs: () => Math.max(0, deadlineAt - now()),
    elapsedMs: () => Math.max(0, now() - startedAt),
    callTimeoutMs: () => {
      const remaining = Math.floor(deadlineAt - now());
      return Math.max(1, Math.min(PROJECT_COLLECT_TIMEOUT_MS, remaining));
    },
    reserveCandidates(kind, wanted) {
      if (wanted <= 0) return 0;
      const available = Math.min(wanted, total - usedTotal, per[kind] - usedByKind[kind]);
      if (available <= 0) return 0;
      usedTotal += available;
      usedByKind[kind] += available;
      return available;
    },
  };
}

export interface ProjectState {
  /** ascii project id (slug namespace `project/<id>/state`). */
  id: string;
  /** First line of the state card's "现在到哪了" section, else the title. */
  summary: string;
  /** updated_at date (YYYY-MM-DD) from gbrain list. */
  updatedAt: string;
}

export interface CollectActiveProjectsOptions {
  /** hub.json projects with status archived — excluded even when the state card
   *  lacks a status:archived tag (registry truth for ended projects). Excluded
   *  before the body read, so needing no candidate budget. */
  excludeProjectIds?: ReadonlySet<string>;
  /** Shared with the other collectors in one session-start read. */
  budget?: ContextReadBudget;
}

export interface ProfileState {
  /** Theme segment of slug `profile/<主题>` (may be Chinese). */
  theme: string;
  /** First non-heading content line after frontmatter, else "". */
  summary: string;
  /** updated_at date (YYYY-MM-DD) from gbrain list. */
  updatedAt: string;
}

/** Parse the `tags:` entry from a gbrain note frontmatter (minimal YAML subset).
 *  Accepts both styles the store actually contains:
 *    tags: [project, source:session]      (inline flow)
 *    tags:\n  - project\n  - 'source:session'  (block sequence)
 *  Only the inline form was parsed before, so every block-style page silently
 *  lost its tags — `status:archived` / `weekly` / `status:superseded` gates
 *  never fired for them. Quotes are stripped, not preserved.
 */
export function parseNoteTags(body: string): string[] {
  if (!body.startsWith("---")) return [];
  const end = body.indexOf("\n---", 3);
  if (end < 0) return [];
  const fm = body.slice(3, end);
  const inline = fm.match(/^tags:[ \t]*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(",").map((t) => t.trim()).filter(Boolean);
  const block = fm.match(/^tags:[ \t]*\n((?:[ \t]+-[^\n]*\n?)*)/m);
  if (!block) return [];
  return block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.slice(1).trim().replace(/^[\'"]|[\'"]$/g, ""))
    .filter(Boolean);
}

/** True when the note carries `status:archived` (retrieval-side lifecycle tag). */
export function isArchivedGbrainNote(body: string): boolean {
  return parseNoteTags(body).includes("status:archived");
}

interface RecentCollectSpec<T> {
  kind: ContextCollectorKind;
  tag: string;
  pageSize: number;
  maxPages: number;
  target: number;
  /** Namespace / registry filter. Runs before any body read. */
  matches: (row: GbrainListRow) => boolean;
  /** Lifecycle filter. Runs on the fetched body; an unreadable body is kept. */
  acceptsBody: (body: string) => boolean;
  build: (row: GbrainListRow, content: string | undefined) => T;
}

const PROJECT_STATE_SLUG = /^project\/([^/]+)\/state$/;
const PROFILE_SLUG = /^profile\/[^/]+$/;
const RECENT_KNOWLEDGE_SLUG = /^project\/[^/]+\/(?:decisions|lessons)\//;

/** Bounded "most recent" collection shared by the three dimensions.
 *
 *  Order of operations is the contract: namespace filter → body read →
 *  lifecycle filter → slot backfill. Skipped rows never consume a slot, and a
 *  candidate whose body cannot be read is kept (unknown is not "archived").
 *  Status is computed from what actually happened, never from "no items". */
async function collectRecent<T>(
  gbrain: GbrainDeps,
  budget: ContextReadBudget,
  spec: RecentCollectSpec<T>,
): Promise<ContextCollection<T>> {
  const items: T[] = [];
  const issues: ContextReadIssue[] = [];
  const stats: ContextReadStats = { pagesRead: 0, rowsScanned: 0, candidatesRead: 0 };
  const seen = new Set<string>();
  const readErrorCodes: GbrainErrorCode[] = [];
  let readErrorCount = 0;
  let usedSecondPage = false;
  let drifted = false;
  let lastBoundary: { updatedAt: string; slug: string } | undefined;
  let offset: number | undefined;

  const finish = (status: ContextReadStatus): ContextCollection<T> => {
    if (readErrorCount > 0) {
      issues.push({ kind: "page_read_error", count: readErrorCount, codes: [...new Set(readErrorCodes)] });
      if (status === "complete") status = "partial";
    }
    if (drifted) {
      issues.push({ kind: "page_drift", detail: "desc page boundary repeated or moved forward" });
      if (status === "complete") status = "partial";
    }
    if (usedSecondPage) {
      issues.push({ kind: "desc_offset", pages: stats.pagesRead });
      if (status === "complete") status = "partial";
    }
    return { items, status, issues, stats };
  };

  for (;;) {
    if (stats.pagesRead >= spec.maxPages) {
      issues.push({ kind: "page_budget", pages: stats.pagesRead });
      return finish("partial");
    }
    if (!budget.hasTime()) {
      issues.push({ kind: "deadline", elapsedMs: budget.elapsedMs() });
      return finish(stats.pagesRead === 0 ? "failed" : "partial");
    }

    let listed: GbrainListResult;
    try {
      listed = await gbrain.listPages({
        tag: spec.tag,
        limit: spec.pageSize,
        sort: "updated_desc",
        ...(offset !== undefined ? { offset } : {}),
        timeoutMs: budget.callTimeoutMs(),
      });
    } catch (e) {
      issues.push({ kind: "unexpected", message: e instanceof Error ? e.message : String(e) });
      return finish(stats.pagesRead === 0 ? "failed" : "partial");
    }
    if (!listed.ok) {
      issues.push(
        stats.pagesRead === 0
          ? { kind: "list_error", code: listed.code }
          : { kind: "later_list_error", code: listed.code },
      );
      return finish(stats.pagesRead === 0 ? "failed" : "partial");
    }

    stats.pagesRead++;
    stats.rowsScanned += listed.rows.length;

    if (listed.rows.length > 0) {
      const first = listed.rows[0]!;
      if (lastBoundary !== undefined) {
        const repeated =
          first.updatedAt === lastBoundary.updatedAt && first.slug === lastBoundary.slug;
        if (repeated || first.updatedAt > lastBoundary.updatedAt) drifted = true;
      }
      const last = listed.rows.at(-1)!;
      lastBoundary = { updatedAt: last.updatedAt, slug: last.slug };
    }

    const candidates: GbrainListRow[] = [];
    for (const row of listed.rows) {
      if (seen.has(row.slug)) {
        drifted = true;
        continue;
      }
      seen.add(row.slug);
      if (spec.matches(row)) candidates.push(row);
    }

    let index = 0;
    let halted = false;
    let stoppedByDeadline = false;
    while (index < candidates.length && items.length < spec.target) {
      if (!budget.hasTime()) {
        issues.push({ kind: "deadline", elapsedMs: budget.elapsedMs() });
        stoppedByDeadline = true;
        break;
      }
      const wanted = Math.min(GET_CONCURRENCY, candidates.length - index);
      const reserved = budget.reserveCandidates(spec.kind, wanted);
      if (reserved === 0) {
        halted = true;
        break;
      }
      const batch = candidates.slice(index, index + reserved);
      for (const row of batch) {
        if (items.length >= spec.target) break;
        if (!budget.hasTime()) {
          issues.push({ kind: "deadline", elapsedMs: budget.elapsedMs() });
          stoppedByDeadline = true;
          break;
        }
        let content: string | undefined;
        try {
          const got = await gbrain.getPage(row.slug, { timeoutMs: budget.callTimeoutMs() });
          stats.candidatesRead++;
          if (got.ok) content = got.page.content;
          else {
            readErrorCount++;
            readErrorCodes.push(got.code);
          }
        } catch {
          stats.candidatesRead++;
          readErrorCount++;
          readErrorCodes.push("unknown");
        }
        // Unknown != excluded: keep the candidate, mark the read incomplete.
        if (content !== undefined && !spec.acceptsBody(content)) continue;
        if (items.length >= spec.target) break;
        items.push(spec.build(row, content));
      }
      if (stoppedByDeadline) break;
      index += reserved;
      if (items.length >= spec.target) break;
      if (reserved < wanted) {
        halted = true;
        break;
      }
    }

    if (halted) {
      issues.push({ kind: "candidate_budget", reads: stats.candidatesRead });
      return finish("partial");
    }
    if (stoppedByDeadline) return finish(stats.pagesRead === 0 ? "failed" : "partial");
    if (items.length >= spec.target) return finish("complete");
    if (listed.nextOffset === undefined) return finish("complete");
    if (stats.pagesRead >= spec.maxPages) {
      issues.push({ kind: "page_budget", pages: stats.pagesRead });
      return finish("partial");
    }
    if (!budget.hasTime()) {
      issues.push({ kind: "deadline", elapsedMs: budget.elapsedMs() });
      return finish("partial");
    }
    offset = listed.nextOffset;
    usedSecondPage = true;
  }
}

/** Collect active project state cards. Never throws.
 *
 *  Excludes: hub archived project ids (before the body read); state cards tagged
 *  status:archived (after it). Skipped rows do not consume MAX_ACTIVE_PROJECTS
 *  slots — the next eligible card fills the budget (PR #33 / fable P1 enforcement). */
export async function collectActiveProjects(
  gbrain: GbrainDeps,
  opts: CollectActiveProjectsOptions = {},
): Promise<ContextCollection<ProjectState>> {
  const excluded = opts.excludeProjectIds;
  return collectRecent<ProjectState>(gbrain, opts.budget ?? createContextReadBudget(), {
    kind: "projects",
    tag: "project",
    pageSize: PAGE_SIZE.projects,
    maxPages: MAX_PAGES,
    target: MAX_ACTIVE_PROJECTS,
    matches: (row) => {
      const match = PROJECT_STATE_SLUG.exec(row.slug);
      if (match === null) return false;
      return excluded?.has(match[1]!) !== true;
    },
    acceptsBody: (body) => !isArchivedGbrainNote(body),
    build: (row, content) => ({
      id: row.slug.slice("project/".length, -"/state".length),
      summary: content === undefined ? "" : summarizeStateCard(content),
      updatedAt: row.updatedAt,
    }),
  });
}

/** Collect active workbench preference cards (`profile/<主题>`). Never throws.
 *  Independent of collectActiveProjects (own list, own MAX_ACTIVE_PROFILES cap).
 *  Skipped archived / weekly rows do not consume slots. */
export async function collectActiveProfiles(
  gbrain: GbrainDeps,
  opts: { budget?: ContextReadBudget } = {},
): Promise<ContextCollection<ProfileState>> {
  return collectRecent<ProfileState>(gbrain, opts.budget ?? createContextReadBudget(), {
    kind: "profiles",
    tag: "profile",
    pageSize: PAGE_SIZE.profiles,
    maxPages: MAX_PAGES,
    target: MAX_ACTIVE_PROFILES,
    matches: (row) => PROFILE_SLUG.test(row.slug),
    acceptsBody: (body) => !isArchivedGbrainNote(body) && !parseNoteTags(body).includes("weekly"),
    build: (row, content) => ({
      theme: row.slug.slice("profile/".length),
      summary: content === undefined ? "" : summarizeProfilePage(content),
      updatedAt: row.updatedAt,
    }),
  });
}

/** First non-heading content line after frontmatter; truncate 80 + ellipsis.
 *  Preference pages have no "现在到哪了" section — do not reuse summarizeStateCard. */
export function summarizeProfilePage(body: string): string {
  const content = stripFrontmatter(body);
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const first = lines.find((l) => !l.startsWith("#"));
  return first ? (first.length > 80 ? `${first.slice(0, 80)}…` : first) : "";
}

/** Pull a one-line summary from a state card body: the first non-empty line of
 *  the "现在到哪了" section if present, else the first non-empty content line
 *  after the frontmatter. Falls back to "" — a card with no readable summary
 *  still renders its id (recency is the signal, not the summary).
 */
export function summarizeStateCard(body: string): string {
  const content = stripFrontmatter(body);
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const idx = lines.findIndex((l) => l.startsWith("## 现在到哪了"));
  if (idx >= 0) {
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("##")) break;
      if (l.length > 0) return l.length > 80 ? `${l.slice(0, 80)}…` : l;
    }
  }
  // Fallback: first content line that isn't a heading or a section marker.
  const first = lines.find((l) => !l.startsWith("#") && !l.startsWith("- [[") && !l.startsWith("**"));
  return first ? (first.length > 80 ? `${first.slice(0, 80)}…` : first) : "";
}

function stripFrontmatter(body: string): string {
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  return end >= 0 ? body.slice(end + 4) : body;
}

/** Max recent knowledge entries (decisions/lessons/knowledge) in session-start. */
export const MAX_RECENT_KNOWLEDGE = 5;

export interface RecentKnowledgeEntry {
  slug: string;
  /** First non-heading content line (truncated). */
  summary: string;
  updatedAt: string;
}

/** Collect recent decisions, lessons, and knowledge pages for session-start
 *  injection. Gives the AI awareness of what was learned in prior sessions,
 *  not just the current state — the missing "越用越懂我" signal. Never throws. */
export async function collectRecentKnowledge(
  gbrain: GbrainDeps,
  opts: { budget?: ContextReadBudget } = {},
): Promise<ContextCollection<RecentKnowledgeEntry>> {
  return collectRecent<RecentKnowledgeEntry>(gbrain, opts.budget ?? createContextReadBudget(), {
    kind: "knowledge",
    tag: "knowledge",
    pageSize: PAGE_SIZE.knowledge,
    maxPages: MAX_PAGES,
    target: MAX_RECENT_KNOWLEDGE,
    matches: (row) => RECENT_KNOWLEDGE_SLUG.test(row.slug) || row.slug.startsWith("knowledge/"),
    acceptsBody: (body) =>
      !isArchivedGbrainNote(body) && !parseNoteTags(body).includes("status:superseded"),
    build: (row, content) => ({
      slug: row.slug,
      summary: content === undefined ? "" : summarizeProfilePage(content),
      updatedAt: row.updatedAt,
    }),
  });
}

/** Full project overview for the overview view (R4): three-sentence skeleton
 *  (是什么·到哪了·下一步) plus related-project wikilinks. */
export interface ProjectOverview {
  id: string;
  what: string;
  now: string;
  next: string;
  /** Related project ids from `## 相关项目` wikilinks (`[[project/<id>/state]]`). */
  related: string[];
  updatedAt: string;
}

export interface ProjectStateInventory {
  states: ProjectOverview[];
  coverage: {
    status: ContextReadStatus;
    detail?: string;
    pages: number;
    scanned: number;
  };
}

/** Extract the three skeleton sentences + related-project ids from a state card. */
export function parseStateCard(body: string): { what: string; now: string; next: string; related: string[] } {
  const content = stripFrontmatter(body);
  const lines = content.split("\n").map((l) => l.trim());
  const section = (heading: string): string => {
    const idx = lines.findIndex((l) => l === heading);
    if (idx < 0) return "";
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("##") || l.startsWith("###")) break;
      if (l.length > 0) return l.length > 100 ? `${l.slice(0, 100)}…` : l;
    }
    return "";
  };
  const related = lines
    .filter((l) => l.startsWith("- [[") && l.includes("/state]]"))
    .map((l) => l.slice(4, -"]]".length)) // `- [[` is 4 chars; strip to `project/<id>/state`
    .map((p) => p.slice("project/".length, -"/state".length));
  return { what: section("## 这个项目是什么·解决什么"), now: section("## 现在到哪了"), next: section("## 下一步"), related };
}

/** List every project state card (R4 overview) with explicit coverage. Unlike
 *  collectActiveProjects (top-N active, one-line summary), this returns the full
 *  skeleton for all cards. Uses the ascending keyset inventory, so a budget
 *  exhaustion is reported as partial instead of a complete-looking subset.
 *  Never throws. */
export async function listProjectStates(gbrain: GbrainDeps): Promise<ProjectStateInventory> {
  const inventory = await listPageInventory(gbrain, {
    tag: "project",
    limit: PAGE_SIZE.projects,
    maxPages: 50,
    maxRows: 5000,
  });
  const stateRows = inventory.rows.filter((row) => PROJECT_STATE_SLUG.test(row.slug));

  const states: ProjectOverview[] = [];
  let readFailures = 0;
  for (const row of stateRows) {
    const id = row.slug.slice("project/".length, -"/state".length);
    let parsed: { what: string; now: string; next: string; related: string[] } = {
      what: "",
      now: "",
      next: "",
      related: [],
    };
    try {
      const got = await gbrain.getPage(row.slug);
      if (got.ok) parsed = parseStateCard(got.page.content);
      else readFailures++;
    } catch {
      readFailures++;
    }
    states.push({ id, ...parsed, updatedAt: row.updatedAt });
  }

  const nothingRead = inventory.error !== undefined && inventory.rows.length === 0;
  const status: ContextReadStatus = nothingRead
    ? "failed"
    : inventory.complete && readFailures === 0
      ? "complete"
      : "partial";
  const detail = inventory.error ?? (readFailures > 0 ? `${readFailures} 张状态卡正文不可读` : undefined);
  return {
    states,
    coverage: {
      status,
      ...(detail !== undefined ? { detail } : {}),
      pages: inventory.pages,
      scanned: inventory.scanned,
    },
  };
}
