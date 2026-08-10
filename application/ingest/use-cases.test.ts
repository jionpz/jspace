// application/ingest/use-cases.test.ts — `jspace ingest` use cases end-to-end
// against a temp workbench with a registered filehub + project (real fs ops,
// temp fixture only — never a real filehub).
// Run: bun test application/ingest/use-cases.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJournals } from "./journal.ts";
import { ingestAdvance, ingestBegin, ingestFail, ingestList, ingestRollback, ingestStatus } from "./use-cases.ts";

let wb: string;
let fh: string;
let inbox: string;
let projDir: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-ingest-uc-"));
  fh = join(wb, "filehub");
  projDir = join(fh, "projects", "foo");
  mkdirSync(projDir, { recursive: true });
  inbox = join(fh, "_inbox");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [{ id: "foo", domain: "files", asset_rel_path: "projects/foo", status: "active" }],
    }),
  );
  writeFileSync(join(wb, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "inst", bindings: { "filehub-path": fh } }));
});
afterEach(() => rmSync(wb, { recursive: true, force: true }));

function sourceFile(name = "doc.txt", content = "ingestable content\n"): string {
  const p = join(inbox, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function journalId(): string {
  return readJournals(wb).records[0].id;
}

test("begin stages a copy, keeps source, uses registered project id (no warning)", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  const res = ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  expect(res.lines.some((l) => l.includes("ingest staged"))).toBe(true);
  expect(res.lines.some((l) => l.includes("warn: project"))).toBe(false); // registered
  expect(readJournals(wb).records[0].projectId).toBe("foo");
  expect(existsSync(target)).toBe(true); // staged copy
  expect(existsSync(src)).toBe(true); // source stays in inbox
});

test("unregistered project derives id + warns", () => {
  const src = sourceFile();
  const res = ingestBegin(wb, { file: src, target: join(projDir, "x.txt"), slug: "assets/foo/x", project: "Acme 报价" });
  expect(res.lines.some((l) => l.includes("warn: project Acme 报价 is not registered"))).toBe(true);
  expect(readJournals(wb).records[0].projectId).toBe("acme"); // Latin prefix slugs; pure CJK uses hash fallback (see project.test.ts)
});

test("full chain begin→gbrain→index→committed removes source from inbox", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  expect(ingestAdvance(wb, id, "gbrain").lines[0]).toContain("-> gbrain");
  expect(ingestAdvance(wb, id, "index").lines[0]).toContain("-> index");
  expect(ingestAdvance(wb, id, "committed").lines[0]).toContain("committed");
  expect(existsSync(src)).toBe(false); // source removed at commit
  expect(readJournals(wb).records[0].status).toBe("committed");
});

test("fail at staged compensates (target removed, source stays), exitCode 1", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  const res = ingestFail(wb, id, "gbrain put failed");
  expect(res.exitCode).toBe(1);
  expect(res.lines.some((l) => l.includes("compensated: removed staged target"))).toBe(true);
  expect(existsSync(target)).toBe(false); // staged copy compensated
  expect(existsSync(src)).toBe(true); // source stays, retryable
  expect(readJournals(wb).records[0].status).toBe("failed");
});

test("duplicate begin after commit is skipped; re-begin of in-progress resumes", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  ingestAdvance(wb, id, "gbrain");
  ingestAdvance(wb, id, "index");
  ingestAdvance(wb, id, "committed");
  const again = ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  expect(again.lines.some((l) => l.includes("already ingested"))).toBe(true);
  expect(readJournals(wb).records).toHaveLength(1);
});

test("status json + list report journals", () => {
  const src = sourceFile();
  ingestBegin(wb, { file: src, target: join(projDir, "a.txt"), slug: "assets/foo/a", project: "foo" });
  const id = journalId();
  const s = ingestStatus(wb, id, true);
  expect((s.data as { status: string }).status).toBe("staged");
  const list = ingestList(wb, true);
  expect((list.data as { journals: unknown[] }).journals).toHaveLength(1);
});

test("rollback abandons a staged ingest; source stays, target removed", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  ingestRollback(wb, id);
  expect(existsSync(target)).toBe(false);
  expect(existsSync(src)).toBe(true);
  expect(readJournals(wb).records[0].status).toBe("failed");
});

// ---- cleanup-pending recovery ----

/** Replace the source file with a directory so a real unlinkSync throws on every
 *  platform — forces the cleanup-pending path through the real fs ops. */
function blockSourceRemoval(src: string): void {
  rmSync(src, { force: true });
  mkdirSync(src, { recursive: true });
}

test("ingestAdvance reports unlink failure as non-zero with a retry action, then recovers", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  ingestAdvance(wb, id, "gbrain");
  ingestAdvance(wb, id, "index");
  blockSourceRemoval(src);
  const res = ingestAdvance(wb, id, "committed");
  expect(res.exitCode).toBe(1);
  expect(res.lines.some((l) => l.includes("source NOT removed"))).toBe(true);
  expect(res.lines.some((l) => l.includes("--complete"))).toBe(true); // exact retry action
  expect(res.errors?.some((e) => e.includes("source cleanup failed"))).toBe(true);
  const j = readJournals(wb).records[0];
  expect(j.status).toBe("failed");
  expect(j.failedStep).toBe("committed"); // cleanup-pending machine state
  expect(j.failureReason).toContain("source cleanup pending");
  // clear the blocking dir -> source absent -> the SAME --complete converges
  rmSync(src, { recursive: true, force: true });
  const res2 = ingestAdvance(wb, id, "committed");
  expect(res2.exitCode ?? 0).toBe(0);
  expect(readJournals(wb).records[0].status).toBe("committed");
});

test("ingestBegin on a cleanup-pending source directs to finish cleanup, no second journal", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  ingestAdvance(wb, id, "gbrain");
  ingestAdvance(wb, id, "index");
  blockSourceRemoval(src);
  expect(ingestAdvance(wb, id, "committed").exitCode).toBe(1); // leave cleanup pending
  const again = ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  expect(again.exitCode).toBe(1);
  expect(again.lines.some((l) => l.includes("--complete"))).toBe(true);
  expect(readJournals(wb).records).toHaveLength(1); // no second journal / re-stage
});

test("ingest list/status surface cleanup-pending and its retry action; JSON shape unchanged", () => {
  const src = sourceFile();
  const target = join(projDir, "2026-08-04-doc.txt");
  ingestBegin(wb, { file: src, target, slug: "assets/foo/doc", project: "foo" });
  const id = journalId();
  ingestAdvance(wb, id, "gbrain");
  ingestAdvance(wb, id, "index");
  blockSourceRemoval(src);
  expect(ingestAdvance(wb, id, "committed").exitCode).toBe(1); // leave cleanup pending
  const st = ingestStatus(wb, id, false);
  expect(st.lines.some((l) => l.includes("cleanup pending"))).toBe(true);
  expect(st.lines.some((l) => l.includes("--complete"))).toBe(true);
  const list = ingestList(wb, false);
  expect(list.lines.some((l) => l.includes("failed/cleanup-pending"))).toBe(true);
  // --json shape is unchanged: status=failed + failedStep=committed, no new fields
  const js = ingestStatus(wb, id, true).data as { status: string; failedStep?: string };
  expect(js.status).toBe("failed");
  expect(js.failedStep).toBe("committed");
});
