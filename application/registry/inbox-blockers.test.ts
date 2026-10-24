// application/registry/inbox-blockers.test.ts — blocker snapshot, freshness,
// binding switch, damaged state, retained bundles and retry side effects.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IngestBundleJournalV3 } from "../../core/contracts/ingest.ts";
import { bundleManifestRelPath, serializeAssetBundleManifest } from "../../core/contracts/asset-bundle.ts";
import { prepareBundlePlan } from "../ingest/bundle.ts";
import { readJournals, writeJournal } from "../ingest/journal.ts";
import { inboxBlock, inboxRetry, inboxStatus } from "./inbox.ts";
import { inboxBlockersPath, readInboxBlockers, writeInboxBlockers } from "./inbox-state.ts";

let root: string;
let fh: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-inbox-blockers-"));
  fh = join(root, "filehub");
  mkdirSync(join(root, ".jspace"), { recursive: true });
  mkdirSync(join(fh, "_inbox"), { recursive: true });
  mkdirSync(join(fh, "projects", "acme"), { recursive: true });
  mkdirSync(join(fh, "areas", "books"), { recursive: true });
  writeFileSync(join(fh, "projects", "acme", "index.md"), "---\ntype: project-index\nproject: acme\n---\n# Acme\n");
  writeFileSync(join(fh, "areas", "books", "index.md"), "---\ntype: area-index\nowner: books\n---\n# Books\n");
  writeFileSync(join(fh, "README.md"), "# Filehub\n");
  writeHub(root, fh);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeHub(wb: string, filehub: string, binding = "filehub-path"): void {
  writeFileSync(
    join(wb, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [
        {
          id: "filehub",
          type: "filehub",
          domain: "files",
          entrypoints: [{ id: "path", kind: "path", binding, primary: true }],
        },
      ],
      projects: [{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }],
    }),
  );
  writeFileSync(
    join(wb, ".jspace", "local.json"),
    JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { [binding]: filehub } }),
  );
}

interface StatusData {
  files: Array<{
    name: string;
    blockers?: Array<{ code: string; missing: string }>;
    freshness?: string;
    freshnessReason?: string;
    archived?: { journalId: string };
    archive?: { state: string; detail: string };
  }>;
  blockerCoverage: { state: string; orphaned?: string[] };
  count: number;
}

function statusData(): StatusData {
  const result = inboxStatus(root, true, readJournals(root).records);
  return result.data as StatusData;
}

function journalFiles(): string[] {
  const dir = join(root, ".jspace", "state", "ingest");
  return existsSync(dir) ? readdirSync(dir) : [];
}

test("block records a full known fingerprint and status reuses it as current", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "hello");
  const blocked = inboxBlock(root, "a.pdf", "owner_ambiguous", "two projects could own it", ["project:acme"], false, true, []);
  expect(blocked.exitCode).toBeUndefined();
  expect(blocked.errors ?? []).toHaveLength(0);

  const state = readInboxBlockers(root);
  expect(state.state).toBe("ok");
  if (state.state !== "ok") return;
  const entry = state.snapshot.entries[0]!;
  expect(entry.fingerprint).toMatchObject({ state: "known", algorithm: "sha256" });
  expect(entry.routingDigest).toMatchObject({ state: "known", algorithm: "sha256" });
  expect(entry.blockers).toEqual([
    { code: "owner_ambiguous", missing: "two projects could own it", candidates: ["project:acme"] },
  ]);

  const status = statusData();
  expect(status.count).toBe(1);
  expect(status.blockerCoverage.state).toBe("ok");
  expect(status.files[0]).toMatchObject({
    name: "a.pdf",
    freshness: "current",
    blockers: [{ code: "owner_ambiguous", missing: "two projects could own it" }],
  });
  // no ingest/pending side effects, no target write
  expect(journalFiles()).toEqual([]);
  expect(existsSync(join(root, ".jspace", "state", "pending"))).toBe(false);
  expect(existsSync(join(fh, "projects", "acme", "a.pdf"))).toBe(false);
});

