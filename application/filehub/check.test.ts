import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type {
  GbrainDeps,
  GbrainListOptions,
  GbrainListResult,
  GbrainPageResult,
} from "../../core/contracts/gbrain.ts";
import {
  filehubCheck,
  renderFilehubCheck,
  type FilehubRegistryProject,
} from "./check.ts";

interface PageSpec {
  slug: string;
  content: string;
  tags?: string[];
}

interface GbrainOverrides {
  list?: (opts?: GbrainListOptions) => GbrainListResult | Promise<GbrainListResult>;
  get?: (slug: string) => GbrainPageResult | Promise<GbrainPageResult>;
}

const PROJECTS: FilehubRegistryProject[] = [
  { id: "acme", asset_rel_path: "projects/acme", status: "active" },
];

const INDEX = `---
type: project-index
project: acme
layout: flat
tags: []
---
# Acme

| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| [[report.md]] | document | 2026-10-18 | assets/acme/report |
`;

const ASSET_PAGE = `---
type: note
title: Report
source: codex
project: acme
owner_kind: project
rel_path: projects/acme/report.md
tags: [asset, source:session]
---
# Report
`;

function validPages(): PageSpec[] {
  return [
    {
      slug: "assets/acme/report",
      content: ASSET_PAGE,
      tags: ["asset", "source:session"],
    },
  ];
}

function fakeGbrain(pages: PageSpec[], overrides: GbrainOverrides = {}): GbrainDeps {
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
          updatedAt: "2026-10-18T12:00:00Z",
          type: "note",
        })),
      };
    },
    putPage: async () => ({ ok: false, code: "process_error", message: "read-only test" }),
    getWriteRequest: async () => ({ ok: false, code: "not_found", message: "unused" }),
    getBacklinks: async () => ({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      coverage: { state: "complete", degraded: false },
    }),
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-filehub-check-"));
  mkdirSync(join(root, "projects", "acme"), { recursive: true });
  writeFileSync(join(root, "projects", "acme", "index.md"), INDEX);
  writeFileSync(join(root, "projects", "acme", "report.md"), "report\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("filehubCheck returns ok for a fully registered and cross-linked flat project", async () => {
  const report = await filehubCheck(fakeGbrain(validPages()), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("ok");
  expect(report.coverage.files.state).toBe("complete");
  expect(report.coverage.registry.state).toBe("complete");
  expect(report.coverage.memory.state).toBe("complete");
  expect(report.counts.index_rows).toBe(1);
  expect(report.findings).toEqual([]);
});

test("filehubCheck parses relative Markdown links and backticked index cells", async () => {
  writeFileSync(
    join(root, "projects", "acme", "index.md"),
    `---
type: project-index
project: acme
layout: flat
tags: []
---
# Acme

| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| [报告](./report.md) | \`document\` | 2026-10-18 | \`assets/acme/report\` |
`,
  );
  const report = await filehubCheck(fakeGbrain(validPages()), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("ok");
  expect(report.counts.index_rows).toBe(1);
  expect(report.findings).toEqual([]);
});

test("filehubCheck parses wikilink aliases without splitting the table row", async () => {
  writeFileSync(
    join(root, "projects", "acme", "index.md"),
    INDEX.replace("[[report.md]]", "[[report.md|报告]]"),
  );
  const report = await filehubCheck(fakeGbrain(validPages()), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("ok");
  expect(report.counts.index_rows).toBe(1);
});

test("area owner display casing is equivalent to the lowercase asset slug", async () => {
  rmSync(join(root, "projects"), { recursive: true, force: true });
  mkdirSync(join(root, "areas", "AI服务商"), { recursive: true });
  writeFileSync(
    join(root, "areas", "AI服务商", "index.md"),
    `---
type: area-index
area: AI服务商
tags: []
---
# AI服务商

| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| [[tool-stack.md]] | document | 2026-10-18 | assets/ai服务商/tool-stack |
`,
  );
  writeFileSync(join(root, "areas", "AI服务商", "tool-stack.md"), "tool stack\n");
  const report = await filehubCheck(
    fakeGbrain([
      {
        slug: "assets/ai服务商/tool-stack",
        content: `---
type: note
title: Tool stack
source: codex
project: AI服务商
owner_kind: area
rel_path: areas/AI服务商/tool-stack.md
tags: [asset, source:session]
---
# Tool stack
`,
        tags: ["asset", "source:session"],
      },
    ]),
    { root, projects: [] },
  );
  expect(report.findings).toEqual([]);
});

test("filehubCheck never treats an absent registry or filehub as an empty consistent state", async () => {
  const report = await filehubCheck(fakeGbrain([]), {
    root: null,
    projects: null,
    registryIssue: "hub.json is missing",
  });
  expect(report.status).toBe("partial");
  expect(report.coverage.files.state).toBe("unknown");
  expect(report.coverage.registry.state).toBe("unknown");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.root.unregistered", severity: "unknown" }),
  );
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.registry.unreadable", severity: "unknown" }),
  );
});

