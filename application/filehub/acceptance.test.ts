// application/filehub/acceptance.test.ts — de-sensitized behavior acceptance.
//
// This file holds the mechanical half of the acceptance protocol: twelve
// anonymized cases with frozen answers, evaluated twice through the documented
// ownership order, and a link-only navigation walker limited to three hops.
// It is NOT an independent-agent trial: the same rules and the same process
// produce both ownership passes, so the "two independent judgments" result is a
// consistency check, not two human users or two unrelated models. The task
// record states that limitation explicitly.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { filehubRefresh } from "./refresh.ts";
import { scanBundleTree } from "./bundle.ts";
import { prepareBundlePlan } from "../ingest/bundle.ts";
import { filehubUpgrade } from "../registry/filehub.ts";
import { filehubReadme } from "../../cli/embed.ts";

const MONDAY = "2026-10-12";

// ---------------------------------------------------------------------------
// Ownership (AC1): frozen answers, two passes over the documented order.
// ---------------------------------------------------------------------------

type Owner =
  | `project:${string}`
  | `area:${string}`
  | "archive"
  | "unresolved";

interface Decision {
  owner: Owner;
  action: "file" | "reference" | "keep";
  gap?: string;
}

interface OwnershipFacts {
  id: string;
  servesProject?: string;
  sharedOrLongTerm?: boolean;
  area?: string;
  closedCold?: boolean;
  hasUsageEvidence: boolean;
  existingAuthority?: "local" | "external";
  locationUnknown?: boolean;
}

/** The order from asset-ingest/references/filing.md: evidence first, then
 *  servicing-project, then shared/long-term area, then cold archive; anything
 *  without enough evidence stays in the inbox. */
function decideOwnership(facts: OwnershipFacts): Decision {
  if (!facts.hasUsageEvidence) {
    return { owner: "unresolved", action: "keep", gap: "用途、所属工作或最终版本证据不足" };
  }
  if (facts.closedCold === true) return { owner: "archive", action: "file" };
  if (facts.servesProject !== undefined) {
    return {
      owner: `project:${facts.servesProject}`,
      action: facts.existingAuthority === "external" ? "reference" : facts.existingAuthority === "local" ? "reference" : "file",
    };
  }
  if (facts.sharedOrLongTerm === true && facts.area !== undefined) {
    return {
      owner: `area:${facts.area}`,
      action: facts.locationUnknown === true ? "reference" : "file",
      ...(facts.locationUnknown === true ? { gap: "本体位置未确认，不把清单当成本体" } : {}),
    };
  }
  return { owner: "unresolved", action: "keep", gap: "无法确定唯一 owner" };
}

// Cases A-L of research/real-cases.md, de-sensitized. The answers were frozen
// before this test was written; the facts below only feed the rule order.
const OWNERSHIP_FACTS: readonly OwnershipFacts[] = [
  { id: "A-suite-entry", servesProject: "p-00", hasUsageEvidence: true, existingAuthority: "local" },
  { id: "B-research-report", servesProject: "p-00", hasUsageEvidence: true },
  { id: "C-screenshot-evidence", servesProject: "p-00", hasUsageEvidence: true },
  { id: "D-practice-bank", servesProject: "p-00", hasUsageEvidence: true },
  { id: "E-external-repo", servesProject: "p-01", hasUsageEvidence: true, existingAuthority: "external" },
  { id: "F-weekly-report", sharedOrLongTerm: true, area: "周报", hasUsageEvidence: true },
  { id: "G-learning-notes", sharedOrLongTerm: true, area: "learning", hasUsageEvidence: true },
  { id: "H-media-collection", sharedOrLongTerm: true, area: "media", hasUsageEvidence: true, locationUnknown: true },
  { id: "I-closed-work-set", closedCold: true, hasUsageEvidence: true },
  { id: "J-config-list", hasUsageEvidence: false },
  { id: "K-helper-script", hasUsageEvidence: false },
  { id: "L-html-demo", hasUsageEvidence: false },
];

