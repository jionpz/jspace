// scripts/migrate-memory-model.ts — one-shot memory-model v2 migration (R6).
// Maps legacy slugs to the project-centric model (prd.md / design.md §5.1):
//   - project/<中文id>/state        -> project/<ascii id>/state
//   - knowledge/<项目名>/<主题>      -> project/<id>/lessons/<主题>  (project-specific lesson)
//   - memory/consolidate|retro/date -> records/consolidate|retro/date
//   - type: reference|lesson|decision -> type: note (+ retrieval tag)
//
// Default is --dry-run (prints the plan, changes nothing). --apply requires
// --confirm. Idempotent: a target slug that already exists is skipped with a
// note. gbrain `delete` is soft (recoverable); renames are get->put->delete so
// no content is lost even if the script dies mid-page.
//
// Usage:
//   bun run scripts/migrate-memory-model.ts            # dry-run plan
//   bun run scripts/migrate-memory-model.ts --apply --confirm
//
// NOTE: gbrain serve holds an exclusive PGLite lock; run this with serve
// stopped (outside a harness session), or stage via `jspace pending`.

import { realGbrain } from "../adapters/gbrain/gbrain.ts";
import { spawnProcess } from "../adapters/process/spawn.ts";

interface MigrationRow {
  from: string;
  to: string;
  reason: string;
}

/** gbrain list + get/put/delete subset the migration needs; realGbrain satisfies
 *  it, and tests inject a fake. */
