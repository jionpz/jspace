import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import {
  beginBundleIngest,
  completeBundleIngest,
  prepareBundlePlan,
  recordBundleGbrainCheckpoint,
  recordBundleIndexCheckpoint,
  resumeBundleCopy,
  rollbackBundleIngest,
  runCreatedBundleCopy,
} from "./bundle.ts";
import { readJournal, writeJournal } from "./journal.ts";
import type { IngestBundleGbrainEvidence, IngestBundleJournalV3 } from "../../core/contracts/ingest.ts";

let root: string;
let fh: string;
let source: string;

const SLUG = "assets/acme/bundle";
const INDEX_LINE = "| [[bundle/README.md]] | bundle | 2026-10-24 | assets/acme/bundle |";
const INDEX_PATH = "projects/acme/index.md";

function writeSource(path: string, content: string): void {
  mkdirSync(join(source, path, ".."), { recursive: true });
  writeFileSync(join(source, path), content);
}

function prepare() {
  return prepareBundlePlan({
    source,
    target: join(fh, "projects", "acme", "bundle"),
    ownerRootRel: "projects/acme",
    rootRelPath: "projects/acme/bundle",
    entry: "README.md",
    ownerKind: "project",
    ownerId: "acme",
    slug: SLUG,
    indexPath: INDEX_PATH,
    indexEntry: INDEX_LINE,
  });
}

function beginPlan(): IngestBundleJournalV3 {
  const began = beginBundleIngest(root, prepare(), fh);
  if (began.kind !== "created" || began.journal === undefined) {
    throw new Error(`expected created, got ${began.kind}`);
  }
  return began.journal;
}

/** Simulate the copy process exiting so a resume is allowed to claim it. */
function markCopierDead(id: string): void {
  const journal = readJournal(root, id);
  if (journal.schema_version !== 3 || journal.operation === undefined) {
    throw new Error("expected a copying bundle journal with an operation");
  }
  writeJournal(root, { ...journal, operation: { ...journal.operation, pid: 999999 } });
}

