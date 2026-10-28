import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanBundleTree } from "../filehub/bundle.ts";
import {
  aggregateForMembers,
  bundleManifestRelPath,
  serializeAssetBundleManifest,
  type AssetBundleManifestV1,
  type BundleMember,
} from "../../core/contracts/asset-bundle.ts";
import type {
  GbrainBacklinksResult,
  GbrainDeps,
  GbrainListOptions,
  GbrainListResult,
  GbrainPageResult,
} from "../../core/contracts/gbrain.ts";
import { memoryCheck } from "./check.ts";

interface PageSpec {
  slug: string;
  content: string;
  tags?: string[];
  updatedAt?: string;
}

interface Overrides {
  list?: (opts?: GbrainListOptions) => GbrainListResult | Promise<GbrainListResult>;
  get?: (slug: string) => GbrainPageResult | Promise<GbrainPageResult>;
  backlinks?: (slug: string) => GbrainBacklinksResult | Promise<GbrainBacklinksResult>;
}

function fakeGbrain(pages: PageSpec[], overrides: Overrides = {}): GbrainDeps {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  return {
    getPage: async (slug) => {
      if (overrides.get) return overrides.get(slug);
      const page = bySlug.get(slug);
      return page
        ? {
            ok: true,
            page: {
              slug,
              revision: "revision-1",
              contentHash: `hash:${slug}`,
              content: page.content,
              tags: page.tags ?? [],
              updatedAt: page.updatedAt ?? "2026-10-18T12:00:00Z",
            },
          }
        : { ok: false, code: "not_found", message: `missing ${slug}` };
    },
    listPages: async (opts) => {
      if (overrides.list) return overrides.list(opts);
      return {
        ok: true,
        rows: pages.map((page) => ({
          slug: page.slug,
          updatedAt: page.updatedAt ?? "2026-10-18T12:00:00Z",
          type: "note",
        })),
      };
    },
    putPage: async () => ({ ok: false, code: "process_error", message: "read-only test" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "unused" }),
    getBacklinks: async (slug) => {
      if (overrides.backlinks) return overrides.backlinks(slug);
      return {
        ok: true,
        rows: [],
        total: 0,
        truncated: false,
        coverage: { state: "complete", degraded: false },
      };
    },
  };
}

function markdown(opts: {
  project: string;
  tags: string[];
  body: string;
  extra?: string;
}): string {
  return `---
type: note
title: test
source: codex
project: ${opts.project}
${opts.extra ?? ""}tags: [${opts.tags.join(", ")}]
---

${opts.body}
`;
}

const STATE = markdown({
  project: "acme",
  tags: ["project", "source:session"],
  body: `# acme 现状

## 这个项目是什么·解决什么
测试项目。

## 现在到哪了
进行中。

## 下一步
完成验证。

## 执行层
- 框架: Trellis
`,
});

function validPages(): PageSpec[] {
  return [
    { slug: "project/acme/state", content: STATE, tags: ["project", "source:session"] },
    {
      slug: "project/acme/decisions/storage",
      content: markdown({
        project: "acme",
        tags: ["knowledge", "source:session", "kind:principle"],
        body: "# Storage\n\nUse local storage.",
      }),
      tags: ["knowledge", "source:session", "kind:principle"],
    },
    {
      slug: "records/project/acme/2026-10-18-milestone",
      content: markdown({
        project: "acme",
        tags: ["knowledge", "source:session"],
        body: "# Milestone\n\nShipped.",
      }),
      tags: ["knowledge", "source:session"],
    },
    {
      slug: "assets/acme/report",
      content: markdown({
        project: "acme",
        tags: ["asset", "source:session"],
        extra: "rel_path: projects/acme/report.md\nowner_kind: project\n",
        body: "# Report",
      }),
      tags: ["asset", "source:session"],
    },
  ];
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-memory-check-"));
  mkdirSync(join(root, "projects", "acme"), { recursive: true });
  writeFileSync(join(root, "projects", "acme", "report.md"), "report\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("memoryCheck returns ok for canonical, complete pages and a resolvable asset", async () => {
  const report = await memoryCheck(fakeGbrain(validPages()), root);
  expect(report.status).toBe("ok");
  expect(report.coverage.pages.state).toBe("complete");
  expect(report.coverage.filehub.state).toBe("complete");
  expect(report.counts.by_role).toEqual({
    "project-state": 1,
    "project-decision": 1,
    "project-record": 1,
    asset: 1,
  });
  expect(report.findings).toEqual([]);
});

test("memoryCheck treats an old project/<id>/records page as unsupported, not canonical", async () => {
  const pages = validPages();
  pages[2] = {
    slug: "project/acme/records/2026-10-18-milestone",
    content: markdown({
      project: "acme",
      tags: ["knowledge", "source:session"],
      body: "# Wrong namespace",
    }),
    tags: ["knowledge", "source:session"],
  };
  const report = await memoryCheck(fakeGbrain(pages), root);
  expect(report.status).toBe("attention");
  expect(report.counts.by_role["project-record"]).toBeUndefined();
  expect(report.counts.by_role["unknown-owned"]).toBe(1);
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      code: "memory.slug.unsupported",
      slug: "project/acme/records/2026-10-18-milestone",
    }),
  );
});