export interface MigrateGbrain {
  list: (opts?: { limit?: number }) => Promise<{ ok: boolean; rows?: { slug: string }[]; error?: string }>;
  get: (slug: string) => Promise<{ ok: boolean; content?: string }>;
  put: (slug: string, content: string) => Promise<{ ok: boolean; error?: string }>;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirm = args.includes("--confirm");
if (apply && !confirm) {
  console.error("error: --apply requires --confirm (this migrates live gbrain pages)");
  process.exit(2);
}

/** Real gbrain for the CLI entry; tests inject a fake via buildPlan(gbrain). */
const realG = realGbrain(undefined, 30_000);

const CARD_PREFIX = "project/";
const STATE_SUFFIX = "/state";

/** project/<id>/state -> { id } or null. Handles legacy Chinese ids: they are
 *  mapped through the registry below; an unmapped Chinese id is left in place
 *  (a legacy page is safer than a guessed rename). */
function parseStateSlug(slug: string): { id: string } | null {
  if (!slug.startsWith(CARD_PREFIX) || !slug.endsWith(STATE_SUFFIX)) return null;
  const id = slug.slice(CARD_PREFIX.length, -STATE_SUFFIX.length);
  if (id.includes("/")) return null; // not a state card (e.g. decisions/lessons)
  return { id };
}

/** Legacy Chinese id -> ascii id (from hub registration; add rows as projects
 *  register. Unmapped legacy ids are reported, not renamed. */
const ID_MAP: Record<string, string> = {
  "52期体验营": "tiyanying-52",
  报表模块: "baobiao-module",
};

export async function buildPlan(g: MigrateGbrain = realG): Promise<MigrationRow[]> {
  const rows: MigrationRow[] = [];
  const listed = await g.list({ limit: 200 });
  if (!listed.ok || !listed.rows) {
    throw new Error(`gbrain list failed: ${listed.error ?? "unavailable"}`);
  }
  for (const row of listed.rows) {
    const slug = row.slug;
    // project/<中文id>/state -> ascii
    const st = parseStateSlug(slug);
    if (st && ID_MAP[st.id]) {
      rows.push({ from: slug, to: `project/${ID_MAP[st.id]}/state`, reason: "中文项目 id → ascii" });
      continue;
    }
    // knowledge/<项目名>/<主题> where 项目名 is a known project -> project/<id>/lessons/<主题>
    if (slug.startsWith("knowledge/")) {
      const rest = slug.slice("knowledge/".length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const owner = rest.slice(0, slash);
        const topic = rest.slice(slash + 1);
        if (ID_MAP[owner]) {
          rows.push({ from: slug, to: `project/${ID_MAP[owner]}/lessons/${topic}`, reason: "项目专属经验 → lessons 命名空间" });
          continue;
        }
        if (owner === "jspace") {
          rows.push({ from: slug, to: `project/jspace/lessons/${topic}`, reason: "jspace 项目经验 → lessons 命名空间" });
          continue;
        }
      }
      continue;
    }
    // memory/consolidate|retro/<date> -> records/...
    if (slug.startsWith("memory/consolidate/") || slug.startsWith("memory/retro/")) {
      rows.push({ from: slug, to: slug.replace(/^memory\//, "records/"), reason: "memory/ → records/ 前缀" });
      continue;
    }
    // assets/<中文id>/... -> ascii (asset slugs under a known project)
    if (slug.startsWith("assets/")) {
      const rest = slug.slice("assets/".length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const owner = rest.slice(0, slash);
        if (ID_MAP[owner]) {
          rows.push({ from: slug, to: `assets/${ID_MAP[owner]}${rest.slice(slash)}`, reason: "资产中文项目 id → ascii" });
          continue;
        }
      }
      continue;
    }
    // type normalization + tags are handled on the copied page content during apply.
  }
  return rows;
}

/** Rewrite a page body for the new model: type -> note, add retrieval tag,
 *  project -> ascii id. Best-effort frontmatter edit, never destructive. */
export function rewriteBody(content: string, to: string): string {
  let body = content;
  // type: <old> -> note (only the frontmatter `type:` line)
  body = body.replace(/^type: .*$/m, "type: note");
  // inject retrieval tag: keep existing tags, add the routing tag for the target namespace
  const routingTag = to.startsWith("project/") && to.endsWith("/state") ? "project"
    : to.startsWith("project/") ? "knowledge"
    : to.startsWith("assets/") ? "asset"
    : to.startsWith("records/") ? "weekly"
    : "knowledge";
  body = body.replace(/^tags: (\[[^\]]*\])$/m, (_m, tags: string) =>
    tags.includes(routingTag) ? `tags: ${tags}` : `tags: ${tags.slice(0, -1)}, ${routingTag}]`,
  );
  // project: <中文id> -> ascii (from the target slug's owner)
  const owner = to.split("/")[1];
  body = body.replace(/^project: .*$/m, `project: ${owner}`);
  return body;
}

async function migrateOne(row: MigrationRow, g: MigrateGbrain = realG): Promise<void> {
  const existing = await g.get(row.to);
  if (existing.ok) {
    console.log(`skip  ${row.from} -> ${row.to} (目标已存在)`);
    return;
  }
  const got = await g.get(row.from);
  if (!got.ok || got.content === undefined) {
    console.error(`skip  ${row.from} -> ${row.to} (旧页不可读)`);
    return;
  }
  const put = await g.put(row.to, rewriteBody(got.content, row.to));
  if (!put.ok) {
    console.error(`fail  ${row.from} -> ${row.to}: ${put.error ?? "put failed"}`);
    return;
  }
  // Soft-delete the source (recoverable) only after the target is in place.
  // gbrain delete needs a process; reuse the gbrain port by spawning via put? —
  // the adapter has no delete; run it through the CLI directly.
  await runDelete(row.from);
  console.log(`moved ${row.from} -> ${row.to}`);
}

async function runDelete(slug: string): Promise<void> {
  // gbrain delete <slug> is soft (recoverable). Used only by the migration.
  const r = await spawnProcess(["gbrain", "delete", slug], {
    cwd: process.cwd(),
    platform: process.platform,
    timeoutMs: 30_000,
  });
  if (r.exit !== 0 && !r.output.includes("not found")) {
    console.error(`warn  delete ${slug} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

async function main(): Promise<void> {
  const plan = await buildPlan();
  if (plan.length === 0) {
    console.log("no legacy pages to migrate (clean)");
    return;
  }
  if (apply) {
    for (const row of plan) await migrateOne(row);
    console.log(`\nmigration complete (${plan.length} rows processed)`);
    return;
  }
  console.log(`plan (${plan.length} rows) — re-run with --apply --confirm to execute:`);
  for (const row of plan) console.log(`  ${row.from}  ->  ${row.to}   (${row.reason})`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
