// application/ingest/use-cases.test.ts — end-to-end ingest use cases against
// an isolated workbench/filehub and a fake gbrain port.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GbrainDeps, GbrainPageResult } from "../../core/contracts/gbrain.ts";
import { readJournals } from "./journal.ts";
import {
  ingestAdvance,
  ingestBegin,
  ingestFail,
  ingestList,
  ingestRollback,
  ingestStatus,
  type IngestBeginArgs,
} from "./use-cases.ts";

let workbench: string;
let filehub: string;
let inbox: string;
let projectRoot: string;

beforeEach(() => {
  workbench = mkdtempSync(join(tmpdir(), "jspace-ingest-uc-"));
  filehub = join(workbench, "filehub");
  inbox = join(filehub, "_inbox");
  projectRoot = join(filehub, "projects", "foo");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(filehub, "areas", "books"), { recursive: true });
  writeFileSync(join(projectRoot, "index.md"), "# Index\n");
  writeFileSync(join(filehub, "areas", "books", "index.md"), "# Books\n");
  mkdirSync(join(workbench, ".jspace"), { recursive: true });
  writeFileSync(
    join(workbench, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [
        {
          id: "filehub",
          type: "filehub",
          domain: "files",
          entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }],
        },
      ],
      projects: [{ id: "foo", domain: "files", asset_rel_path: "projects/foo", status: "active" }],
    }),
  );
  writeFileSync(
    join(workbench, ".jspace", "local.json"),
    JSON.stringify({ schema_version: 1, installation_id: "inst", bindings: { "filehub-path": filehub } }),
  );
});

afterEach(() => {
  rmSync(workbench, { recursive: true, force: true });
});