test("filehubCheck marks an incomplete gbrain inventory partial and never calls an index page missing", async () => {
  const report = await filehubCheck(
    fakeGbrain(validPages(), {
      list: () => ({ ok: false, code: "timeout", message: "list timed out" }),
    }),
    { root, projects: PROJECTS },
  );
  expect(report.status).toBe("partial");
  expect(report.coverage.memory.state).toBe("partial");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.memory.inventory_partial", severity: "unknown" }),
  );
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.index.page_unverified", severity: "unknown" }),
  );
  expect(report.findings.some((finding) => finding.code === "filehub.index.page_missing")).toBe(false);
});

test("filehubCheck distinguishes an unreadable page from a missing page", async () => {
  const report = await filehubCheck(
    fakeGbrain(validPages(), {
      get: () => ({ ok: false, code: "process_error", message: "read failed" }),
    }),
    { root, projects: PROJECTS },
  );
  expect(report.status).toBe("partial");
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      code: "filehub.memory.page_unreadable",
      slug: "assets/acme/report",
    }),
  );
  expect(report.findings.some((finding) => finding.code === "filehub.index.page_missing")).toBe(false);
});

describe("filehubCheck pointer/index mismatches", () => {
  test("reports a missing rel_path without inventing a filesystem inconsistency", async () => {
    const pages = validPages();
    pages[0] = {
      ...pages[0]!,
      content: ASSET_PAGE.replace("rel_path: projects/acme/report.md\n", ""),
    };
    const report = await filehubCheck(fakeGbrain(pages), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "filehub.memory.rel_path_missing", severity: "error" }),
    );
    expect(report.findings.some((finding) => finding.code === "filehub.index.file_missing")).toBe(false);
  });

  test("reports both a missing index target page and an unregistered readable asset page", async () => {
    writeFileSync(join(root, "projects", "acme", "other.md"), "other\n");
    writeFileSync(
      join(root, "projects", "acme", "index.md"),
      INDEX.replace("| [[report.md]]", "| [[other.md]]").replace(
        "assets/acme/report",
        "assets/acme/other",
      ),
    );
    const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "filehub.index.page_missing",
        path: "projects/acme/index.md",
      }),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "filehub.index.asset_unregistered" }),
    );
  });

  test("reports a broken file, owner mismatch and path mismatch", async () => {
    unlinkSync(join(root, "projects", "acme", "report.md"));
    const pages = validPages();
    pages[0] = {
      ...pages[0]!,
      content: ASSET_PAGE.replace("project: acme", "project: other").replace(
        "rel_path: projects/acme/report.md",
        "rel_path: projects/acme/other.md",
      ),
    };
    const report = await filehubCheck(fakeGbrain(pages), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toContain("filehub.memory.owner_mismatch");
    expect(codes).toContain("filehub.memory.file_missing");
    expect(codes).toContain("filehub.index.path_mismatch");
  });

  test("reports an unregistered ordinary asset", async () => {
    writeFileSync(join(root, "projects", "acme", "loose.md"), "loose\n");
    const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "filehub.asset.unindexed",
        path: "projects/acme/loose.md",
      }),
    );
  });

  test("reports duplicate pointers to one physical asset", async () => {
    const pages = validPages();
    pages.push({
      slug: "assets/acme/another-report",
      content: ASSET_PAGE,
      tags: ["asset", "source:session"],
    });
    const report = await filehubCheck(fakeGbrain(pages), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "filehub.memory.duplicate_pointer",
        path: "projects/acme/report.md",
      }),
    );
  });

  test("treats superseded asset pointers as history, not current registrations", async () => {
    const pages = validPages();
    pages.push({
      slug: "assets/acme/legacy-report",
      content: ASSET_PAGE.replace("project: acme", "project: legacy").replace(
        "tags: [asset, source:session]",
        "tags: [asset, status:superseded, source:session]",
      ),
      tags: ["asset", "status:superseded", "source:session"],
    });
    const report = await filehubCheck(fakeGbrain(pages), { root, projects: PROJECTS });
    expect(report.status).toBe("ok");
    expect(report.coverage.memory).toMatchObject({
      asset_pages: 2,
      active_asset_pages: 1,
      inactive_asset_pages: 1,
    });
    expect(report.findings).toEqual([]);
  });

  test("flags an owner index row that still points to a non-current asset page", async () => {
    const pages = validPages();
    pages[0] = {
      ...pages[0]!,
      content: ASSET_PAGE.replace(
        "tags: [asset, source:session]",
        "tags: [asset, status:deprecated, source:session]",
      ),
      tags: ["asset", "status:deprecated", "source:session"],
    };
    const report = await filehubCheck(fakeGbrain(pages), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "filehub.index.page_inactive",
        path: "projects/acme/index.md",
      }),
    );
  });

  test("reports identical content at different asset paths without echoing content", async () => {
    writeFileSync(join(root, "projects", "acme", "report-copy.md"), "report\n");
    const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
    expect(report.status).toBe("attention");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "filehub.asset.duplicate_content",
        severity: "warning",
        path: "projects/acme/report-copy.md",
      }),
    );
    expect(report.coverage.files.asset_content_hashed).toBe(2);
    const rendered = renderFilehubCheck(report).lines.join("\n");
    expect(rendered).toContain("filehub.asset.duplicate_content");
    expect(rendered).not.toContain("report\n");
  });

  test("distinct version payloads do not produce a duplicate-content finding", async () => {
    writeFileSync(join(root, "projects", "acme", "report-v1.md"), "version one\n");
    writeFileSync(join(root, "projects", "acme", "report-v2.md"), "version two\n");
    const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
    expect(report.findings.some((finding) => finding.code === "filehub.asset.duplicate_content")).toBe(false);
    expect(report.coverage.files.asset_content_hashed).toBe(3);
  });
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "an unreadable asset makes content coverage partial",
  async () => {
    const unreadable = join(root, "projects", "acme", "unreadable.md");
    writeFileSync(unreadable, "cannot read\n");
    const { chmodSync } = await import("node:fs");
    chmodSync(unreadable, 0o000);
    try {
      const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
      expect(report.status).toBe("partial");
      expect(report.coverage.files.state).toBe("partial");
      expect(report.coverage.files.asset_content_unreadable).toBe(1);
      expect(report.findings).toContainEqual(
        expect.objectContaining({
          code: "filehub.asset.content_unreadable",
          severity: "unknown",
          path: "projects/acme/unreadable.md",
        }),
      );
    } finally {
      chmodSync(unreadable, 0o600);
    }
  },
);

