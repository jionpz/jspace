// application/context/project-states.ts — project status collection for the
// session-start injection leg (R3). Unlike the synchronous workbench collectors
// (domains/pending/cron/inbox), this one reads gbrain through the async
// GbrainDeps port with a short per-call timeout: a stalled gbrain must never
// block a harness hook (settings.json caps session-start at 10s). It degrades
// to an empty list on any failure — the project line is advisory, never a gate.
import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts";

/** Max project state cards surfaced in the session-start injection line. */
export const MAX_ACTIVE_PROJECTS = 8;

/** Per-call gbrain budget — short so a stuck gbrain releases the hook fast;
 *  far under the 10s session-start hook cap even with a retry. */
export const PROJECT_COLLECT_TIMEOUT_MS = 2000;

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
   *  lacks a status:archived tag (registry truth for ended projects). */
  excludeProjectIds?: ReadonlySet<string>;
}

/** Parse `tags: [...]` from a gbrain note frontmatter (minimal YAML subset). */
export function parseNoteTags(body: string): string[] {
  if (!body.startsWith("---")) return [];
  const end = body.indexOf("\n---", 3);
  if (end < 0) return [];
  const fm = body.slice(3, end);
  const m = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (!m) return [];
  return m[1].split(",").map((t) => t.trim()).filter(Boolean);
}

/** True when the note carries `status:archived` (retrieval-side lifecycle tag). */
export function isArchivedGbrainNote(body: string): boolean {
  return parseNoteTags(body).includes("status:archived");
}

/** Collect active project state cards. Never throws; any failure (gbrain
 *  missing / timeout / lock held) resolves to an empty list. The caller renders
 *  the project line only when non-empty — no noise when gbrain is unavailable.
 *
 *  Excludes: hub archived project ids; state cards tagged status:archived.
 *  Skipped rows do not consume MAX_ACTIVE_PROJECTS slots — the next eligible
 *  card fills the budget (PR #33 / fable P1 enforcement).
 */
export async function collectActiveProjects(
  gbrain: GbrainDeps,
  opts: CollectActiveProjectsOptions = {},
): Promise<ProjectState[]> {
  const listed = await gbrain.list({ type: "note", tag: "project", limit: 100 });
  if (!listed.ok || !listed.rows) return [];

  // Filter to the state-card namespace and sort by recency (list is already
  // updated_desc by default, but filter first — a non-project row must not
  // crowd out a project card).
  const stateRows = listed.rows.filter((r) => /^project\/[^/]+\/state$/.test(r.slug));
  if (stateRows.length === 0) return [];

  const out: ProjectState[] = [];
  for (const row of stateRows) {
    if (out.length >= MAX_ACTIVE_PROJECTS) break;
    const id = row.slug.slice("project/".length, -"/state".length);
    if (opts.excludeProjectIds?.has(id)) continue;
    const got = await gbrain.get(row.slug);
    if (got.ok && got.content && isArchivedGbrainNote(got.content)) continue;
    const summary = got.ok && got.content ? summarizeStateCard(got.content) : "";
    out.push({ id, summary, updatedAt: row.updatedAt });
  }
  return out;
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

/** List every project state card (R4 overview). Unlike collectActiveProjects
 *  (top-N active, one-line summary), this returns the full skeleton for all
 *  cards. Never throws — a gbrain failure resolves to an empty list. */
export async function listProjectStates(gbrain: GbrainDeps): Promise<ProjectOverview[]> {
  const listed = await gbrain.list({ type: "note", tag: "project", limit: 100 });
  if (!listed.ok || !listed.rows) return [];
  const stateRows = listed.rows.filter((r) => /^project\/[^/]+\/state$/.test(r.slug));
  const out: ProjectOverview[] = [];
  for (const row of stateRows) {
    const id = row.slug.slice("project/".length, -"/state".length);
    const got = await gbrain.get(row.slug);
    const parsed = got.ok && got.content ? parseStateCard(got.content) : { what: "", now: "", next: "", related: [] as string[] };
    out.push({ id, ...parsed, updatedAt: row.updatedAt });
  }
  return out;
}