test("repeating the same blocker is byte-idempotent and does not duplicate the reason", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "hello");
  expect(inboxBlock(root, "a.pdf", "owner_ambiguous", "two projects could own it", undefined, false, true, []).exitCode).toBeUndefined();
  const before = readFileSync(inboxBlockersPath(root), "utf-8");
  const again = inboxBlock(root, "a.pdf", "owner_ambiguous", "two projects could own it", undefined, false, true, []);
  expect(again.exitCode).toBeUndefined();
  expect((again.lines ?? []).join("\n")).toContain("already recorded");
  expect(readFileSync(inboxBlockersPath(root), "utf-8")).toBe(before);
  const state = readInboxBlockers(root);
  if (state.state === "ok") expect(state.snapshot.entries[0]!.blockers).toHaveLength(1);
});

test("same-size same-mtime content change becomes stale, never current", () => {
  const path = join(fh, "_inbox", "a.pdf");
  writeFileSync(path, "hello!");
  expect(inboxBlock(root, "a.pdf", "source_unverified", "cannot extract", undefined, false, true, []).exitCode).toBeUndefined();
  const before = statSync(path);
  writeFileSync(path, "HELLO?");
  utimesSync(path, before.atime, before.mtime);
  expect(statSync(path).size).toBe(before.size);

  const status = statusData();
  expect(status.files[0]!.freshness).toBe("stale");
  expect(status.files[0]!.freshnessReason).toContain("content changed");
});

test("a directory member change invalidates the tree fingerprint", () => {
  const dir = join(fh, "_inbox", "bundle");
  mkdirSync(dir);
  writeFileSync(join(dir, "a.txt"), "a");
  expect(inboxBlock(root, "bundle", "owner_ambiguous", "which project?", undefined, false, true, []).exitCode).toBeUndefined();
  expect(statusData().files[0]!.freshness).toBe("current");
  writeFileSync(join(dir, "b.txt"), "b");
  expect(statusData().files[0]!.freshness).toBe("stale");
});

test("owner-index routing change invalidates reuse even when bytes are unchanged", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "hello");
  expect(inboxBlock(root, "a.pdf", "owner_ambiguous", "which project?", undefined, false, true, []).exitCode).toBeUndefined();
  writeFileSync(
    join(fh, "projects", "acme", "index.md"),
    "---\ntype: project-index\nproject: acme\n---\n# Acme\n\n## 收录范围\n- 收: reports\n",
  );
  const status = statusData();
  expect(status.files[0]!.freshness).toBe("stale");
  expect(status.files[0]!.freshnessReason).toContain("routing");
});

test("a filehub binding switch never applies same-named decisions from another inbox", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "first");
  expect(inboxBlock(root, "a.pdf", "owner_ambiguous", "which project?", undefined, false, true, []).exitCode).toBeUndefined();

  const fh2 = join(root, "filehub2");
  mkdirSync(join(fh2, "_inbox"), { recursive: true });
  mkdirSync(join(fh2, "projects", "acme"), { recursive: true });
  writeFileSync(join(fh2, "projects", "acme", "index.md"), "---\ntype: project-index\nproject: acme\n---\n");
  writeFileSync(join(fh2, "_inbox", "a.pdf"), "second");
  writeHub(root, fh2);

  const status = statusData();
  expect(status.blockerCoverage.state).toBe("inbox_mismatch");
  expect(status.files[0]!.blockers).toBeUndefined();

  const reblock = inboxBlock(root, "a.pdf", "owner_ambiguous", "which project?", undefined, false, true, []);
  expect(reblock.exitCode).toBeUndefined();
  expect((reblock.lines ?? []).join("\n")).toContain("superseded");
  const state = readInboxBlockers(root);
  expect(state.state).toBe("ok");
  if (state.state === "ok") {
    expect(state.snapshot.inboxRoot).toBe(join(fh2, "_inbox"));
    expect(state.snapshot.entries).toHaveLength(1);
  }
});

test("damaged state is visible, read-only listing remains, and writes refuse to overwrite", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "hello");
  mkdirSync(dirname(inboxBlockersPath(root)), { recursive: true });
  const damaged = "{ not json";
  writeFileSync(inboxBlockersPath(root), damaged);

  const status = inboxStatus(root, true, []);
  const data = status.data as { blockerCoverage: { state: string }; files: unknown[] };
  expect(data.blockerCoverage.state).toBe("damaged");
  expect(data.files).toHaveLength(1);
  expect((status.warnings ?? []).join("\n")).toContain("damaged");

  const blocked = inboxBlock(root, "a.pdf", "owner_ambiguous", "which project?", undefined, false, false, []);
  expect(blocked.exitCode).toBe(1);
  const retried = inboxRetry(root, "a.pdf", false, false, []);
  expect(retried.exitCode).toBe(1);
  expect(readFileSync(inboxBlockersPath(root), "utf-8")).toBe(damaged);
});

