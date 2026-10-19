import { expect, test } from "bun:test";
import {
  declaresSupersedes,
  memoryOwnerEquals,
  memoryRole,
  parseMemoryMarkdown,
  provenanceTags,
  supersedesTargets,
} from "./memory.ts";

test("memoryRole recognizes the canonical sparse project-event namespace", () => {
  expect(memoryRole("records/project/acme/2026-10-18-storage-incident")).toBe("project-record");
  expect(memoryRole("project/acme/records/2026-10-18-storage-incident")).toBe("unknown-owned");
});

test("memoryRole keeps each canonical root distinct", () => {
  expect(memoryRole("project/acme/state")).toBe("project-state");
  expect(memoryRole("project/acme/decisions/storage")).toBe("project-decision");
  expect(memoryRole("project/acme/lessons/retry")).toBe("project-lesson");
  expect(memoryRole("knowledge/architecture/retry")).toBe("knowledge");
  expect(memoryRole("profile/output-style")).toBe("profile");
  expect(memoryRole("assets/acme/report")).toBe("asset");
  expect(memoryRole("records/consolidate/2026-10-12")).toBe("weekly-consolidate");
  expect(memoryRole("records/retro/2026-10-12")).toBe("weekly-retro");
});

test("parseMemoryMarkdown reads scalar fields and block tags without depending on gbrain normalization", () => {
  const parsed = parseMemoryMarkdown(`---
type: note
source: codex
project: acme
rel_path: projects/acme/report.md
support_paths:
  - project-context.md
  - mcp-server/
tags:
  - asset
  - "source:session"
---

# Report
`);
  expect(parsed.fields).toEqual({
    type: "note",
    source: "codex",
    project: "acme",
    rel_path: "projects/acme/report.md",
  });
  expect(parsed.tags).toEqual(["asset", "source:session"]);
  expect(parsed.lists).toEqual({
    support_paths: ["project-context.md", "mcp-server/"],
    tags: ["asset", "source:session"],
  });
  expect(parsed.body).toContain("# Report");
});

test("parseMemoryMarkdown reads inline string lists", () => {
  const parsed = parseMemoryMarkdown(`---
support_paths: [README.md, "mcp-server/"]
tags: [project]
---
body
`);
  expect(parsed.lists.support_paths).toEqual(["README.md", "mcp-server/"]);
  expect(parsed.tags).toEqual(["project"]);
});

test("provenance and Supersedes parsing preserve exact direction", () => {
  const tags = provenanceTags(["knowledge", "source:cron", "source:session"]);
  expect(tags).toEqual(["source:cron", "source:session"]);

  const body = [
    "Supersedes: [[knowledge/architecture/old|old design]]",
    "supersedes: [[project/acme/decisions/older]]",
    "Supersedes: [[knowledge/architecture/old]]",
  ].join("\n");
  expect(supersedesTargets(body)).toEqual([
    "knowledge/architecture/old",
    "project/acme/decisions/older",
  ]);
  expect(declaresSupersedes(body, "knowledge/architecture/old")).toBe(true);
  expect(declaresSupersedes("The old page supersedes this one.", "knowledge/architecture/old")).toBe(false);
});

test("memoryOwnerEquals follows gbrain slug ASCII case folding", () => {
  expect(memoryOwnerEquals("AI服务商", "ai服务商")).toBe(true);
  expect(memoryOwnerEquals("servers", "agents")).toBe(false);
  expect(memoryOwnerEquals(undefined, "AI服务商")).toBe(false);
});

test("block lists survive comment and blank lines (support_paths truncation regression)", () => {
  // Real-use regression: an owner index wrote a comment inside `support_paths`;
  // the parser stopped at it and silently dropped the remaining paths, which
  // surfaced only as far-away `filehub.asset.unindexed` warnings.
  const parsed = parseMemoryMarkdown(
    [
      "---",
      "type: project-index",
      "support_paths:",
      "  - a.md",
      "  # grouped screenshots",
      "  - b.png",
      "",
      "  - c.png",
      "tags: [project]",
      "owner: acme",
      "---",
      "body",
    ].join("\n"),
  );
  expect(parsed.lists.support_paths).toEqual(["a.md", "b.png", "c.png"]);
  // a following top-level key still terminates the list and parses normally
  expect(parsed.tags).toEqual(["project"]);
  expect(parsed.fields.owner).toBe("acme");
});