const OWNERSHIP_ANSWERS: Readonly<Record<string, Decision>> = {
  "A-suite-entry": { owner: "project:p-00", action: "reference" },
  "B-research-report": { owner: "project:p-00", action: "file" },
  "C-screenshot-evidence": { owner: "project:p-00", action: "file" },
  "D-practice-bank": { owner: "project:p-00", action: "file" },
  "E-external-repo": { owner: "project:p-01", action: "reference" },
  "F-weekly-report": { owner: "area:周报", action: "file" },
  "G-learning-notes": { owner: "area:learning", action: "file" },
  "H-media-collection": {
    owner: "area:media",
    action: "reference",
    gap: "本体位置未确认，不把清单当成本体",
  },
  "I-closed-work-set": { owner: "archive", action: "file" },
  "J-config-list": { owner: "unresolved", action: "keep", gap: "用途、所属工作或最终版本证据不足" },
  "K-helper-script": { owner: "unresolved", action: "keep", gap: "用途、所属工作或最终版本证据不足" },
  "L-html-demo": { owner: "unresolved", action: "keep", gap: "用途、所属工作或最终版本证据不足" },
};

function runOwnershipPass(facts: readonly OwnershipFacts[]): Map<string, Decision> {
  return new Map(facts.map((entry) => [entry.id, decideOwnership(entry)]));
}

test("ownership: two fresh passes agree with each other and with the frozen answers", () => {
  const first = runOwnershipPass(OWNERSHIP_FACTS);
  const second = runOwnershipPass([...OWNERSHIP_FACTS].reverse());

  expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  for (const [id, expected] of Object.entries(OWNERSHIP_ANSWERS)) {
    expect(first.get(id)).toEqual(expected);
  }
  // Ambiguous cases never auto-file: they keep the source and report the gap.
  for (const [id, decision] of first) {
    if (decision.owner === "unresolved") {
      expect(decision.action).toBe("keep");
      expect(decision.gap).toBeTruthy();
      expect(OWNERSHIP_ANSWERS[id]!.action).toBe("keep");
    }
  }
  // Nine resolved + three unresolved: the resolved ratio is reported, not hidden.
  const resolved = [...first.values()].filter((decision) => decision.owner !== "unresolved").length;
  expect(resolved).toBe(9);
});

// ---------------------------------------------------------------------------
// Navigation (AC2/AC10): synthetic filehub, link-only walker, at most 3 hops.
// ---------------------------------------------------------------------------

interface NavCase {
  id: string;
  question: string;
  /** Filehub-relative target, or the evidence page for a correct-unknown case. */
  target: string;
  /** A phrase the reached target must actually contain. */
  evidence: string;
  verdict: "located" | "unknown";
}

const NAV_CASES: readonly NavCase[] = [
  {
    id: "A-suite-entry",
    question: "套件从哪里开始读？",
    target: "projects/p-00/index.md",
    evidence: "套件入口",
    verdict: "located",
  },
  {
    id: "B-research-report",
    question: "调研报告在哪里？",
    target: "projects/p-00/report.html",
    evidence: "调研报告",
    verdict: "located",
  },
  {
    id: "C-screenshot-evidence",
    question: "界面证据集在哪里？",
    target: "projects/p-00/evidence/README.md",
    evidence: "证据集",
    verdict: "located",
  },
  {
    id: "D-practice-bank",
    question: "带答案的练习题库在哪里？",
    target: "projects/p-00/notes/practice.md",
    evidence: "题库",
    verdict: "located",
  },
  {
    id: "E-external-repo",
    question: "外部仓库的架构文档在哪里？",
    target: "projects/p-01/index.md",
    evidence: "外部仓库",
    verdict: "located",
  },
  {
    id: "F-weekly-report",
    question: "10 月 12 日那周做了什么？",
    target: `areas/周报/${MONDAY}-周报.md`,
    evidence: "第 41 周",
    verdict: "located",
  },
  {
    id: "G-learning-notes",
    question: "机器学习第二章笔记在哪里？",
    target: "areas/learning/notes/chapter-2.md",
    evidence: "第二章",
    verdict: "located",
  },
  {
    id: "I-closed-work-set",
    question: "那次已结束的换底图工作最终稿在哪？",
    target: "projects/p-12/index.md",
    evidence: "最终稿未确认",
    verdict: "unknown",
  },
  {
    id: "H-media-collection",
    question: "收藏视频的本体在哪里？",
    target: "areas/media/index.md",
    evidence: "位置未确认",
    verdict: "unknown",
  },
  {
    id: "J-config-list",
    question: "之前那份配置修复清单在哪？",
    target: "archive/README.md",
    evidence: "未登记",
    verdict: "unknown",
  },
  {
    id: "K-helper-script",
    question: "算 bbox 的小脚本在哪？",
    target: "archive/README.md",
    evidence: "未登记",
    verdict: "unknown",
  },
  {
    id: "L-html-demo",
    question: "那个单文件演示稿在哪？",
    target: "archive/README.md",
    evidence: "未登记",
    verdict: "unknown",
  },
];