test("symlink and restricted members produce unknown freshness without leaking a path", () => {
  const outside = join(root, "outside.pdf");
  writeFileSync(outside, "secret");
  symlinkSync(outside, join(fh, "_inbox", "link.pdf"));
  expect(inboxBlock(root, "link.pdf", "source_unverified", "link target unverified", undefined, false, true, []).exitCode).toBeUndefined();
  let status = statusData();
  expect(status.files[0]!.freshness).toBe("unknown");
  expect(JSON.stringify(status)).not.toContain(outside);

  const bundle = join(fh, "_inbox", "bundle");
  mkdirSync(bundle);
  writeFileSync(join(bundle, "README.md"), "entry");
  writeFileSync(join(bundle, ".env"), "SECRET=1");
  expect(inboxBlock(root, "bundle", "source_unverified", "restricted member", undefined, false, true, []).exitCode).toBeUndefined();
  status = statusData();
  const bundleFile = status.files.find((file) => file.name === "bundle")!;
  expect(bundleFile.freshness).toBe("unknown");
  expect(JSON.stringify(status)).not.toContain(".env");

  const dot = inboxBlock(root, ".env", "source_unverified", "x", undefined, false, false, []);
  expect(dot.exitCode).toBe(1);
});

test("retry only clears the cached decision: no ingest journal, target or completion claim", () => {
  const path = join(fh, "_inbox", "a.pdf");
  writeFileSync(path, "hello");
  expect(inboxBlock(root, "a.pdf", "owner_ambiguous", "which project?", undefined, false, true, []).exitCode).toBeUndefined();

  const dry = inboxRetry(root, "a.pdf", true, true, []);
  expect(dry.exitCode).toBeUndefined();
  expect((dry.data as { removed: boolean }).removed).toBe(true);
  const stillBlocked = readInboxBlockers(root);
  expect(stillBlocked.state === "ok" ? stillBlocked.snapshot.entries.length : -1).toBe(1);

  const retry = inboxRetry(root, "a.pdf", false, true, []);
  expect(retry.exitCode).toBeUndefined();
  expect(statusData().files[0]!.blockers).toBeUndefined();
  expect(existsSync(path)).toBe(true);
  expect(journalFiles()).toEqual([]);
  const again = inboxRetry(root, "a.pdf", false, false, []);
  expect((again.lines ?? []).join("\n")).toContain("no cached decision");
  expect((again.lines ?? []).join("\n")).toContain("does not file");
});

function makeArchivedBundle(sourceName: string): { journal: IngestBundleJournalV3; source: string; target: string } {
  const source = join(fh, "_inbox", sourceName);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "README.md"), "entry bytes");
  writeFileSync(join(source, "chapter.txt"), "chapter bytes");
  const target = join(fh, "projects", "acme", "bundle");

  const slug = "assets/acme/bundle";
  const indexPath = "projects/acme/index.md";
  const indexEntry = "| projects/acme/bundle/README.md | bundle | 2026-10-25 | assets/acme/bundle |";
  const plan = prepareBundlePlan({
    source,
    target,
    ownerRootRel: "projects/acme",
    rootRelPath: "projects/acme/bundle",
    entry: "README.md",
    ownerKind: "project",
    ownerId: "acme",
    slug,
    indexPath,
    indexEntry,
  });
  // Copy only after the plan exists, so the target contents are exactly the
  // source members the manifest describes.
  cpSync(source, target, { recursive: true });
  const manifestRelPath = bundleManifestRelPath("projects/acme", slug);
  mkdirSync(dirname(join(fh, manifestRelPath)), { recursive: true });
  writeFileSync(join(fh, manifestRelPath), serializeAssetBundleManifest(plan.manifest));

  const now = new Date().toISOString();
  const journal: IngestBundleJournalV3 = {
    schema_version: 3,
    kind: "bundle",
    id: randomUUID(),
    source,
    target,
    relPath: "README.md",
    ownerKind: "project",
    ownerId: "acme",
    slug,
    indexPath,
    indexEntry,
    sourcePolicy: "retain",
    manifestRelPath,
    manifestSha256: plan.journal.manifestSha256,
    aggregateSha256: plan.journal.aggregateSha256,
    sourceHash: plan.journal.sourceHash,
    targetHash: plan.journal.sourceHash,
    status: "committed",
    gbrainEvidence: {
      verifiedAt: now,
      revision: randomUUID(),
      contentHash: "b".repeat(64),
      slug,
      ownerKind: "project",
      ownerId: "acme",
      relPath: "README.md",
      tags: ["asset"],
      sourceSha256: plan.journal.sourceHash,
      assetKind: "bundle",
      bundleRoot: "projects/acme/bundle",
      bundleManifest: manifestRelPath,
      bundleSha256: plan.journal.aggregateSha256,
      bundleManifestSha256: plan.journal.manifestSha256,
    },
    indexEvidence: {
      verifiedAt: now,
      path: indexPath,
      contentHash: "c".repeat(64),
      line: indexEntry,
    },
    createdAt: now,
    updatedAt: now,
  };
  writeJournal(root, journal);
  return { journal, source, target };
}