test("filehubCheck honours support, companion, archive and restricted boundaries", async () => {
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "projects", "acme", "mcp-server", "src"), { recursive: true });
  mkdirSync(join(root, "projects", "acme", "status"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# filehub\n");
  writeFileSync(join(root, "scripts", "extract.py"), "print('ok')\n");
  writeFileSync(join(root, ".gitignore"), ".env\n");
  writeFileSync(join(root, "projects", "acme", "mcp-server", "requirements.txt"), "sdk\n");
  writeFileSync(join(root, "projects", "acme", "mcp-server", "src", "server.py"), "print('ok')\n");
  writeFileSync(join(root, "projects", "acme", "status", "2026-10-19.md"), "# status\n");
  writeFileSync(join(root, "projects", "acme", "report.extract.md"), "# extract\n");
  mkdirSync(join(root, "archive", "2026"), { recursive: true });
  writeFileSync(join(root, "archive", "2026", "cold.md"), "cold\n");
  writeFileSync(join(root, "projects", "acme", ".env"), "SECRET=not-logged\n");

  const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
  expect(report.status).toBe("ok");
  expect(report.coverage.files.support_files).toBeGreaterThanOrEqual(6);
  expect(report.coverage.files.companions).toBe(1);
  expect(report.coverage.files.archived_files).toBe(1);
  expect(report.coverage.files.restricted_files).toBe(1);
  expect(report.findings).toEqual([]);
  expect(renderFilehubCheck(report).lines.join("\n")).not.toContain("not-logged");
});

