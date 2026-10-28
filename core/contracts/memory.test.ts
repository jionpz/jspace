import { expect, test } from "bun:test";
import {
  classifyMemoryPage,
  declaresSupersedes,
  isCanonicalAnswer,
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

// ---- canonical vs derived classification ----
// The rule set is shared by the recall contract, the session-start collector and
// the read-only audit. These cases pin the precedence so a derived page can
// never be promoted by whatever tags gbrain happened to merge into it.

test("classifyMemoryPage: atoms/extracts are derived whatever their tags say", () => {
  expect(classifyMemoryPage("atoms/2026-09-12/some-insight-8ae045b2", ["knowledge", "source:cron"])).toBe("derived");
  expect(classifyMemoryPage("extracts/2026-09-17/atoms/default/x/round-single", ["knowledge"])).toBe("derived");
  expect(isCanonicalAnswer("atoms/2026-09-12/x", ["knowledge", "status:settled"])).toBe(false);
});

test("classifyMemoryPage: inactive beats canonical so superseded pages never answer", () => {
  expect(classifyMemoryPage("project/acme/decisions/stack", ["knowledge", "status:superseded"])).toBe("inactive");
  expect(classifyMemoryPage("knowledge/ops/topic", ["knowledge", "status:archived"])).toBe("inactive");
  expect(classifyMemoryPage("project/acme/state", ["project", "status:deprecated"])).toBe("inactive");
});

test("classifyMemoryPage: weekly roles are projections", () => {
  expect(classifyMemoryPage("records/consolidate/2026-10-12", ["consolidate", "weekly"])).toBe("projection");
  expect(classifyMemoryPage("records/retro/2026-10-12", ["retro", "weekly"])).toBe("projection");
  expect(classifyMemoryPage("profile/output-style", ["profile", "weekly"])).toBe("projection");
});

test("classifyMemoryPage: activity:maintenance is a write-event tag, not a page class", () => {
  // The tag means "this write was housekeeping, do not count it as business
  // activity". It is carried by real state/lesson/decision pages (38 on the
  // live brain), so treating it as a page class would drop current answers from
  // session-start merely because housekeeping touched them last.
  expect(classifyMemoryPage("project/acme/decisions/hermes", ["knowledge", "activity:maintenance"])).toBe("canonical");
  expect(classifyMemoryPage("project/acme/state", ["project", "activity:maintenance"])).toBe("canonical");
  expect(classifyMemoryPage("project/acme/lessons/gone", ["knowledge", "activity:maintenance", "status:superseded"])).toBe("inactive");
});

test("classifyMemoryPage: only authorized canonical roles answer; unknown-owned does not", () => {
  for (const slug of [
    "project/acme/state",
    "project/acme/decisions/stack",
    "project/acme/lessons/retry",
    "records/project/acme/2026-10-01-incident",
    "knowledge/architecture/retry",
    "profile/output-style",
    "assets/acme/report",
  ]) {
    expect(classifyMemoryPage(slug, ["knowledge"])).toBe("canonical");
  }
  expect(classifyMemoryPage("project/acme/records/2026-10-01-x", ["knowledge"])).toBe("unclassified");
  expect(classifyMemoryPage("somewhere/else", ["knowledge"])).toBe("unclassified");
});

test("classifyMemoryPage: derived may carry a source_slug, so slug alone decides derivation", () => {
  // gbrain atoms quote `source_slug: records/retro/...`; they remain evidence
  // about that source page, never a replacement for it.
  expect(classifyMemoryPage("atoms/2026-09-12/x", [])).toBe("derived");
  expect(classifyMemoryPage("records/retro/2026-09-12", [])).toBe("projection");
});