test("committed retained bundle is archived/source_retained, overrides blockers and refuses block/retry", () => {
  const { journal, source } = makeArchivedBundle("bundle");
  // Seed a stale blocker as if it had been recorded before the archive existed.
  // (A real `inbox block` now refuses the archived source, so write the snapshot
  // directly to model the legacy state.)
  writeInboxBlockers(root, {
    schema_version: 1,
    inboxRoot: join(fh, "_inbox"),
    entries: [
      {
        name: "bundle",
        kind: "dir",
        fingerprint: { state: "known", algorithm: "tree-sha256-v1", value: "a".repeat(64) },
        routingDigest: { state: "known", algorithm: "sha256", value: "b".repeat(64) },
        observedAt: new Date().toISOString(),
        blockers: [{ code: "owner_ambiguous", missing: "which project?" }],
      },
    ],
  });

  const status = statusData();
  expect(status.files[0]!.archived).toEqual(
    expect.objectContaining({ journalId: journal.id }),
  );
  expect(status.files[0]!.blockers).toBeUndefined();
  const text = (inboxStatus(root, false, readJournals(root).records).lines ?? []).join("\n");
  expect(text).toContain("archived/source_retained");
  expect(text).not.toContain("owner_ambiguous");

  const block = inboxBlock(
    root,
    "bundle",
    "owner_ambiguous",
    "which project?",
    undefined,
    false,
    false,
    readJournals(root).records,
  );
  expect(block.exitCode).toBe(1);
  expect(block.errors?.[0]).toContain("cleanup");
  const retry = inboxRetry(root, "bundle", false, false, readJournals(root).records);
  expect(retry.exitCode).toBe(1);
  expect(retry.errors?.[0]).toContain("cleanup");
  expect(existsSync(source)).toBe(true);
});

test("a committed journal whose target no longer matches is not claimed as archived", () => {
  makeArchivedBundle("bundle");
  writeFileSync(join(fh, "projects", "acme", "bundle", "README.md"), "drifted");
  const status = statusData();
  expect(status.files[0]!.archived).toBeUndefined();
  expect(JSON.stringify(status.files[0])).toContain("archive");
});

test("status stays read-only: no lock or state file is created", () => {
  writeFileSync(join(fh, "_inbox", "a.pdf"), "hello");
  const status = inboxStatus(root, true, []);
  expect(status.data).toBeDefined();
  expect(existsSync(inboxBlockersPath(root))).toBe(false);
  expect(existsSync(join(root, ".jspace", "state", "mutation.lock"))).toBe(false);
});

test("writing an invalid snapshot is refused by the state helper", () => {
  expect(() =>
    writeInboxBlockers(root, {
      schema_version: 1,
      inboxRoot: join(fh, "_inbox"),
      entries: [
        {
          name: "../bad",
          kind: "file",
          fingerprint: { state: "known", algorithm: "sha256", value: "a".repeat(64) },
          routingDigest: { state: "known", algorithm: "sha256", value: "a".repeat(64) },
          observedAt: new Date().toISOString(),
          blockers: [{ code: "owner_ambiguous", missing: "x" }],
        },
      ],
    }),
  ).toThrow(/refusing to write invalid/);
  expect(lstatSync(join(root, ".jspace")).isDirectory()).toBe(true);
});