test("memoryCheck reports partial when list pagination exhausts its budget", async () => {
  const row = { slug: "project/acme/state", updatedAt: "2026-10-18T12:00:00Z" };
  const report = await memoryCheck(
    fakeGbrain([{ slug: row.slug, content: STATE }], {
      list: () => ({
        ok: true,
        rows: [row],
        nextCursor: { updatedAfter: row.updatedAt, updatedAfterSlug: row.slug },
      }),
    }),
    root,
    { pageLimit: 1, maxListPages: 1 },
  );
  expect(report.status).toBe("partial");
  expect(report.coverage.pages.state).toBe("partial");
  expect(report.coverage.pages.list_calls).toBe(1);
  expect(report.findings).toContainEqual(expect.objectContaining({ code: "memory.pages.partial" }));
});

test("memoryCheck reports a page read failure as partial/unknown", async () => {
  const page = validPages()[0]!;
  const report = await memoryCheck(
    fakeGbrain([page], {
      get: () => ({ ok: false, code: "process_error", message: "read failed" }),
    }),
    root,
  );
  expect(report.status).toBe("partial");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "memory.page.unreadable", slug: "project/acme/state" }),
  );
});

test("memoryCheck records historical metadata gaps as unknown without backfilling them", async () => {
  // A non-knowledge role: `knowledge/*` is exempt from the project rule, so it
  // cannot demonstrate the project gap this test records.
  const legacy: PageSpec = {
    slug: "project/acme/lessons/legacy",
    content: "---\ntype: note\n---\n# Legacy\n",
    updatedAt: "2026-08-15T12:00:00Z",
  };
  const report = await memoryCheck(fakeGbrain([legacy]), root);
  expect(report.status).toBe("ok");
  expect(report.counts.historical_metadata).toMatchObject({
    pages: 1,
    source_unknown: 1,
    provenance_unknown: 1,
    project_unknown: 1,
    tags_unknown: 1,
    routing_tag_unknown: 1,
  });
  expect(report.findings.some((finding) => finding.slug === legacy.slug)).toBe(false);
});

test("memoryCheck enforces metadata rules for current writes", async () => {
  const current: PageSpec = {
    slug: "project/acme/lessons/current",
    content: "---\ntype: note\n---\n# Current\n",
    updatedAt: "2026-10-20T12:00:00Z",
  };
  const report = await memoryCheck(fakeGbrain([current]), root);
  expect(report.status).toBe("attention");
  const codes = report.findings
    .filter((finding) => finding.slug === current.slug)
    .map((finding) => finding.code);
  expect(codes).toContain("memory.frontmatter.tags_missing");
  expect(codes).toContain("memory.frontmatter.source_missing");
  expect(codes).toContain("memory.frontmatter.project_missing");
  expect(codes).toContain("memory.provenance.invalid");
  expect(codes).toContain("memory.routing_tag.missing");
});

test("memoryCheck verifies supersession direction through backlinks and reads the replacement", async () => {
  const oldSlug = "knowledge/acme/old";
  const newSlug = "knowledge/acme/new";
  const pages: PageSpec[] = [
    {
      slug: oldSlug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "status:superseded", "source:session"],
        body: "# Old",
      }),
      tags: ["knowledge", "status:superseded", "source:session"],
    },
    {
      slug: newSlug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "source:session"],
        body: `# New\n\nSupersedes: [[${oldSlug}]]\n`,
      }),
      tags: ["knowledge", "source:session"],
    },
  ];
  const report = await memoryCheck(
    fakeGbrain(pages, {
      backlinks: (slug) => ({
        ok: true,
        rows: slug === oldSlug ? [{ slug: newSlug }] : [],
        total: slug === oldSlug ? 1 : 0,
        truncated: false,
        coverage: { state: "complete", degraded: false },
      }),
    }),
    root,
    { knownOwners: { projects: ["acme"], domains: [] } },
  );
  expect(report.status).toBe("ok");
  expect(report.coverage.backlinks).toMatchObject({ state: "complete", checked_pages: 1 });
});

test("memoryCheck never treats degraded backlink coverage as a complete absence or valid chain", async () => {
  const oldSlug = "knowledge/acme/old";
  const newSlug = "knowledge/acme/new";
  const pages: PageSpec[] = [
    {
      slug: oldSlug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "status:superseded", "source:session"],
        body: "# Old",
      }),
    },
    {
      slug: newSlug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "source:session"],
        body: `# New\n\nSupersedes: [[${oldSlug}]]\n`,
      }),
    },
  ];
  const report = await memoryCheck(
    fakeGbrain(pages, {
      backlinks: () => ({
        ok: true,
        rows: [{ slug: newSlug }],
        total: 1,
        truncated: false,
        coverage: { state: "pending", degraded: true },
      }),
    }),
    root,
  );
  expect(report.status).toBe("partial");
  expect(report.coverage.backlinks.state).toBe("partial");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "memory.supersedes.backlink_partial", slug: oldSlug }),
  );
});

