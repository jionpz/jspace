// core/contracts/memory.ts — shared, side-effect-free parsing for JSpace-owned
// gbrain pages. This is deliberately a minimal YAML subset: frontmatter fields
// used by the memory contract plus inline/block `tags` lists. Type values stay
// descriptive; routing is derived from slug + tags.

export type MemoryRole =
  | "project-state"
  | "project-decision"
  | "project-lesson"
  | "project-record"
  | "knowledge"
  | "profile"
  | "asset"
  | "weekly-consolidate"
  | "weekly-retro"
  | "unknown-owned";

export interface ParsedMemoryMarkdown {
  fields: Record<string, string>;
  tags: string[];
  /** Top-level inline/block YAML lists other than the special `tags` field. */
  lists: Record<string, string[]>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split frontmatter/body. A missing or malformed frontmatter block yields the
 *  original text as body and no fields/tags. */
export function parseMemoryMarkdown(raw: string): ParsedMemoryMarkdown {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines[0] !== "---") return { fields: {}, tags: [], lists: {}, body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { fields: {}, tags: [], lists: {}, body: text };

  const fields: Record<string, string> = {};
  const tags: string[] = [];
  const lists: Record<string, string[]> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^[ \t]/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    const inline = value.match(/^\[(.*)\]$/);
    if (inline) {
      const items = inline[1].split(",").map((item) => unquote(item)).filter(Boolean);
      lists[key] = items;
      if (key === "tags") tags.push(...items);
      continue;
    }
    if (value.trim() === "") {
      const items: string[] = [];
      let next = i + 1;
      while (next < end) {
        const l = lines[next];
        // Blank lines and full-line comments are legal inside a YAML block
        // sequence. Skipping them (instead of stopping) matters: a comment in
        // `support_paths` used to silently truncate the rest of the list, so the
        // dropped files surfaced far away as confusing `asset.unindexed`
        // warnings instead of a parse error.
        if (l.trim() === "" || l.trimStart().startsWith("#")) {
          next++;
          continue;
        }
        if (!/^[ \t]+-/.test(l)) break;
        const item = unquote(l.replace(/^[ \t]+-[ \t]*/, ""));
        if (item !== "") items.push(item);
        next++;
      }
      if (items.length > 0) {
        lists[key] = items;
        if (key === "tags") tags.push(...items);
        i = next - 1;
        continue;
      }
    }
    if (key === "tags") continue;
    fields[key] = unquote(value);
  }
  return {
    fields,
    tags: [...new Set(tags)],
    lists,
    body: lines.slice(end + 1).join("\n"),
  };
}

export function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => tag.length > 0))];
}

export function provenanceTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag === "source:session" || tag === "source:cron");
}

/** gbrain canonicalizes ASCII letters in slugs to lowercase, while owner
 *  display names may retain their original casing. Compare owner identities
 *  case-insensitively without weakening path or slug validation. */
export function memoryOwnerEquals(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left !== undefined &&
    right !== undefined &&
    left.toLowerCase() === right.toLowerCase();
}

export function lifecycleTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag.startsWith("status:"));
}

/** All Supersedes wikilinks in body order. Case-insensitive recognition keeps
 *  historical pages inspectable; callers may separately require the canonical
 *  `Supersedes:` spelling for new writes. */
export function supersedesTargets(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(/^\s*supersedes:\s*\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]\s*$/gim)) {
    out.push(match[1].trim());
  }
  return [...new Set(out)];
}

/** True only when `body` contains a direction-correct declaration that it
 *  supersedes `target`. */
export function declaresSupersedes(body: string, target: string): boolean {
  return supersedesTargets(body).includes(target);
}

