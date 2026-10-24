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
  const legacy: PageSpec = {
    slug: "knowledge/acme/legacy",
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
    slug: "knowledge/acme/current",
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