test("memoryCheck reports multiple explicit replacements instead of choosing the newest", async () => {
  const oldSlug = "knowledge/acme/old";
  const candidates = ["knowledge/acme/new-a", "knowledge/acme/new-b"];
  const pages: PageSpec[] = [
    {
      slug: oldSlug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "status:superseded", "source:session"],
        body: "# Old",
      }),
    },
    ...candidates.map((slug) => ({
      slug,
      content: markdown({
        project: "acme",
        tags: ["knowledge", "source:session"],
        body: `# Candidate\n\nSupersedes: [[${oldSlug}]]\n`,
      }),
    })),
  ];
  const report = await memoryCheck(
    fakeGbrain(pages, {
      backlinks: () => ({
        ok: true,
        rows: candidates.map((slug) => ({ slug })),
        total: candidates.length,
        truncated: false,
        coverage: { state: "complete", degraded: false },
      }),
    }),
    root,
    { knownOwners: { projects: ["acme"], domains: [] } },
  );
  expect(report.status).toBe("attention");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "memory.supersedes.multiple_replacements", slug: oldSlug }),
  );
});

test("memoryCheck distinguishes a missing Supersedes target from an unreadable one", async () => {
  const oldSlug = "knowledge/acme/missing-target";
  const missing = await memoryCheck(
    fakeGbrain([
      {
        slug: oldSlug,
        content: markdown({
          project: "acme",
          tags: ["knowledge", "source:session"],
          body: "# New\n\nSupersedes: [[knowledge/acme/not-there]]\n",
        }),
      },
    ]),
    root,
    { knownOwners: { projects: ["acme"], domains: [] } },
  );
  expect(missing.status).toBe("attention");
  expect(missing.findings).toContainEqual(
    expect.objectContaining({
      code: "memory.supersedes.target_missing",
      slug: oldSlug,
    }),
  );

  const unreadable = await memoryCheck(
    fakeGbrain(
      [
        {
          slug: oldSlug,
          content: markdown({
            project: "acme",
            tags: ["knowledge", "source:session"],
            body: "# New\n\nSupersedes: [[knowledge/acme/unreadable]]\n",
          }),
        },
      ],
      {
        get: (slug) =>
          slug === "knowledge/acme/unreadable"
            ? { ok: false, code: "process_error", message: "read failed" }
            : {
                ok: true,
                page: {
                  slug,
                  revision: "revision-1",
                  contentHash: "hash",
                  content: markdown({
                    project: "acme",
                    tags: ["knowledge", "source:session"],
                    body: "# New\n\nSupersedes: [[knowledge/acme/unreadable]]\n",
                  }),
                  tags: ["knowledge", "source:session"],
                },
              },
      },
    ),
    root,
    { knownOwners: { projects: ["acme"], domains: [] } },
  );
  expect(unreadable.status).toBe("partial");
  expect(unreadable.findings.some((finding) => finding.code === "memory.supersedes.target_missing")).toBe(false);
  expect(unreadable.findings).toContainEqual(
    expect.objectContaining({
      code: "memory.page.unreadable",
      slug: "knowledge/acme/unreadable",
    }),
  );
});

test("memoryCheck validates weekly Monday identity and the jspace project owner", async () => {
  const valid = await memoryCheck(
    fakeGbrain([
      {
        slug: "records/consolidate/2026-10-12",
        content: markdown({
          project: "jspace",
          tags: ["consolidate", "weekly", "source:cron"],
          body: "# Week\n",
        }),
      },
    ]),
    root,
  );
  expect(valid.status).toBe("ok");
  expect(valid.coverage.backlinks.state).toBe("not_applicable");

  const invalid = await memoryCheck(
    fakeGbrain([
      {
        slug: "records/consolidate/2026-10-20",
        content: markdown({
          project: "acme",
          tags: ["consolidate", "weekly", "source:cron"],
          body: "# Week\n",
        }),
        updatedAt: "2026-10-20T12:00:00Z",
      },
    ]),
    root,
  );
  expect(invalid.status).toBe("attention");
  expect(invalid.findings).toContainEqual(
    expect.objectContaining({ code: "memory.weekly.not_monday" }),
  );
  expect(invalid.findings).toContainEqual(
    expect.objectContaining({ code: "memory.weekly.project_mismatch" }),
  );
});

test("memoryCheck rejects unknown lifecycle status tags", async () => {
  const report = await memoryCheck(
    fakeGbrain([
      {
        slug: "knowledge/acme/status",
        content: markdown({
          project: "acme",
          tags: ["knowledge", "status:maybe", "source:session"],
          body: "# Status\n",
        }),
      },
    ]),
    root,
    { knownOwners: { projects: ["acme"], domains: [] } },
  );
  expect(report.status).toBe("attention");
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      code: "memory.lifecycle.unknown_status",
      slug: "knowledge/acme/status",
    }),
  );
});

test("memoryCheck marks an unregistered filehub unknown rather than claiming pointer health", async () => {
  const report = await memoryCheck(fakeGbrain(validPages()), null);
  expect(report.status).toBe("partial");
  expect(report.coverage.filehub.state).toBe("unknown");
  expect(report.findings).toContainEqual(expect.objectContaining({ code: "memory.filehub.unregistered" }));
});