function gbrainEvidence(journal: {
  slug: string;
  ownerKind: "project" | "area";
  ownerId: string;
  relPath: string;
  targetHash?: string;
  manifestRelPath: string;
  aggregateSha256: string;
  manifestSha256: string;
}): IngestBundleGbrainEvidence {
  return {
    verifiedAt: "2026-10-24T120000",
    revision: "revision-1",
    contentHash: "c".repeat(64),
    slug: journal.slug,
    ownerKind: journal.ownerKind,
    ownerId: journal.ownerId,
    relPath: journal.relPath,
    tags: ["asset", "source:session"],
    ...(journal.targetHash !== undefined ? { sourceSha256: journal.targetHash } : {}),
    assetKind: "bundle",
    bundleRoot: "projects/acme/bundle",
    bundleManifest: journal.manifestRelPath,
    bundleSha256: journal.aggregateSha256,
    bundleManifestSha256: journal.manifestSha256,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-bundle-ingest-"));
  fh = join(root, "filehub");
  source = join(fh, "_inbox", "bundle");
  mkdirSync(join(fh, "projects", "acme"), { recursive: true });
  mkdirSync(source, { recursive: true });
  writeSource("README.md", "entry\n");
  writeSource("notes/a.txt", "a\n");
  writeSource("notes/b.txt", "b\n");
  writeFileSync(join(fh, "projects", "acme", "index.md"), "# Index\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bundle begin and copy", () => {
  test("copies the whole tree, keeps the source and stores the manifest outside the root", () => {
    const journal = beginPlan();
    const copied = runCreatedBundleCopy(root, journal, fh);
    expect(copied.kind).toBe("staged");
    expect(readFileSync(join(fh, "projects", "acme", "bundle", "README.md"), "utf-8")).toBe("entry\n");
    expect(existsSync(join(fh, "projects", "acme", "bundle", "notes", "b.txt"))).toBe(true);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(fh, journal.manifestRelPath))).toBe(true);
    const reread = readJournal(root, journal.id);
    expect(reread.schema_version).toBe(3);
    if (reread.schema_version !== 3) return;
    expect(reread.status).toBe("staged");
    expect(reread.sourcePolicy).toBe("retain");
    expect(reread.operation).toBeUndefined();
    expect(reread.targetHash).toBe(reread.sourceHash);
  });

  test("a committed identical bundle is a duplicate; a different plan conflicts", () => {
    const journal = beginPlan();
    const copied = runCreatedBundleCopy(root, journal, fh);
    const staged = copied.journal;
    const evidence = gbrainEvidence(staged);
    recordBundleGbrainCheckpoint(root, staged.id, evidence);
    recordBundleIndexCheckpoint(root, staged.id, {
      verifiedAt: "2026-10-24T120100",
      path: INDEX_PATH,
      contentHash: "d".repeat(64),
      line: INDEX_LINE,
    });
    writeFileSync(
      join(fh, INDEX_PATH),
      `# Index\n\n| 文件 | 类型 | 日期 | gbrain slug |\n|---|---|---|---|\n${INDEX_LINE}\n`,
    );
    const completed = completeBundleIngest(
      root,
      staged.id,
      fh,
      (rel) => readFileSync(join(fh, rel), "utf-8"),
      evidence,
    );
    expect(completed.kind).toBe("committed");
    expect(existsSync(source)).toBe(true);

    const duplicate = beginBundleIngest(root, prepare(), fh);
    expect(duplicate.kind).toBe("duplicate");
  });

  test("source changes during copy fail without overwriting anything and resume stays conflicted", () => {
    const journal = beginPlan();
    const copied = runCreatedBundleCopy(root, journal, fh, {
      afterFile: (path) => {
        if (path === "README.md") writeSource("notes/a.txt", "changed during copy\n");
      },
    });
    expect(copied.kind).toBe("failed");
    expect(copied.journal.status).toBe("failed");
    expect(copied.journal.failedStep).toBe("copying");
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(fh, "projects", "acme", "bundle", "README.md"))).toBe(true);

    markCopierDead(journal.id);
    const resumed = resumeBundleCopy(root, journal.id, fh);
    expect(resumed.kind).not.toBe("staged");
    expect(readJournal(root, journal.id).status).toBe("failed");
  });

  test("an interrupted copy resumes, skipping members already verified by digest", () => {
    const journal = beginPlan();
    let calls = 0;
    const interrupted = runCreatedBundleCopy(root, journal, fh, {
      afterFile: () => {
        calls += 1;
        throw new Error("simulated interruption");
      },
    });
    expect(interrupted.kind).toBe("failed");
    expect(calls).toBe(1);
    const target = join(fh, "projects", "acme", "bundle");
    expect(readFileSync(join(target, "README.md"), "utf-8")).toBe("entry\n");

    markCopierDead(journal.id);
    const resumed = resumeBundleCopy(root, journal.id, fh);
    expect(resumed.kind).toBe("staged");
    expect(readJournal(root, journal.id).status).toBe("staged");
    expect(readFileSync(join(target, "notes", "a.txt"), "utf-8")).toBe("a\n");
  });

  test("preflight refuses a symlink, restricted member or a file positional", () => {
    symlinkSync(join(source, "README.md"), join(source, "link.md"));
    expect(() => prepare()).toThrow(/symlink|refused/);
    rmSync(join(source, "link.md"));
    writeSource("secrets/key.txt", "secret");
    expect(() => prepare()).toThrow(/restricted|refused/);
    expect(() =>
      prepareBundlePlan({
        source: join(source, "README.md"),
        target: join(fh, "projects", "acme", "bundle"),
        ownerRootRel: "projects/acme",
        rootRelPath: "projects/acme/bundle",
        entry: "README.md",
        ownerKind: "project",
        ownerId: "acme",
        slug: SLUG,
        indexPath: INDEX_PATH,
        indexEntry: INDEX_LINE,
      }),
    ).toThrow(/directory/);
  });
});

describe("bundle rollback", () => {
  test("removes only bytes this copy still proves and preserves user changes/extra files", () => {
    const journal = beginPlan();
    const copied = runCreatedBundleCopy(root, journal, fh);
    expect(copied.kind).toBe("staged");
    const target = join(fh, "projects", "acme", "bundle");
    writeFileSync(join(target, "notes", "a.txt"), "user edit\n");
    writeFileSync(join(target, "extra.txt"), "extra\n");

    const result = rollbackBundleIngest(root, journal.id, fh);
    expect(result.retained).toBeGreaterThan(0);
    expect(readFileSync(join(target, "notes", "a.txt"), "utf-8")).toBe("user edit\n");
    expect(existsSync(join(target, "extra.txt"))).toBe(true);
    expect(existsSync(join(target, "README.md"))).toBe(false);
    expect(existsSync(join(fh, journal.manifestRelPath))).toBe(false);
    expect(existsSync(source)).toBe(true);
    expect(result.journal.status).toBe("failed");
    expect(result.journal.failureReason).toContain("preserved");
  });

  test("removes a fully intact staged bundle and reports no retention", () => {
    const journal = beginPlan();
    const copied = runCreatedBundleCopy(root, journal, fh);
    expect(copied.kind).toBe("staged");
    const result = rollbackBundleIngest(root, journal.id, fh);
    expect(result.retained).toBe(0);
    expect(existsSync(join(fh, "projects", "acme", "bundle"))).toBe(false);
    expect(existsSync(join(fh, journal.manifestRelPath))).toBe(false);
    expect(existsSync(source)).toBe(true);
  });
});