export function memoryRole(slug: string): MemoryRole | null {
  if (/^project\/[^/]+\/state$/.test(slug)) return "project-state";
  if (/^project\/[^/]+\/decisions\/[^/]+$/.test(slug)) return "project-decision";
  if (/^project\/[^/]+\/lessons\/[^/]+$/.test(slug)) return "project-lesson";
  // Sparse project events are owned by the project but live under the
  // records/ root. The old project/<id>/records/<leaf> spelling is not a
  // second canonical namespace; it falls through to unknown-owned below.
  if (/^records\/project\/[^/]+\/[^/]+$/.test(slug)) return "project-record";
  if (/^knowledge\/[^/]+\/[^/]+$/.test(slug)) return "knowledge";
  if (/^profile\/[^/]+$/.test(slug)) return "profile";
  if (/^assets\/[^/]+\/[^/]+$/.test(slug)) return "asset";
  if (/^records\/consolidate\/\d{4}-\d{2}-\d{2}$/.test(slug)) return "weekly-consolidate";
  if (/^records\/retro\/\d{4}-\d{2}-\d{2}$/.test(slug)) return "weekly-retro";
  if (/^(project|knowledge|profile|assets|records)\//.test(slug)) return "unknown-owned";
  return null;
}

export function isWeeklyRole(role: MemoryRole): boolean {
  return role === "weekly-consolidate" || role === "weekly-retro";
}

export function isKnowledgeRole(role: MemoryRole): boolean {
  return role === "project-decision" || role === "project-lesson" || role === "project-record" || role === "knowledge";
}

// ---------------------------------------------------------------------------
// Canonical vs derived
//
// gbrain writes derived pages itself (atoms / extracts from the dream and
// extract passes). They quote a source page and are evidence — they must never
// be served as the current answer, and they must never occupy a session-start
// knowledge slot. The same is true of JSpace's own weekly projections and of
// pages explicitly marked maintenance-only.
//
// These helpers are pure and IO-free so the read side (recall rules), the
// session-start collector and the read-only audit all apply ONE rule set
// instead of three similar ones.
// ---------------------------------------------------------------------------

/** Namespaces gbrain generates; they are projections of a `source_slug` page. */
export const DERIVED_SLUG_ROOTS = ["atoms/", "extracts/"] as const;

/** Roles whose pages carry the current answer. Weekly projections and
 *  unclassified pages inside a JSpace namespace are deliberately excluded. */
export type CanonicalMemoryRole = Exclude<
  MemoryRole,
  "weekly-consolidate" | "weekly-retro" | "unknown-owned"
>;

export function isCanonicalRole(role: MemoryRole | null): role is CanonicalMemoryRole {
  return role !== null && role !== "weekly-consolidate" && role !== "weekly-retro" && role !== "unknown-owned";
}

/** Lifecycle tags that take a page out of "current answer" service. */
export const INACTIVE_STATUS_TAGS: ReadonlySet<string> = new Set([
  "status:superseded",
  "status:deprecated",
  "status:archived",
]);

/** Tags that mark a page as a periodic VIEW rather than a fact. `weekly` is the
 *  route tag of consolidate/retro and of weekly-report assets.
 *
 *  `activity:maintenance` is deliberately NOT here. It is a WRITE-EVENT marker
 *  ("this write was housekeeping, do not count it as business activity" — see
 *  `jspace-use` §5), and the same tag therefore sits on real state cards,
 *  lessons, decisions and asset pages, which the writeback contract says must
 *  carry it only for that one write. Treating it as a page class would exclude
 *  38 live pages from session-start, i.e. hide current answers because they
 *  were last touched by housekeeping. The tag's only sanctioned consumer is the
 *  write-count ledger, where it is subtracted per WRITE, not per page. */
export const PROJECTION_TAGS = ["weekly"] as const;

export function hasInactiveStatus(tags: readonly string[]): boolean {
  return tags.some((tag) => INACTIVE_STATUS_TAGS.has(tag));
}

export function hasProjectionTag(tags: readonly string[]): boolean {
  return tags.some((tag) => (PROJECTION_TAGS as readonly string[]).includes(tag));
}

export function isDerivedSlug(slug: string): boolean {
  return DERIVED_SLUG_ROOTS.some((root) => slug.startsWith(root));
}

export type MemoryPageClass =
  /** A live canonical page — may serve as the current answer. */
  | "canonical"
  /** gbrain-generated evidence (`atoms/*`, `extracts/*`);回源 to `source_slug`. */
  | "derived"
  /** Weekly/retro/consolidate page (a periodic view, not a fact). */
  | "projection"
  /** superseded / deprecated / archived — history only. */
  | "inactive"
  /** Inside a JSpace namespace but no authorized form, or outside every
   *  namespace: not classifiable, therefore never evidence of currency. */
  | "unclassified";

/**
 * Classify a page by slug + tags alone. Precedence is deliberate and stated:
 * derived (an atom stays an atom whatever tags gbrain merged into it) →
 * inactive → projection → canonical → unclassified.
 *
 * Callers pass tags from both the gbrain list row and the page frontmatter
 * when both are available; passing only one is honest but weaker.
 */
export function classifyMemoryPage(slug: string, tags: readonly string[]): MemoryPageClass {
  if (isDerivedSlug(slug)) return "derived";
  if (hasInactiveStatus(tags)) return "inactive";
  const role = memoryRole(slug);
  if (role === "weekly-consolidate" || role === "weekly-retro") return "projection";
  if (hasProjectionTag(tags)) return "projection";
  return isCanonicalRole(role) ? "canonical" : "unclassified";
}

/** True when a page may be served/ranked as the current answer. */
export function isCanonicalAnswer(slug: string, tags: readonly string[]): boolean {
  return classifyMemoryPage(slug, tags) === "canonical";
}

/** Normalize a page title for topic comparison. Titles are prose, so the only
 *  honest normalization is whitespace + ASCII case — no stemming, no synonym
 *  table. Anything weaker would turn "similar wording" into a claimed duplicate;
 *  anything stronger would miss the real case (the same title written twice). */
export function normalizeTopic(title: string): string {
  return title
    .replace(/\s+/g, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** `source_slug` of a gbrain-derived page (atoms/extracts quote their origin). */
export function derivedSourceSlug(fields: Readonly<Record<string, string>>): string | undefined {
  const value = fields.source_slug;
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}