test("memoryCheck reports asset rel_path omissions and broken files", async () => {
  const pages = validPages();
  pages[3] = {
    slug: "assets/acme/report",
    content: markdown({
      project: "acme",
      tags: ["asset", "source:session"],
      body: "# Report",
    }),
  };
  const missingField = await memoryCheck(fakeGbrain(pages), root);
  expect(missingField.status).toBe("attention");
  expect(missingField.findings).toContainEqual(
    expect.objectContaining({ code: "memory.asset.rel_path_missing", slug: "assets/acme/report" }),
  );

  pages[3] = {
    slug: "assets/acme/report",
    content: markdown({
      project: "acme",
      tags: ["asset", "source:session"],
      extra: "rel_path: projects/acme/missing.md\n",
      body: "# Report",
    }),
  };
  const broken = await memoryCheck(fakeGbrain(pages), root);
  expect(broken.status).toBe("attention");
  expect(broken.findings).toContainEqual(
    expect.objectContaining({ code: "memory.asset.file_missing", path: "projects/acme/missing.md" }),
  );
});

test("memoryCheck treats inactive asset pointers as history, not current registrations", async () => {
  const report = await memoryCheck(
    fakeGbrain([
      {
        slug: "assets/acme/legacy-report",
        content: markdown({
          project: "legacy",
          tags: ["asset", "status:deprecated", "source:session"],
          body: "# Legacy report\n",
        }),
        tags: ["asset", "status:deprecated", "source:session"],
        updatedAt: "2026-10-20T12:00:00Z",
      },
    ]),
    root,
  );
  expect(report.status).toBe("ok");
  expect(report.findings).toEqual([]);
});

test("memoryCheck accepts owner display casing when gbrain lowercases the slug", async () => {
  mkdirSync(join(root, "areas", "AI服务商"), { recursive: true });
  writeFileSync(join(root, "areas", "AI服务商", "tool-stack.md"), "tool stack\n");
  const report = await memoryCheck(
    fakeGbrain([
      {
        slug: "assets/ai服务商/tool-stack",
        content: markdown({
          project: "AI服务商",
          tags: ["asset", "source:session"],
          extra: "rel_path: areas/AI服务商/tool-stack.md\nowner_kind: area\n",
          body: "# Tool stack",
        }),
        tags: ["asset", "source:session"],
      },
    ]),
    root,
  );
  expect(
    report.findings.filter((finding) =>
      finding.code === "memory.asset_owner.mismatch" ||
      finding.code === "memory.asset.area_path_mismatch"
    ),
  ).toEqual([]);
});