test("owner index support_paths isolate project kit files from asset coverage", async () => {
  mkdirSync(join(root, "projects", "acme", "mcp-server", "src"), { recursive: true });
  writeFileSync(
    join(root, "projects", "acme", "index.md"),
    INDEX.replace(
      "layout: flat\n",
      "layout: flat\nsupport_paths:\n  - project-context.md\n  - mcp-server/\n",
    ),
  );
  writeFileSync(join(root, "projects", "acme", "project-context.md"), "# context\n");
  writeFileSync(join(root, "projects", "acme", "mcp-server", "mcp.json.example"), "{}\n");
  writeFileSync(join(root, "projects", "acme", "mcp-server", "src", "server.py"), "print('ok')\n");

  const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
  expect(report.findings).toEqual([]);
  expect(report.status).toBe("ok");
  expect(report.coverage.files.support_files).toBe(3);
});

test("support_paths rejects missing paths and support files registered as assets", async () => {
  writeFileSync(
    join(root, "projects", "acme", "index.md"),
    INDEX.replace(
      "layout: flat\n",
      "layout: flat\nsupport_paths:\n  - notes.md\n  - missing.md\n",
    ).replace("| [[report.md]]", "| [[notes.md]]"),
  );
  writeFileSync(join(root, "projects", "acme", "notes.md"), "notes\n");
  unlinkSync(join(root, "projects", "acme", "report.md"));

  const report = await filehubCheck(fakeGbrain([]), { root, projects: PROJECTS });
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.index.support_path_missing" }),
  );
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.index.support_registered" }),
  );
});

test("filehubCheck does not follow symlinks and reports unverified identity", async () => {
  symlinkSync(join(root, "projects", "acme", "report.md"), join(root, "projects", "acme", "alias.md"));
  const report = await filehubCheck(fakeGbrain(validPages()), { root, projects: PROJECTS });
  expect(report.status).toBe("partial");
  expect(report.coverage.files.state).toBe("partial");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ code: "filehub.path.symlink", severity: "unknown" }),
  );
});

test("filehubCheck is read-only for files and gbrain", async () => {
  let writes = 0;
  const gbrain = fakeGbrain(validPages());
  const guarded: GbrainDeps = {
    ...gbrain,
    putPage: async () => {
      writes += 1;
      return { ok: false, code: "process_error", message: "write attempted" };
    },
  };
  const snapshot = () => {
    const out = new Map<string, { content: string; mtimeMs: number; mode: number }>();
    const walk = (dir: string): void => {
      for (const entry of [...new Bun.Glob("**/*").scanSync({ cwd: dir })] as string[]) {
        const abs = join(dir, entry);
        const stat = lstatSync(abs);
        if (!stat.isFile()) continue;
        out.set(relative(root, abs), {
          content: readFileSync(abs, "utf-8"),
          mtimeMs: stat.mtimeMs,
          mode: stat.mode,
        });
      }
    };
    walk(root);
    return out;
  };
  const before = snapshot();
  await filehubCheck(guarded, { root, projects: PROJECTS });
  expect(snapshot()).toEqual(before);
  expect(writes).toBe(0);
});

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pagesWithDigest(digest: string | undefined): PageSpec[] {
  const marker = "rel_path: projects/acme/report.md";
  const content =
    digest === undefined
      ? ASSET_PAGE
      : ASSET_PAGE.replace(marker, `${marker}\nsource_sha256: ${digest}`);
  return [{ slug: "assets/acme/report", content, tags: ["asset", "source:session"] }];
}

