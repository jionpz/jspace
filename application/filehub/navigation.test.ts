import { describe, expect, test } from "bun:test";
import {
  NAV_PROJECTS_BLOCK_END,
  NAV_PROJECTS_BLOCK_START,
  NAV_VERSION,
  renderProjectsNavBlock,
  renderRootNavBlock,
  type NavInput,
} from "./navigation.ts";

const INPUT: NavInput = {
  projects: [
    { id: "beta", status: "archived", assetRelPath: "projects/beta", hasIndex: true },
    { id: "acme", status: "active", assetRelPath: "projects/acme", hasIndex: true },
    { id: "gap", status: "active", assetRelPath: "projects/gap", hasIndex: false },
  ],
  areas: [
    { id: "research", hasIndex: true },
    { id: "no-index", hasIndex: false },
  ],
  unregistered: ["projects/stray"],
};

describe("root navigation", () => {
  test("lists only active projects, areas and one entry to the full directory", () => {
    const block = renderRootNavBlock(INPUT);
    expect(block.startsWith("<!-- JSPACE:FILEHUB:NAV:START -->")).toBe(true);
    expect(block).toContain(`> filehub-nav-version: ${NAV_VERSION}`);
    expect(block).toContain("[acme](projects/acme/index.md) — `project:acme`");
    expect(block).not.toContain("beta");
    expect(block).not.toContain("stray");
    expect(block).toContain("[research](areas/research/index.md) — `area:research`");
    expect(block).toContain("[全部项目（活跃 / 已结束）](projects/README.md)");
    expect(block.endsWith("<!-- JSPACE:FILEHUB:NAV:END -->")).toBe(true);
  });

  test("a missing owner index is a visible gap, never a fake link", () => {
    const block = renderRootNavBlock(INPUT);
    expect(block).toContain("- gap — 待补 `projects/gap/index.md`");
    expect(block).toContain("- no-index — 待补 `areas/no-index/index.md`");
    expect(block).not.toContain("(projects/gap/index.md)");
    expect(block).not.toContain("(areas/no-index/index.md)");
  });

  test("has no timestamps and is deterministic", () => {
    expect(renderRootNavBlock(INPUT)).toBe(renderRootNavBlock(structuredClone(INPUT)));
    expect(renderRootNavBlock(INPUT)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("empty registries are explicit, not blank sections", () => {
    const block = renderRootNavBlock({ projects: [], areas: [], unregistered: [] });
    expect(block.match(/- （无）/g)).toHaveLength(2);
  });

  test("an existing archive root is reachable, without inventing a project status", () => {
    const linked = renderRootNavBlock({ ...INPUT, hasArchive: true, hasArchiveIndex: true });
    expect(linked).toContain("[归档（已结束 / 冷资料）](archive/README.md)");
    expect(linked).not.toMatch(/archive.*status/);

    const headline = renderRootNavBlock({ ...INPUT, hasArchive: true, hasArchiveIndex: false });
    expect(headline).toContain("- `archive/` — 物理目录（尚无 README 入口）");
    expect(headline).not.toContain("(archive/README.md)");

    const absent = renderRootNavBlock(INPUT);
    expect(absent).not.toContain("archive");
  });
});

describe("projects navigation", () => {
  test("splits active and archived and lists unregistered directories as gaps", () => {
    const block = renderProjectsNavBlock(INPUT);
    expect(block.startsWith(NAV_PROJECTS_BLOCK_START)).toBe(true);
    expect(block).toContain("## 活跃项目");
    expect(block).toContain("[acme](acme/index.md) — `project:acme`");
    expect(block).toContain("## 已结束项目");
    expect(block).toContain("[beta](beta/index.md) — `project:beta`");
    expect(block).toContain("## 待补归属");
    expect(block).toContain("- `projects/stray/` — 未登记为项目");
    expect(block.endsWith(NAV_PROJECTS_BLOCK_END)).toBe(true);
  });

  test("links are relative to projects/README.md", () => {
    const block = renderProjectsNavBlock(INPUT);
    expect(block).not.toContain("](projects/");
  });

  test("sorts by UTF-8 bytes, independent of locale", () => {
    const block = renderProjectsNavBlock({
      projects: [
        { id: "B", status: "active", assetRelPath: "projects/B", hasIndex: true },
        { id: "a", status: "active", assetRelPath: "projects/a", hasIndex: true },
        { id: "中", status: "active", assetRelPath: "projects/中", hasIndex: true },
      ],
      areas: [],
      unregistered: [],
    });
    // UTF-8 bytes put ASCII uppercase before lowercase, and both before CJK.
    const labels = ["[B]", "[a]", "[中]"].map((name) => block.indexOf(name));
    expect(labels.every((index) => index >= 0)).toBe(true);
    expect(labels).toEqual([...labels].sort((a, b) => a - b));
  });

  test("escapes parentheses and spaces in targets", () => {
    const block = renderProjectsNavBlock({
      projects: [
        {
          id: "space",
          status: "active",
          assetRelPath: "projects/a b",
          hasIndex: true,
        },
      ],
      areas: [],
      unregistered: ["projects/par(en)"],
    });
    expect(block).toContain("[space](a%20b/index.md)");
    expect(block).toContain("`projects/par(en)/`");
  });
});

describe("scale scenario", () => {
  test("72 projects with 60 archived: the daily entry shows 12 and all history stays reachable", () => {
    const projects = Array.from({ length: 72 }, (_, index) => ({
      id: `p${String(index + 1).padStart(2, "0")}`,
      status: index < 12 ? "active" : "archived",
      assetRelPath: `projects/p${String(index + 1).padStart(2, "0")}`,
      hasIndex: true,
    }));
    const input: NavInput = { projects, areas: [], unregistered: [] };
    const rootBlock = renderRootNavBlock(input);
    expect(rootBlock.match(/\]\(projects\/p\d+\/index\.md\)/g)).toHaveLength(12);
    for (const project of projects.slice(12)) {
      expect(rootBlock).not.toContain(`[${project.id}]`);
    }
    expect(rootBlock).toContain("[全部项目（活跃 / 已结束）](projects/README.md)");

    const full = renderProjectsNavBlock(input);
    for (const project of projects) {
      expect(full).toContain(`[${project.id}](`);
    }
    expect(full.match(/\]\(p\d+\/index\.md\)/g)).toHaveLength(72);
  });
});