test("memoryCheck treats a symlinked asset as unknown coverage, never verified identity", async () => {
  const outside = mkdtempSync(join(tmpdir(), "jspace-memory-outside-"));
  const target = join(outside, "report.md");
  writeFileSync(target, "outside\n");
  rmSync(join(root, "projects", "acme", "report.md"));
  symlinkSync(target, join(root, "projects", "acme", "report.md"));
  try {
    const report = await memoryCheck(fakeGbrain(validPages()), root);
    expect(report.status).toBe("partial");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "memory.asset.file_symlink", slug: "assets/acme/report" }),
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

const BUNDLE_SLUG = "assets/acme/bundle";
const BUNDLE_ROOT = "projects/acme/bundle";

interface MemoryBundleFixture {
  page: PageSpec;
  manifestRel: string;
  manifestText: string;
}

function memoryBundleFixture(): MemoryBundleFixture {
  mkdirSync(join(root, BUNDLE_ROOT, "notes"), { recursive: true });
  writeFileSync(join(root, BUNDLE_ROOT, "README.md"), "entry\n");
  writeFileSync(join(root, BUNDLE_ROOT, "notes", "a.txt"), "a\n");
  const scan = scanBundleTree(join(root, BUNDLE_ROOT));
  if (scan.state !== "ok") throw new Error(scan.detail);
  const members: BundleMember[] = [
    ...scan.directories.map((path) => ({ path, kind: "dir" as const })),
    ...scan.files.map((file) => ({
      path: file.path,
      kind: "file" as const,
      size: file.size,
      sha256: file.sha256,
      executable: file.executable,
    })),
  ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const manifest: AssetBundleManifestV1 = {
    schema_version: 1,
    kind: "asset-bundle",
    ownerKind: "project",
    ownerId: "acme",
    slug: BUNDLE_SLUG,
    rootRelPath: BUNDLE_ROOT,
    entry: "README.md",
    source: { label: "inbox/bundle" },
    members,
    aggregateSha256: aggregateForMembers(members),
  };
  const manifestText = serializeAssetBundleManifest(manifest);
  const manifestRel = bundleManifestRelPath("projects/acme", BUNDLE_SLUG);
  mkdirSync(dirname(join(root, manifestRel)), { recursive: true });
  writeFileSync(join(root, manifestRel), manifestText);
  const entry = members.find((member) => member.path === "README.md");
  if (entry === undefined || entry.kind !== "file") throw new Error("entry member missing");
  const page: PageSpec = {
    slug: BUNDLE_SLUG,
    content: markdown({
      project: "acme",
      tags: ["asset", "source:session"],
      extra:
        `owner_kind: project\nasset_kind: bundle\n` +
        `rel_path: ${BUNDLE_ROOT}/README.md\nbundle_root: ${BUNDLE_ROOT}\n` +
        `bundle_manifest: ${manifestRel}\nbundle_sha256: ${manifest.aggregateSha256}\n` +
        `bundle_manifest_sha256: ${createHash("sha256").update(manifestText).digest("hex")}\n` +
        `source_sha256: ${entry.sha256}\n`,
      body: "# Bundle\n",
    }),
    tags: ["asset", "source:session"],
  };
  return { page, manifestRel, manifestText };
}

test("memoryCheck verifies bundle scalars, manifest identity and the entry digest", async () => {
  const fixture = memoryBundleFixture();
  const report = await memoryCheck(fakeGbrain([fixture.page]), root);
  expect(report.findings).toEqual([]);
  expect(report.counts.by_role.asset).toBe(1);
});

test("memoryCheck reports bundle metadata, manifest and entry mismatches", async () => {
  const fixture = memoryBundleFixture();
  const mismatched = {
    ...fixture.page,
    content: fixture.page.content.replace(
      `source_sha256: ${/source_sha256: ([0-9a-f]{64})/.exec(fixture.page.content)![1]}`,
      `source_sha256: ${"e".repeat(64)}`,
    ),
  };
  const digest = await memoryCheck(fakeGbrain([mismatched]), root);
  expect(digest.findings).toContainEqual(
    expect.objectContaining({ code: "memory.asset.bundle_source_digest_mismatch" }),
  );

  writeFileSync(join(root, fixture.manifestRel), `${fixture.manifestText}\n`);
  const manifestChanged = await memoryCheck(fakeGbrain([fixture.page]), root);
  expect(manifestChanged.findings).toContainEqual(
    expect.objectContaining({ code: "memory.asset.bundle_manifest_changed" }),
  );

  writeFileSync(join(root, fixture.manifestRel), fixture.manifestText);
  const noKind = {
    ...fixture.page,
    content: fixture.page.content.replace("asset_kind: bundle", "asset_kind: document"),
  };
  const fields = await memoryCheck(fakeGbrain([noKind]), root);
  expect(fields.findings).toContainEqual(
    expect.objectContaining({ code: "memory.asset.bundle_fields_unexpected" }),
  );
});

test("memoryCheck does not claim whole-tree proof for a bundle", async () => {
  const fixture = memoryBundleFixture();
  writeFileSync(join(root, BUNDLE_ROOT, "notes", "extra.txt"), "extra\n");
  const report = await memoryCheck(fakeGbrain([fixture.page]), root);
  expect(report.findings).toEqual([]);
});

// ---- derived projections + deterministic topic duplicates ----
// Real shape (2026-10-27 audit of the local brain): 76 `atoms/*` pages over 28
// source pages, none of the sources missing, and no two canonical pages sharing
// a title. These cases pin both the reporting AND its limits: a duplicate atom
// is a counted candidate, a missing source is unknown (never an error), and the
// command must stay read-only.

function atom(slug: string, source: string, title: string): PageSpec {
  return {
    slug,
    content: `---
type: atom
title: ${title}
source_slug: ${source}
tags:
  - knowledge
  - source:cron
---

${title}
`,
    tags: ["knowledge", "source:cron"],
  };
}

test("memoryCheck counts derived pages separately and never treats them as owned", async () => {
  const pages = [
    ...validPages(),
    atom("atoms/2026-09-12/纪律-8ae045b2", "records/retro/2026-09-12", "工作流闭环靠严格纪律"),
    atom("atoms/2026-09-12/迁移-1f2e3d4c", "records/retro/2026-09-12", "迁移 put 未带来源 tag"),
    { slug: "extracts/2026-09-17/atoms/default/x/round-single", content: "---\ntype: extract_receipt\n---\n", tags: [] },
  ];
  const report = await memoryCheck(fakeGbrain(pages), root);
  expect(report.counts.derived.atoms).toBe(2);
  expect(report.counts.derived.extracts).toBe(1);
  expect(report.counts.derived.with_source_slug).toBe(2);
  expect(report.counts.derived.inspected).toBe(3);
  // Owned pages count only the canonical namespaces — atoms are not JSpace pages.
  expect(report.counts.by_role).not.toHaveProperty("atoms");
  expect(report.counts.owned_pages).toBe(validPages().length);
  expect(report.coverage.derived.state).toBe("complete");
  // Two atoms from one source is normal extraction volume, not a duplicate.
  expect(report.counts.derived.duplicate_atom_groups).toBe(0);
});

test("memoryCheck reports the same atom title from one source as a duplicate candidate", async () => {
  const pages = [
    ...validPages(),
    atom("atoms/2026-09-12/纪律-a1", "records/retro/2026-09-12", "工作流闭环靠严格纪律"),
    atom("atoms/2026-09-20/纪律-b2", "records/retro/2026-09-12", "工作流闭环靠严格纪律"),
  ];
  const report = await memoryCheck(fakeGbrain(pages), root);
  expect(report.counts.derived.duplicate_atom_groups).toBe(1);
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "memory.derived.duplicate_atom", severity: "warning" }),
  );
});