function sourceFile(name = "doc.txt", content = "ingestable content\n"): string {
  const path = join(inbox, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function args(source: string, over: Partial<IngestBeginArgs> = {}): IngestBeginArgs {
  return {
    file: source,
    target: "projects/foo/2026-10-18-doc.txt",
    slug: "assets/foo/doc",
    ownerKind: "project",
    ownerId: "foo",
    indexLine: "2026-10-18 | doc.txt | assets/foo/doc",
    ...over,
  };
}

function journalId(): string {
  return readJournals(workbench).records[0].id;
}

function pageFor(
  slug: string,
  content: string,
  over: Partial<Extract<GbrainPageResult, { ok: true }>["page"]> = {},
): Extract<GbrainPageResult, { ok: true }> {
  return {
    ok: true,
    page: {
      slug,
      revision: "revision-4",
      contentHash: "d".repeat(64),
      content,
      tags: ["asset", "source:session"],
      type: "note",
      ...over,
    },
  };
}

function fakeGbrain(result: (slug: string) => Promise<GbrainPageResult>): GbrainDeps {
  return {
    getPage: result,
    listPages: async () => ({ ok: true, rows: [] }),
    putPage: async () => ({ ok: false, code: "process_error", message: "not used" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "not used" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

function assetPage(relPath: string, ownerId = "foo", ownerKind = "project"): string {
  return [
    "---",
    "type: note",
    "source: codex",
    `project: ${ownerId}`,
    `owner_kind: ${ownerKind}`,
    "tags: [asset, source:session]",
    `rel_path: ${relPath}`,
    "---",
    "# Doc",
    "",
    "## Pointer",
    relPath,
  ].join("\n");
}

test("begin derives the project index, stages under the registered asset root and keeps source", () => {
  const source = sourceFile();
  const result = ingestBegin(workbench, args(source));
  expect(result.lines.some((line) => line.includes("ingest staged"))).toBe(true);
  const journal = readJournals(workbench).records[0];
  expect(journal.ownerKind).toBe("project");
  expect(journal.ownerId).toBe("foo");
  expect(journal.indexPath).toBe("projects/foo/index.md");
  expect(journal.relPath).toBe("projects/foo/2026-10-18-doc.txt");
  expect(existsSync(join(projectRoot, "2026-10-18-doc.txt"))).toBe(true);
  expect(existsSync(source)).toBe(true);
});

test("unregistered project is rejected instead of deriving a fake owner", () => {
  const source = sourceFile();
  expect(() => ingestBegin(workbench, args(source, { ownerId: "missing" }))).toThrow(/no registered project/);
});

test("area owner uses an existing area and its derived index", () => {
  const source = sourceFile();
  const result = ingestBegin(
    workbench,
    args(source, {
      ownerKind: "area",
      ownerId: "books",
      target: "areas/books/topics/doc.txt",
      slug: "assets/books/doc",
      indexLine: "2026-10-18 | doc.txt | assets/books/doc",
    }),
  );
  expect(result.lines.some((line) => line.includes("owner=area:books"))).toBe(true);
  expect(readJournals(workbench).records[0].indexPath).toBe("areas/books/index.md");
});

test("missing area is rejected rather than silently creating a new taxonomy", () => {
  const source = sourceFile();
  expect(() =>
    ingestBegin(
      workbench,
      args(source, {
        ownerKind: "area",
        ownerId: "new-area",
        target: "areas/new-area/doc.txt",
        slug: "assets/new-area/doc",
      }),
    ),
  ).toThrow(/no existing area/);
});

test("target must stay inside the declared project/area root", () => {
  const source = sourceFile();
  expect(() =>
    ingestBegin(workbench, args(source, { target: "areas/books/doc.txt" })),
  ).toThrow(/must be inside projects\/foo/);
});

test("source must be inside the filehub inbox", () => {
  const outside = join(workbench, "outside.txt");
  writeFileSync(outside, "secret\n");
  expect(() => ingestBegin(workbench, args(outside))).toThrow(/filehub inbox/);
});

test("target symlink escaping the filehub is rejected", () => {
  const outside = join(workbench, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(projectRoot, "escape"));
  const source = sourceFile();
  expect(() =>
    ingestBegin(workbench, args(source, { target: "projects/foo/escape/doc.txt" })),
  ).toThrow(/under the filehub root/);
  expect(existsSync(join(outside, "doc.txt"))).toBe(false);
});

test("existing target is a visible conflict and is never overwritten", () => {
  const source = sourceFile();
  const target = join(projectRoot, "2026-10-18-doc.txt");
  writeFileSync(target, "existing bytes\n");
  const result = ingestBegin(workbench, args(source));
  expect(result.exitCode).toBe(1);
  expect(readFileSync(target, "utf-8")).toBe("existing bytes\n");
  expect(readJournals(workbench).records).toHaveLength(0);
});

test("index line must identify both the asset and slug", () => {
  const source = sourceFile();
  expect(() =>
    ingestBegin(workbench, args(source, { indexLine: "unrelated line" })),
  ).toThrow(/must contain the exact gbrain slug/);
});

test("gbrain checkpoint requires a real page readback and metadata match", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  await expect(
    ingestAdvance(
      workbench,
      id,
      "gbrain",
      fakeGbrain(async () => ({ ok: false, code: "not_found", message: "page missing" })),
    ),
  ).rejects.toThrow(/readback failed/);
  expect(readJournals(workbench).records[0].status).toBe("staged");

  await expect(
    ingestAdvance(
      workbench,
      id,
      "gbrain",
      fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/other.txt"))),
    ),
  ).rejects.toThrow(/rel_path/);
  expect(readJournals(workbench).records[0].status).toBe("staged");
});

test("successful gbrain readback stores evidence and advances", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  const page = assetPage("projects/foo/2026-10-18-doc.txt");
  const result = await ingestAdvance(
    workbench,
    id,
    "gbrain",
    fakeGbrain(async (slug) => pageFor(slug, page)),
  );
  expect(result.lines[0]).toContain("-> gbrain");
  const journal = readJournals(workbench).records[0];
  expect(journal.status).toBe("gbrain");
  expect(journal.gbrainEvidence?.revision).toBe("revision-4");
  expect(journal.gbrainEvidence?.relPath).toBe(journal.relPath);
});

test("gbrain metadata missing asset/provenance tags is rejected", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  const page = assetPage("projects/foo/2026-10-18-doc.txt");
  await expect(
    ingestAdvance(
      workbench,
      id,
      "gbrain",
      fakeGbrain(async (slug) => pageFor(slug, page, { tags: ["asset"] })),
    ),
  ).rejects.toThrow(/exactly one/);
  expect(readJournals(workbench).records[0].status).toBe("staged");
});

test("index checkpoint requires the exact line in the derived index", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  await ingestAdvance(
    workbench,
    id,
    "gbrain",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  await expect(ingestAdvance(workbench, id, "index")).rejects.toThrow(/does not contain/);
  expect(readJournals(workbench).records[0].status).toBe("gbrain");

  writeFileSync(join(projectRoot, "index.md"), "# Index\n2026-10-18 | doc.txt | assets/foo/doc\n");
  const advanced = await ingestAdvance(workbench, id, "index");
  expect(advanced.lines[0]).toContain("-> index");
  const journal = readJournals(workbench).records[0];
  expect(journal.status).toBe("index");
  expect(journal.indexEvidence?.line).toBe(journal.indexEntry);
});

test("full chain removes source only after verified gbrain and index checkpoints", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  await ingestAdvance(
    workbench,
    id,
    "gbrain",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  writeFileSync(join(projectRoot, "index.md"), "# Index\n2026-10-18 | doc.txt | assets/foo/doc\n");
  await ingestAdvance(workbench, id, "index");
  const complete = await ingestAdvance(
    workbench,
    id,
    "committed",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  expect(complete.lines[0]).toContain("committed");
  expect(existsSync(source)).toBe(false);
  expect(readJournals(workbench).records[0].status).toBe("committed");
});

test("staged journal cannot complete", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  await expect(ingestAdvance(workbench, journalId(), "committed")).rejects.toThrow(/cannot complete from staged/);
  expect(existsSync(source)).toBe(true);
});

test("source change before complete preserves both materials", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  await ingestAdvance(
    workbench,
    id,
    "gbrain",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  writeFileSync(join(projectRoot, "index.md"), "# Index\n2026-10-18 | doc.txt | assets/foo/doc\n");
  await ingestAdvance(workbench, id, "index");
  writeFileSync(source, "changed before cleanup\n");
  const result = await ingestAdvance(
    workbench,
    id,
    "committed",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  expect(result.exitCode).toBe(1);
  expect(existsSync(source)).toBe(true);
  expect(existsSync(join(projectRoot, "2026-10-18-doc.txt"))).toBe(true);
  expect(readJournals(workbench).records[0].failureReason).toContain("source changed");
});

test("completion re-reads gbrain and preserves the inbox if the page disappeared", async () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  await ingestAdvance(
    workbench,
    id,
    "gbrain",
    fakeGbrain(async (slug) => pageFor(slug, assetPage("projects/foo/2026-10-18-doc.txt"))),
  );
  writeFileSync(join(projectRoot, "index.md"), "# Index\n2026-10-18 | doc.txt | assets/foo/doc\n");
  await ingestAdvance(workbench, id, "index");
  await expect(
    ingestAdvance(
      workbench,
      id,
      "committed",
      fakeGbrain(async () => ({ ok: false, code: "not_found", message: "page removed" })),
    ),
  ).rejects.toThrow(/readback failed/);
  expect(existsSync(source)).toBe(true);
  expect(readJournals(workbench).records[0].status).toBe("index");
});

test("fail at staged compensates, while rollback is restricted to staged", () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  const failed = ingestFail(workbench, id, "write failed");
  expect(failed.exitCode).toBe(1);
  expect(existsSync(join(projectRoot, "2026-10-18-doc.txt"))).toBe(false);
  expect(existsSync(source)).toBe(true);

  const source2 = sourceFile("doc2.txt", "second\n");
  ingestBegin(
    workbench,
    args(source2, {
      target: "projects/foo/doc2.txt",
      slug: "assets/foo/doc2",
      indexLine: "2026-10-18 | doc2.txt | assets/foo/doc2",
    }),
  );
  const secondId = readJournals(workbench).records.find((journal) => journal.relPath.endsWith("doc2.txt"))!.id;
  const rolled = ingestRollback(workbench, secondId);
  expect(rolled.lines[0]).toContain("rolled back");
  expect(existsSync(join(projectRoot, "doc2.txt"))).toBe(false);
});

test("status/list expose schema-2 owner and checkpoint evidence", () => {
  const source = sourceFile();
  ingestBegin(workbench, args(source));
  const id = journalId();
  const status = ingestStatus(workbench, id, true);
  expect((status.data as { ownerKind: string }).ownerKind).toBe("project");
  const list = ingestList(workbench, true);
  expect((list.data as { journals: unknown[] }).journals).toHaveLength(1);
});