test("filehubCheck keeps a matching source digest ok and counts coverage", async () => {
  const digest = sha256Text("report\n");
  const report = await filehubCheck(fakeGbrain(pagesWithDigest(digest)), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("ok");
  expect(report.findings).toEqual([]);
  expect(report.coverage.memory.source_digest_present).toBe(1);
  expect(report.coverage.memory.source_digest_absent).toBe(0);
});

test("filehubCheck reports a changed source digest as needs-review without claiming semantic failure", async () => {
  const digest = sha256Text("report\n");
  writeFileSync(join(root, "projects", "acme", "report.md"), "report changed\n");
  const report = await filehubCheck(fakeGbrain(pagesWithDigest(digest)), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("attention");
  const finding = report.findings.find((item) => item.code === "filehub.memory.source_digest_changed");
  expect(finding?.severity).toBe("warning");
  expect(finding?.slug).toBe("assets/acme/report");
  expect(finding?.path).toBe("projects/acme/report.md");
  expect(finding?.message).toContain("source_identity=changed");
  expect(finding?.message).toContain("semantic_verification=not_performed");
  expect(report.coverage.memory.source_digest_present).toBe(1);
  expect(renderFilehubCheck(report).exitCode).toBe(1);
});

test("a pure move with an unchanged source digest stays ok", async () => {
  const digest = sha256Text("report\n");
  writeFileSync(join(root, "projects", "acme", "report-2026.md"), "report\n");
  rmSync(join(root, "projects", "acme", "report.md"));
  writeFileSync(
    join(root, "projects", "acme", "index.md"),
    INDEX.replace("[[report.md]]", "[[report-2026.md]]"),
  );
  const page = ASSET_PAGE.replace(
    "rel_path: projects/acme/report.md",
    `rel_path: projects/acme/report-2026.md\nsource_sha256: ${digest}`,
  );
  const report = await filehubCheck(
    fakeGbrain([{ slug: "assets/acme/report", content: page, tags: ["asset", "source:session"] }]),
    { root, projects: PROJECTS },
  );
  expect(report.status).toBe("ok");
  expect(report.coverage.memory.source_digest_present).toBe(1);
});

test("legacy pages without source_sha256 stay silent but are counted as absent", async () => {
  const report = await filehubCheck(fakeGbrain(validPages()), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("ok");
  expect(report.findings).toEqual([]);
  expect(report.coverage.memory.source_digest_absent).toBe(1);
});

test("a malformed source_sha256 is a warning and is not compared", async () => {
  const report = await filehubCheck(fakeGbrain(pagesWithDigest("not-a-digest")), {
    root,
    projects: PROJECTS,
  });
  expect(report.status).toBe("attention");
  const finding = report.findings.find((item) => item.code === "filehub.memory.source_digest_invalid");
  expect(finding?.severity).toBe("warning");
  expect(report.coverage.memory.source_digest_absent).toBe(1);
});

test("a page cannot force content hashing of a restricted target", async () => {
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(join(root, "secrets", "token.txt"), "super-secret-value\n");
  const secretDigest = sha256Text("super-secret-value\n");
  const page = `---
type: note
source: codex
project: acme
owner_kind: project
rel_path: secrets/token.txt
source_sha256: ${"a".repeat(64)}
tags: [asset, source:session]
---
# Leak
`;
  const report = await filehubCheck(
    fakeGbrain([{ slug: "assets/acme/leak", content: page, tags: ["asset", "source:session"] }]),
    { root, projects: PROJECTS },
  );
  expect(report.findings.some((item) => item.code === "filehub.memory.source_digest_changed")).toBe(false);
  expect(report.coverage.memory.source_digest_present).toBe(0);
  expect(report.coverage.memory.source_digest_absent).toBe(1);
  expect(report.findings.every((item) => !item.message.includes(secretDigest.slice(0, 12)))).toBe(true);
});

test("coverage counters add up when the page target is missing", async () => {
  rmSync(join(root, "projects", "acme", "report.md"));
  const page = ASSET_PAGE.replace(
    "rel_path: projects/acme/report.md",
    `rel_path: projects/acme/report.md\nsource_sha256: ${"b".repeat(64)}`,
  );
  const report = await filehubCheck(
    fakeGbrain([{ slug: "assets/acme/report", content: page, tags: ["asset", "source:session"] }]),
    { root, projects: PROJECTS },
  );
  expect(report.findings.some((item) => item.code === "filehub.memory.file_missing")).toBe(true);
  expect(report.coverage.memory.active_asset_pages).toBe(1);
  expect(report.coverage.memory.source_digest_present).toBe(0);
  expect(report.coverage.memory.source_digest_absent).toBe(1);
});