test("memoryCheck reports a derived page whose source page is gone as unknown, not an error", async () => {
  const pages = [...validPages(), atom("atoms/2026-09-12/orphan-aa", "records/retro/2030-01-01", "孤立片段")];
  const report = await memoryCheck(fakeGbrain(pages), root);
  expect(report.counts.derived.source_missing).toBe(1);
  const finding = report.findings.find((f) => f.code === "memory.derived.source_missing");
  expect(finding?.severity).toBe("unknown");
  expect(report.status).toBe("partial");
});

test("memoryCheck caps the derived audit and says so instead of claiming full coverage", async () => {
  const pages = [
    ...validPages(),
    ...Array.from({ length: 5 }, (_, i) =>
      atom(`atoms/2026-09-12/a${i}`, "records/retro/2026-09-12", `片段 ${i}`),
    ),
  ];
  const report = await memoryCheck(fakeGbrain(pages), root, { maxDerivedPages: 2 });
  expect(report.counts.derived.atoms).toBe(5);
  expect(report.counts.derived.inspected).toBe(2);
  expect(report.coverage.derived.state).toBe("partial");
  expect(report.coverage.derived.detail).toContain("2 of 5");
});

test("memoryCheck reports one duplicate-title group for unrelated active canonical pages", async () => {
  const twin = (slug: string) => ({
    slug,
    content: markdown({
      project: slug.split("/")[1]!,
      tags: ["knowledge", "source:session"],
      extra: "title: 反例验证纪律\n",
      body: `# 反例验证纪律\n\n正文 ${slug}\n`,
    }),
    tags: ["knowledge", "source:session"],
  });
  const pages = [...validPages(), twin("project/acme/lessons/反例验证"), twin("knowledge/testing/反例验证")];
  const report = await memoryCheck(fakeGbrain(pages), root);
  expect(report.counts.topics.duplicate_title_groups).toBe(1);
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "memory.topics.duplicate_title", severity: "warning" }),
  );
});

test("memoryCheck does not call a Supersedes pair a duplicate", async () => {
  const old = {
    slug: "project/acme/lessons/topic",
    content: markdown({
      project: "acme",
      tags: ["knowledge", "source:session", "status:superseded"],
      extra: "title: 同一主题\n",
      body: "# 同一主题\n\n旧。\n",
    }),
    tags: ["knowledge", "source:session", "status:superseded"],
  };
  const fresh = {
    slug: "project/acme/lessons/topic-v2",
    content: markdown({
      project: "acme",
      tags: ["knowledge", "source:session"],
      extra: "title: 同一主题\n",
      body: "Supersedes: [[project/acme/lessons/topic]]\n\n新。\n",
    }),
    tags: ["knowledge", "source:session"],
  };
  const g = fakeGbrain([...validPages(), old, fresh], {
    backlinks: (slug) =>
      slug === "project/acme/lessons/topic"
        ? {
            ok: true,
            rows: [{ slug: "project/acme/lessons/topic-v2" }],
            total: 1,
            truncated: false,
            coverage: { state: "complete", degraded: false },
          }
        : { ok: true, rows: [], total: 0, truncated: false, coverage: { state: "complete", degraded: false } },
  });
  const report = await memoryCheck(g, root);
  expect(report.counts.topics.duplicate_title_groups).toBe(0);
});

test("memoryCheck never writes while auditing derived pages and topics", async () => {
  let writes = 0;
  const pages = [
    ...validPages(),
    atom("atoms/2026-09-12/x", "records/retro/2026-09-12", "标题"),
  ];
  const g = fakeGbrain(pages);
  const original = g.putPage;
  g.putPage = async (...args) => {
    writes++;
    return original(...args);
  };
  await memoryCheck(g, root);
  expect(writes).toBe(0);
});

test("renderMemoryCheck prints derived and topic sections and keeps the read-only line", async () => {
  const { renderMemoryCheck } = await import("./check.ts");
  const pages = [
    ...validPages(),
    {
      slug: "records/retro/2026-09-12",
      content: "---\nsource: claude\nproject: jspace\ntags: [retro, weekly, source:cron]\n---\n\n# retro\n",
      tags: ["retro", "weekly", "source:cron"],
    },
    atom("atoms/2026-09-12/a1", "records/retro/2026-09-12", "片段"),
    atom("atoms/2026-09-20/a2", "records/retro/2026-09-12", "片段"),
  ];
  const report = await memoryCheck(fakeGbrain(pages), root);
  const { lines } = renderMemoryCheck(report);
  const text = lines.join("\n");
  expect(text).toContain("derived: complete (2 atom(s), 0 extract(s); 2 inspected");
  expect(text).toContain("topics: ");
  expect(text).toContain("duplicate-title group(s)");
  expect(text).toContain("memory.derived.duplicate_atom");
  expect(text).toContain("read-only; no page was modified");
  // A deterministic duplicate is a warning: it needs a human look, and the
  // command did not fail to cover anything.
  expect(report.status).toBe("attention");
});