interface Fixture {
  wb: string;
  fh: string;
}

let fixture: Fixture;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function buildFilehub(wb: string): string {
  const fh = join(wb, "filehub");
  const projects = Array.from({ length: 72 }, (_, index) => {
    const id = `p-${String(index).padStart(2, "0")}`;
    return {
      id,
      domain: "files",
      asset_rel_path: `projects/${id}`,
      status: index < 12 ? "active" : "archived",
    };
  });
  write(
    join(wb, ".jspace", "hub.json"),
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
      projects,
    }),
  );
  write(
    join(wb, ".jspace", "local.json"),
    JSON.stringify({
      schema_version: 1,
      installation_id: "acceptance",
      bindings: { "filehub-path": fh },
    }),
  );

  for (const project of projects) {
    const root = join(fh, project.asset_rel_path);
    mkdirSync(root, { recursive: true });
    write(join(root, "index.md"), `# ${project.id}\n`);
  }

  write(
    join(fh, "projects", "p-00", "index.md"),
    [
      "# p-00",
      "",
      "套件入口：先读本索引。",
      "",
      "| 文件 | 类型 | 日期 | gbrain slug |",
      "|---|---|---|---|",
      "| [report.html](report.html) | document | 2026-10-01 | `assets/p-00/report` |",
      "| [evidence/README.md](evidence/README.md) | bundle | 2026-10-02 | `assets/p-00/evidence` |",
      "| [notes/practice.md](notes/practice.md) | note | 2026-10-03 | `assets/p-00/practice` |",
      "",
    ].join("\n"),
  );
  write(join(fh, "projects", "p-00", "report.html"), "<html><body>调研报告</body></html>\n");
  write(join(fh, "projects", "p-00", "evidence", "README.md"), "# 证据集\n\n界面截图集合。\n");
  write(join(fh, "projects", "p-00", "notes", "practice.md"), "# 题库\n\n第二章练习与答案。\n");

  write(
    join(fh, "projects", "p-01", "index.md"),
    [
      "# p-01",
      "",
      "外部仓库：代码与规格在本机仓库，不在本 vault。",
      "",
      "## 引用资料",
      "<!-- JSPACE:ASSET-REFERENCES:START -->",
      "- [权限组规格](https://example.invalid/permissions)",
      "<!-- JSPACE:ASSET-REFERENCES:END -->",
      "",
    ].join("\n"),
  );

  write(
    join(fh, "projects", "p-12", "index.md"),
    [
      "# p-12",
      "",
      "最终稿未确认：目录只有过程稿与命名线索，没有权威版本声明。",
      "",
      "| 文件 | 类型 | 日期 | gbrain slug |",
      "|---|---|---|---|",
      "| [final.png](final.png) | document | 2026-09-02 | `assets/p-12/final` |",
      "",
    ].join("\n"),
  );
  write(join(fh, "projects", "p-12", "final.png"), "png-bytes");

  write(
    join(fh, "areas", "周报", "index.md"),
    [
      "# 周报",
      "",
      "| 文件 | 类型 | 日期 | gbrain slug |",
      "|---|---|---|---|",
      `| [${MONDAY}-周报.md](${MONDAY}-周报.md) | document | ${MONDAY} | \`assets/周报/${MONDAY}\` |`,
      "",
    ].join("\n"),
  );
  write(join(fh, "areas", "周报", `${MONDAY}-周报.md`), "# 第 41 周\n\n窗口与截止时刻见正文。\n");

  write(
    join(fh, "areas", "learning", "index.md"),
    [
      "# learning",
      "",
      "| 文件 | 类型 | 日期 | gbrain slug |",
      "|---|---|---|---|",
      "| [notes/chapter-2.md](notes/chapter-2.md) | note | 2026-08-03 | `assets/learning/chapter-2` |",
      "",
    ].join("\n"),
  );
  write(join(fh, "areas", "learning", "notes", "chapter-2.md"), "# 第二章\n\n长期学习笔记。\n");

  write(
    join(fh, "areas", "media", "index.md"),
    "# media\n\n收藏清单已记录，但媒体本体位置未确认，不把清单当成本体。\n",
  );
  write(join(fh, "areas", "media", "README.md"), "# media 清单\n\n未确认本体位置。\n");

  write(
    join(fh, "archive", "README.md"),
    "# 归档\n\n已结束与冷资料。未登记条目没有 owner、slug 或最终版本声明，查找时报告未知。\n",
  );
  write(join(fh, "archive", "2026", "2026-10-12-配置修复清单-v1.md"), "# 清单\n");
  write(join(fh, "archive", "2026", "2026-10-12-helper-v1.js"), "// helper\n");
  write(join(fh, "archive", "2026", "2026-10-13-demo-v1.html"), "<html></html>\n");

  write(join(fh, "README.md"), "# 文件中心\n\n用户写在受管块外的说明。\n");
  return fh;
}

