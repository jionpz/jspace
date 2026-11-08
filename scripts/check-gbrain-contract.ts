// scripts/check-gbrain-contract.ts — isolated, reproducible contract check for
// the five JSpace page methods and the four write-error classes.
//
// What it does: creates a throwaway PGLite brain (independent HOME /
// GBRAIN_HOME / content root, embeddings off), runs `gbrain call` against it,
// and asserts the page contract JSpace depends on. It never touches the real
// brain, real harness config, or the real filehub.
//
// Usage:
//   bun run scripts/check-gbrain-contract.ts --bin <gbrain>            # global gbrain on PATH? pass its path
//   bun run scripts/check-gbrain-contract.ts --bin <src/cli.ts> --bun <bun-1.4.4+>
//   bun run scripts/check-gbrain-contract.ts --bin <gbrain> --keep     # keep the temp dir for inspection
//
// Exit code 1 on any failed assertion. This is a developer/upgrade tool; it is
// not part of CI (CI has no gbrain binary and must not install one).
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Args = { bin: string; bun: string; keep: boolean };
function parseArgs(argv: string[]): Args {
  const out: Args = { bin: "", bun: process.execPath, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bin") out.bin = argv[++i] ?? "";
    else if (a === "--bun") out.bun = argv[++i] ?? "";
    else if (a === "--keep") out.keep = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: bun scripts/check-gbrain-contract.ts --bin <gbrain|cli.ts> [--bun <bun>] [--keep]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!out.bin) {
    console.error("--bin <gbrain binary or src/cli.ts> is required");
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// gbrain refuses a content root whose components are symlinks; macOS tmpdir
// (/var/folders/...) is one, so resolve to the real path first.
const BASE = realpathSync(mkdtempSync(join(tmpdir(), "jspace-gbrain-contract-")));
const HOME = join(BASE, "userhome");
const GBRAIN_HOME = join(BASE, "gbrain-home");
const WORK = join(BASE, "work");
for (const d of [HOME, GBRAIN_HOME, WORK, join(BASE, "content")]) mkdirSync(d, { recursive: true });

type R = { exit: number; stdout: string; stderr: string; json?: any };
const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}
const codeOf = (r: R): string | undefined => r.json?.code ?? r.json?.error?.code;

const env = (): Record<string, string> => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "DATABASE_URL" && k !== "GBRAIN_DATABASE_URL") e[k] = v;
  e.HOME = HOME;
  e.GBRAIN_HOME = GBRAIN_HOME;
  return e;
};