test("memoryCheck reports a third page that shares a title with a replacement chain", async () => {
  // Realistic half-done transition: the new page already declares Supersedes
  // while the old page is still active (its status tag was not updated yet).
  // {旧, 新} is ONE chain, and the unrelated third page is ONE duplicate — not
  // zero, and not a false "no Supersedes relation" spread over all three.
  const page = (slug: string, body: string) => ({
    slug,
    content: markdown({
      project: slug.split("/")[1]!,
      tags: ["knowledge", "source:session"],
      extra: "title: 同一主题\n",
      body,
    }),
    tags: ["knowledge", "source:session"],
  });
  const old = page("project/acme/lessons/chain", "# 同一主题\n\n旧。\n");
  const fresh = page("project/acme/lessons/chain-v2", "Supersedes: [[project/acme/lessons/chain]]\n\n新。\n");
  const stray = page("knowledge/testing/chain", "# 同一主题\n\n另一条无关记录。\n");
  const report = await memoryCheck(fakeGbrain([...validPages(), old, fresh, stray]), root);
  expect(report.counts.topics.duplicate_title_groups).toBe(1);
  const finding = report.findings.find((f) => f.code === "memory.topics.duplicate_title");
  expect(finding?.message).toContain("2 unrelated page chain(s)");
  // The replacement pair is reported as one chain, never as two unrelated pages.
  expect(finding?.message).toContain("project/acme/lessons/chain + project/acme/lessons/chain-v2");
  expect(finding?.message).toContain("knowledge/testing/chain");
});

test("memoryCheck ignores an inactive page when grouping duplicate titles", async () => {
  // A superseded page is history: its old title colliding with a live page is
  // the protocol working, so it must not produce a finding on its own.
  const page = (slug: string, tags: string[], body: string) => ({
    slug,
    content: markdown({
      project: slug.split("/")[1]!,
      tags,
      extra: "title: 同一主题\n",
      body,
    }),
    tags,
  });
  const report = await memoryCheck(
    fakeGbrain([
      ...validPages(),
      page("project/acme/lessons/gone", ["knowledge", "source:session", "status:superseded"], "# 同一主题\n\n旧。\n"),
      page("knowledge/testing/live", ["knowledge", "source:session"], "# 同一主题\n\n新。\n"),
    ]),
    root,
  );
  expect(report.counts.topics.duplicate_title_groups).toBe(0);
});

test("memoryCheck reports both a capped derived audit and unreadable derived pages", async () => {
  // A cap alone ("2 of 5") would hide that one of the two inspected pages was
  // unreadable. Both limits must appear, because each one independently makes
  // the count a lower bound.
  const pages = [
    ...validPages(),
    atom("atoms/2026-09-12/ok", "records/retro/2026-09-12", "可读片段"),
    atom("atoms/2026-09-12/broken", "records/retro/2026-09-12", "不可读片段"),
    atom("atoms/2026-09-12/capped", "records/retro/2026-09-12", "被截断片段"),
  ];
  const g = fakeGbrain(pages, {
    get: async (slug) =>
      slug === "atoms/2026-09-12/broken"
        ? { ok: false, code: "process_error", message: "boom" }
        : {
            ok: true,
            page: {
              slug,
              revision: "revision-1",
              contentHash: `hash:${slug}`,
              content: pages.find((p) => p.slug === slug)!.content,
              tags: pages.find((p) => p.slug === slug)!.tags ?? [],
              updatedAt: "2026-10-18T12:00:00Z",
            },
          },
  });
  const report = await memoryCheck(g, root, { maxDerivedPages: 2 });
  expect(report.coverage.derived.state).toBe("partial");
  expect(report.coverage.derived.detail).toContain("2 of 3");
  expect(report.coverage.derived.detail).toContain("1 derived page(s) could not be read");
});

// ---- knowledge/*'s project names the SOURCE project, not the domain ----
// gbrain.md §4: `knowledge/<domain>` groups for retrieval, `project` records
// provenance. The rule is therefore existence in the workbench registry, not
// equality with the slug segment. The live brain had four invented ids
// (`gbrain-infra` ×3, `synology-drive` ×1) that no registry knows about.

function knowledgePage(slug: string, project: string | undefined): PageSpec {
  const extra = project === undefined ? "" : `project: ${project}\n`;
  return {
    slug,
    content: `---\ntype: concept\ntitle: ${slug.split("/").pop()}\nsource: claude-code\n${extra}tags: [knowledge, source:session]\n---\n\n# 正文\n`,
    tags: ["knowledge", "source:session"],
  };
}

test("memoryCheck accepts a knowledge page whose project differs from its domain", async () => {
  // `检查必须用反例验证` lives in the 工程实践 domain but came from keel.
  const report = await memoryCheck(
    fakeGbrain([...validPages(), knowledgePage("knowledge/工程实践/反例验证", "keel")]),
    root,
    { knownOwners: { projects: ["keel", "acme"], domains: ["工程实践", "agent-infra"] } },
  );
  expect(report.findings.some((f) => f.code === "memory.project.unknown")).toBe(false);
  expect(report.coverage.owners.state).toBe("complete");
});