const LINK_RE = /\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)/g;

function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(LINK_RE)) {
    const target = (match[1] ?? match[2] ?? "").trim();
    if (target === "") continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    out.push(target);
  }
  return out;
}

interface WalkResult {
  found: boolean;
  chain: string[];
  hops: number;
  opened: string[];
}

/** Breadth-first, link-only navigation from the root README. It never globs,
 *  searches, or reads a path not named by a link on a page it already opened. */
function walk(fh: string, targetRel: string, maxHops = 3): WalkResult {
  const rootRel = "README.md";
  const queue: Array<{ rel: string; chain: string[] }> = [{ rel: rootRel, chain: [rootRel] }];
  const seen = new Set<string>([rootRel]);
  const opened: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const depth = node.chain.length - 1;
    opened.push(node.rel);
    if (node.rel === targetRel) {
      return { found: true, chain: node.chain, hops: depth, opened };
    }
    if (depth >= maxHops) continue;
    let text: string;
    try {
      const abs = join(fh, node.rel);
      const stat = lstatSync(abs);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      // Only Markdown documents are parsed for further links.
      if (!/\.(md|markdown)$/i.test(node.rel)) continue;
      text = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    for (const raw of linksIn(text)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw.split("#")[0] ?? raw);
      } catch {
        continue;
      }
      if (decoded === "") continue;
      const abs = resolve(dirname(join(fh, node.rel)), decoded);
      const rootAbs = resolve(fh);
      if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) continue;
      const rel = relative(fh, abs).split(sep).join("/");
      if (seen.has(rel)) continue;
      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      seen.add(rel);
      queue.push({ rel, chain: [...node.chain, rel] });
    }
  }
  return { found: false, chain: [], hops: -1, opened };
}

beforeAll(() => {
  const wb = mkdtempSync(join(tmpdir(), "jspace-acceptance-"));
  fixture = { wb, fh: buildFilehub(wb) };
  const result = filehubRefresh({ wbRoot: wb }, false, true);
  expect(result.exitCode).toBeUndefined();
});

afterAll(() => {
  if (fixture !== undefined) rmSync(fixture.wb, { recursive: true, force: true });
});

test("navigation: 72 projects keep 12 active entries and all 60 archived ones reachable", () => {
  const root = readFileSync(join(fixture.fh, "README.md"), "utf-8");
  const activeSection = root.slice(root.indexOf("## 活跃项目"), root.indexOf("## 长期主题"));
  expect(activeSection.match(/\(projects\/p-\d{2}\/index\.md\)/g)).toHaveLength(12);
  expect(root).toContain("archive/README.md");

  const all = readFileSync(join(fixture.fh, "projects", "README.md"), "utf-8");
  expect(all.match(/\(p-\d{2}\/index\.md\)/g)).toHaveLength(72);
  expect(all).toContain("## 已结束项目");
});

test("navigation: every case is located or correctly unknown within three link hops", () => {
  let passed = 0;
  const report: string[] = [];
  for (const entry of NAV_CASES) {
    const result = walk(fixture.fh, entry.target, 3);
    const body = result.found
      ? readFileSync(join(fixture.fh, entry.target), "utf-8")
      : "";
    const ok = result.found && result.hops <= 3 && body.includes(entry.evidence);
    if (ok) passed += 1;
    report.push(
      `${entry.id}: ${ok ? "PASS" : "FAIL"} verdict=${entry.verdict} hops=${result.hops} ` +
        `target=${entry.target} chain=${result.chain.join(" -> ")}`,
    );
  }
  // Keep the full 12-case report visible in test output, not only the total.
  console.log(`\n[navigation acceptance]\n${report.join("\n")}`);
  expect(passed).toBeGreaterThanOrEqual(10);
  expect(passed).toBe(NAV_CASES.length);
});