let seq = 0;
const rid = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function run(argv: string[], timeoutMs = 120_000): Promise<R> {
  const proc = Bun.spawn(argv, { cwd: WORK, env: env(), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  clearTimeout(timer);
  let json: any;
  try { json = JSON.parse(stdout.trim()); } catch { /* non-JSON */ }
  return { exit, stdout, stderr, json };
}
const call = (method: string, body: unknown, timeoutMs?: number): Promise<R> =>
  run([args.bun, args.bin, "call", method, JSON.stringify(body)], timeoutMs);

const P = "knowledge/test/contract";
const page = (slug: string, extra = "") => `---\ntitle: ${slug}\ntype: note\ntags: [test]\n---\n\n# ${slug}\n\nSynthetic contract fixture page. ${extra}\n`;

try {
  const init = await run([
    args.bun, args.bin, "init", "--pglite", "--no-embedding", "--non-interactive",
    "--path", join(BASE, "brain.pglite"), "--content-root", join(BASE, "content"),
  ]);
  if (init.exit !== 0) throw new Error(`init failed (exit ${init.exit}): ${(init.stderr || init.stdout).slice(0, 400)}`);
  console.log(`isolated brain: ${BASE}`);

  // 1. create + typed read
  {
    const slug = `${P}/create`;
    const put = await call("put_page", { slug, content: page(slug), request_id: rid("create"), content_origin: "tool_output" });
    record("put_page create", put.exit === 0 && put.json?.state === "committed" && !!put.json?.revision, `state=${put.json?.state}`);
    const get = await call("get_page", { slug, include_content: true });
    const p = get.json?.page ?? get.json;
    record("get_page include_content", get.exit === 0 && typeof p?.content === "string" && p.content.includes("Synthetic"),
      `revision=${p?.revision} content_hash=${String(p?.content_hash).slice(0, 12)} tags=${JSON.stringify(p?.tags)}`);
  }

  // 2. error classes
  {
    const slug = `${P}/existing`;
    await call("put_page", { slug, content: page(slug), request_id: rid("existing"), content_origin: "inferred" });
    const noRev = await call("put_page", { slug, content: page(slug, "changed"), request_id: rid("norev"), content_origin: "inferred" });
    record("revision_required", noRev.exit !== 0 && codeOf(noRev) === "revision_required", `code=${codeOf(noRev)}`);

    const get = await call("get_page", { slug, include_content: true });
    const revision = (get.json?.page ?? get.json)?.revision;
    const good = await call("put_page", { slug, content: page(slug, "v2"), request_id: rid("good"), content_origin: "inferred", expected_revision: revision });
    record("put_page with expected_revision", good.exit === 0 && good.json?.state === "committed", `state=${good.json?.state}`);

    const stale = await call("put_page", { slug, content: page(slug, "v3"), request_id: rid("stale"), content_origin: "inferred", expected_revision: revision });
    record("revision_conflict", stale.exit !== 0 && codeOf(stale) === "revision_conflict", `code=${codeOf(stale)}`);
  }

  // 3. idempotency + receipt
  {
    const slug = `${P}/idem`;
    const id = rid("idem");
    const first = await call("put_page", { slug, content: page(slug, "same"), request_id: id, content_origin: "user_said" });
    const replay = await call("put_page", { slug, content: page(slug, "same"), request_id: id, content_origin: "user_said" });
    record("same request_id same intent -> same revision",
      first.exit === 0 && replay.exit === 0 && first.json?.revision === replay.json?.revision,
      `first=${first.json?.revision} replay=${replay.json?.revision}`);

    const different = await call("put_page", { slug, content: page(slug, "different"), request_id: id, content_origin: "user_said" });
    record("idempotency_conflict", different.exit !== 0 && codeOf(different) === "idempotency_conflict", `code=${codeOf(different)}`);

    const receipt = await call("get_write_request", { request_id: id });
    const rec = receipt.json?.write_request ?? receipt.json;
    record("get_write_request committed receipt", receipt.exit === 0 && rec?.state === "committed" && !!rec?.revision,
      `state=${rec?.state} revision=${rec?.revision}`);

    const missing = await call("get_write_request", { request_id: "00000000-0000-4000-8000-000000000000" });
    record("get_write_request unknown -> not_found", missing.exit !== 0 && codeOf(missing) === "not_found", `code=${codeOf(missing)}`);
  }

  // 4. content_origin
  {
    const slug = `${P}/origin-user`;
    await call("put_page", { slug, content: page(slug), request_id: rid("origin"), content_origin: "user_said" });
    const get = await call("get_page", { slug, include_content: true });
    const p = get.json?.page ?? get.json;
    record("content_origin user_said recorded", typeof p?.origin === "string" && p.origin.includes("user_said"), `origin=${p?.origin}`);
  }

  // 5. keyset pagination
  {
    const prefix = `${P}/keyset`;
    const total = 55;
    for (let i = 0; i < total; i++) {
      const slug = `${prefix}/${String(i).padStart(2, "0")}`;
      const r = await call("put_page", { slug, content: page(slug), request_id: rid("ks"), content_origin: "inferred" });
      if (r.exit !== 0) throw new Error(`keyset seed failed at ${i}: ${codeOf(r)}`);
    }
    const seen = new Set<string>();
    let after: { updated_at_iso: string; slug: string } | undefined;
    const pagesUsed: number[] = [];
    for (let n = 0; n < 40; n++) {
      const body: Record<string, unknown> = { limit: 10, sort: "updated_asc" };
      if (after) { body.updated_after = after.updated_at_iso; body.updated_after_slug = after.slug; }
      const r = await call("list_pages", body);
      if (r.exit !== 0) throw new Error(`list_pages failed: ${codeOf(r)}`);
      const rows: any[] = Array.isArray(r.json) ? r.json : (r.json?.rows ?? []);
      for (const row of rows) {
        if (!String(row.slug).startsWith(prefix)) continue;
        if (seen.has(row.slug)) throw new Error(`duplicate row across pages: ${row.slug}`);
        seen.add(row.slug);
      }
      pagesUsed.push(rows.length);
      if (rows.length === 0) break;
      const last = rows[rows.length - 1];
      after = { updated_at_iso: last.updated_at_iso, slug: last.slug };
    }
    record("list_pages keyset no dup/no miss", seen.size === total, `seen=${seen.size}/${total} pages=${pagesUsed.length}`);
  }

  // 6. backlinks
  {
    const oldSlug = `${P}/backlink/old`;
    const newSlug = `${P}/backlink/new`;
    await call("put_page", { slug: oldSlug, content: page(oldSlug), request_id: rid("old"), content_origin: "inferred" });
    await call("put_page", { slug: newSlug, content: page(newSlug, `\nSupersedes: [[${oldSlug}]]\n`), request_id: rid("new"), content_origin: "inferred" });
    const r = await call("get_backlinks", { slug: oldSlug, group: "page", limit: 20 });
    const found = (r.json?.rows ?? []).some((x: any) => x.slug === newSlug);
    record("get_backlinks finds Supersedes source", r.exit === 0 && found, `coverage=${JSON.stringify(r.json?.coverage)}`);
  }

  // 7. tag cleanup path (starter surface does not expose remove_tag)
  {
    const slug = `${P}/tags`;
    await call("put_page", { slug, content: page(slug), request_id: rid("tags"), content_origin: "inferred" });
    const before = await call("get_page", { slug, include_content: true });
    const rev = (before.json?.page ?? before.json)?.revision;
    const add = await call("add_tag", { slug, tag: "source:cron", request_id: rid("add"), expected_revision: rev });
    const mid = await call("get_page", { slug, include_content: true });
    const midRev = (mid.json?.page ?? mid.json)?.revision;
    const rm = await call("remove_tag", { slug, tag: "source:cron", request_id: rid("rm"), expected_revision: midRev });
    const after = await call("get_page", { slug, include_content: true });
    const tags = (after.json?.page ?? after.json)?.tags ?? [];
    record("add_tag / remove_tag CAS", add.exit === 0 && rm.exit === 0 && !tags.includes("source:cron"), `tags_after=${JSON.stringify(tags)}`);
  }

  // 8. source policy: JSpace must omit source_id (its token is not a source)
  {
    const slug = `${P}/source/jspace`;
    const bad = await call("put_page", { slug, content: page(slug), request_id: rid("src"), content_origin: "inferred", source_id: "jspace:pending:test:1" });
    record("jspace-shaped source_id is refused (documents why JSpace omits it)",
      bad.exit !== 0 && ["source_changed", "invalid_params"].includes(codeOf(bad) ?? ""),
      `code=${codeOf(bad)}`);
  }
} catch (e) {
  record("fixture crashed", false, e instanceof Error ? e.message : String(e));
} finally {
  if (!args.keep) rmSync(BASE, { recursive: true, force: true });
  else console.log(`kept: ${BASE}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