test("memoryCheck warns when a knowledge page's project is not a registered owner", async () => {
  const report = await memoryCheck(
    fakeGbrain([...validPages(), knowledgePage("knowledge/ops/gbrain-jobs", "gbrain-infra")]),
    root,
    { knownOwners: { projects: ["keel", "acme"], domains: ["ops"] } },
  );
  const finding = report.findings.find((f) => f.code === "memory.project.unknown");
  expect(finding?.severity).toBe("warning");
  expect(finding?.message).toContain("gbrain-infra");
  // A warning, not an error: the page is still a usable current answer.
  expect(report.status).toBe("attention");
});

test("memoryCheck accepts a knowledge page with no source project at all", async () => {
  // A cross-project fact has no source project and must stay blank rather than
  // borrow one — blank is not a defect, so `project_missing` is exempt for this
  // role. Requiring it here would push writers to invent an owner, which is the
  // exact failure `memory.project.unknown` exists to catch.
  const report = await memoryCheck(
    fakeGbrain([...validPages(), knowledgePage("knowledge/git/worktree-identity", undefined)]),
    root,
    { knownOwners: { projects: ["keel"], domains: ["git"] } },
  );
  expect(report.findings.some((f) => f.code.startsWith("memory.project."))).toBe(false);
  expect(report.findings.some((f) => f.code === "memory.frontmatter.project_missing")).toBe(false);
});

test("memoryCheck still requires project for non-knowledge roles", async () => {
  // The exemption is per role, not a global loosening.
  const noOwner = {
    slug: "project/acme/lessons/ownerless",
    content: "---\ntype: lesson\ntitle: 无主经验\nsource: claude-code\ntags: [knowledge, source:session]\n---\n\n正文\n",
    tags: ["knowledge", "source:session"],
    updatedAt: "2026-10-25T00:00:00Z",
  };
  const report = await memoryCheck(fakeGbrain([...validPages(), noOwner]), root, {
    knownOwners: { projects: ["acme"], domains: [] },
  });
  expect(
    report.findings.some(
      (f) => f.code === "memory.frontmatter.project_missing" && f.slug === "project/acme/lessons/ownerless",
    ),
  ).toBe(true);
});

test("memoryCheck reports owners coverage as unknown with neither a registry nor a state card", async () => {
  // Both sources absent means the rule did not run. That must show up as ONE
  // coverage fact, not a per-page finding that would drown the report — and it
  // must still keep the report out of `ok`, or a skipped rule reads as a pass.
  const report = await memoryCheck(fakeGbrain([knowledgePage("knowledge/ops/x", "whatever")]), root);
  expect(report.coverage.owners.state).toBe("unknown");
  expect(report.coverage.owners.detail).toContain("1 knowledge page(s)");
  expect(report.findings.some((f) => f.code === "memory.project.unknown")).toBe(false);
  expect(report.status).toBe("partial");
});

test("memoryCheck reports owners coverage as not_applicable when no knowledge page names a project", async () => {
  // Nothing was skipped, so nothing is unverified. Reporting `unknown` here
  // would make every registry-less run look degraded for no reason.
  const report = await memoryCheck(fakeGbrain([knowledgePage("knowledge/git/worktree-identity", undefined)]), root);
  expect(report.coverage.owners.state).toBe("not_applicable");
  expect(report.status).toBe("ok");
});

test("memoryCheck takes a project state card as proof the project exists", async () => {
  // The live brain registers only 4 of its 15 projects in hub.json (the rest
  // carry no filehub assets), so the registry alone called `keel` invented. A
  // `project/<id>/state` card is the brain's own declaration of that project.
  const report = await memoryCheck(
    fakeGbrain([
      ...validPages(),
      knowledgePage("knowledge/工程实践/反例验证", "keel"),
      {
        slug: "project/keel/state",
        content: "---\ntype: project-state\nproject: keel\ntags: [project, source:session]\n---\n\n## 这个项目是什么·解决什么\n\n## 现在到哪了\n\n## 下一步\n\n## 执行层\n",
        tags: ["project", "source:session"],
      },
    ]),
    root,
  );
  expect(report.findings.some((f) => f.code === "memory.project.unknown")).toBe(false);
  expect(report.coverage.owners.state).toBe("complete");
});

test("memoryCheck still requires project to equal the slug segment for project pages", async () => {
  // The knowledge exemption must not leak: a decision page's project is its
  // owner and equality is still enforced.
  const wrongOwner = {
    slug: "project/acme/decisions/topic",
    content: markdown({
      project: "keel",
      tags: ["knowledge", "source:session"],
      extra: "title: 主题\n",
      body: "# 主题\n\n正文\n",
    }),
    tags: ["knowledge", "source:session"],
    // After the enforcement boundary: older pages record a historical gap
    // instead of an error, which is a different rule (and not what this pins).
    updatedAt: "2026-10-25T00:00:00Z",
  };
  const report = await memoryCheck(fakeGbrain([...validPages(), wrongOwner]), root, {
    knownOwners: { projects: ["keel", "acme"], domains: [] },
  });
  expect(
    report.findings.some((f) => f.code === "memory.project.mismatch" && f.slug === "project/acme/decisions/topic"),
  ).toBe(true);
});