test("navigation: no case fabricates a path outside the fixture or an authoritative final", () => {
  for (const entry of NAV_CASES) {
    const result = walk(fixture.fh, entry.target, 3);
    expect(result.chain.every((rel) => existsSync(join(fixture.fh, rel)))).toBe(true);
    const body = result.found ? readFileSync(join(fixture.fh, entry.target), "utf-8") : "";
    expect(body).not.toMatch(/FINAL|最终版已确认/);
  }
});

test("upgrade: the static contract block never swallows navigation or user prose", () => {
  const readmePath = join(fixture.fh, "README.md");
  const before = readFileSync(readmePath, "utf-8");
  const navStart = before.indexOf("<!-- JSPACE:FILEHUB:NAV:START -->");
  const navEnd = before.indexOf("<!-- JSPACE:FILEHUB:NAV:END -->");
  expect(navStart).toBeGreaterThan(-1);
  expect(navEnd).toBeGreaterThan(navStart);
  const navSlice = before.slice(navStart, navEnd + "<!-- JSPACE:FILEHUB:NAV:END -->".length);

  const upgraded = filehubUpgrade(
    fixture.fh,
    {
      wbRoot: fixture.wb,
      filehubReadme,
      resolvePath: (value: string) => value,
      expandTilde: (value: string) => value,
    },
    false,
  );
  expect(upgraded.exitCode).toBeUndefined();
  const after = readFileSync(readmePath, "utf-8");
  expect(after).toContain("JSPACE:FILEHUB:START");
  expect(after.slice(after.indexOf(navSlice), after.indexOf(navSlice) + navSlice.length)).toBe(navSlice);
  expect(after).toContain("用户写在受管块外的说明。");
});

test("bundle scale: a 120-file suite and a 20-image set are each one asset unit", () => {
  const base = mkdtempSync(join(tmpdir(), "jspace-acceptance-bundle-"));
  try {
    const suite = join(base, "suite");
    for (let index = 0; index < 120; index += 1) {
      const rel = index < 60 ? `src/module-${index}.ts` : `docs/chapter-${index}.md`;
      write(join(suite, rel), `member ${index}\n`);
    }
    write(join(suite, "README.md"), "# suite entry\n");

    const images = join(base, "screens");
    for (let index = 0; index < 20; index += 1) {
      write(join(images, `screen-${String(index).padStart(2, "0")}.png`), `png ${index}`);
    }
    write(join(images, "README.md"), "# screenshot set entry\n");

    // One plan each: the owner index gets one row and gbrain gets one page
    // (entry slug), never one row per member.
    const first = prepareBundlePlan({
      source: suite,
      target: join(base, "target-suite"),
      ownerRootRel: "projects/p-00",
      rootRelPath: "projects/p-00/suite",
      entry: "README.md",
      ownerKind: "project",
      ownerId: "p-00",
      slug: "assets/p-00/suite",
      indexPath: "projects/p-00/index.md",
      indexEntry: "| [suite/README.md](suite/README.md) | bundle | 2026-10-25 | `assets/p-00/suite` |",
    });
    const second = prepareBundlePlan({
      source: images,
      target: join(base, "target-screens"),
      ownerRootRel: "projects/p-00",
      rootRelPath: "projects/p-00/screens",
      entry: "README.md",
      ownerKind: "project",
      ownerId: "p-00",
      slug: "assets/p-00/screens",
      indexPath: "projects/p-00/index.md",
      indexEntry: "| [screens/README.md](screens/README.md) | bundle | 2026-10-25 | `assets/p-00/screens` |",
    });
    expect(first.journal.slug).toBe("assets/p-00/suite");
    expect(first.manifest.members.filter((member) => member.kind === "file")).toHaveLength(121);
    expect(second.manifest.members.filter((member) => member.kind === "file")).toHaveLength(21);

    const before = scanBundleTree(suite);
    if (before.state !== "ok") throw new Error(before.detail);
    write(join(suite, "docs", "chapter-61.md"), "changed\n");
    const changed = scanBundleTree(suite);
    if (changed.state !== "ok") throw new Error(changed.detail);
    expect(changed.aggregateSha256).not.toBe(before.aggregateSha256);

    rmSync(join(suite, "src", "module-3.ts"));
    const removed = scanBundleTree(suite);
    if (removed.state !== "ok") throw new Error(removed.detail);
    expect(removed.aggregateSha256).not.toBe(changed.aggregateSha256);

    write(join(suite, "src", "extra.ts"), "extra\n");
    const added = scanBundleTree(suite);
    if (added.state !== "ok") throw new Error(added.detail);
    expect(added.aggregateSha256).not.toBe(removed.aggregateSha256);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
