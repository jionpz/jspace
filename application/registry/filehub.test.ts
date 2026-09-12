// application/registry/filehub.test.ts — `jspace filehub init` / `upgrade` use
// cases (zero coverage before the review). Real initWorkbench workbench +
// injected FilehubDeps; skeleton/README/dry-run/register + the managed-block
// upgrade algorithm (insert/replace/no-op/dry-run/malformed/symlink).
// Run: bun test application/registry/filehub.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { loadHub, loadLocal } from "../workspace/state.ts";
import { devRoot, expandTilde, filehubReadme as embeddedFilehubReadme, isCompiled, materializeTree } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import {
  FILEHUB_CONTRACT_VERSION,
  extractFilehubContractBlock,
  filehubInit,
  inspectFilehubContractBlock,
  filehubUpgrade,
  parseFilehubContractVersion,
  replaceFilehubContractBlock,
} from "./filehub.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };

/** Minimal stand-in for templates/filehub/README.md: versioned block + user-ish
 *  text outside it. The real embedded template is asserted separately. */
const README_V2 = [
  "# 文件管理中心 (Filehub)",
  "",
  "<!-- JSPACE:FILEHUB:START -->",
  `> filehub-contract-version: ${FILEHUB_CONTRACT_VERSION}`,
  "",
  "契约正文 v2:目录表达归属,类型只做元数据。",
  "<!-- JSPACE:FILEHUB:END -->",
  "",
  "块外说明",
  "",
].join("\n");
const filehubReadme = () => README_V2;
const fhDeps = (wbRoot: string) => ({ resolvePath, expandTilde, filehubReadme, devRoot, wbRoot });

let wb: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-filehub-"));
  initWorkbench(wb, false, initDeps);
});
afterEach(() => {
  rmSync(wb, { recursive: true, force: true });
});

test("init creates skeleton + README (only when missing); re-run is a no-op", () => {
  const fh = join(wb, "filehub");
  const r1 = filehubInit(fh, false, undefined, fhDeps(wb), false);
  expect(r1.lines[0]).toContain("initialized filehub");
  for (const d of ["_inbox", "projects", "areas", "archive"]) {
    expect(existsSync(join(fh, d))).toBe(true);
  }
  expect(existsSync(join(fh, "README.md"))).toBe(true);
  const r2 = filehubInit(fh, false, undefined, fhDeps(wb), false);
  expect(r2.lines[0]).toContain("already initialized"); // README not overwritten
});

test("dry-run writes nothing", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, false, undefined, fhDeps(wb), true);
  expect(r.lines.some((l) => l.includes("would initialize"))).toBe(true);
  expect(existsSync(fh)).toBe(false);
});

test("register with new domain creates domain skeleton + hub resource + local binding", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, true, "files", fhDeps(wb), false);
  expect(r.lines.some((l) => l.includes("created domain: files"))).toBe(true);
  expect(r.lines.some((l) => l.includes("registered filehub resource"))).toBe(true);
  const hub = loadHub(wb);
  expect(hub.resources.some((res) => res.type === "filehub")).toBe(true);
  expect(loadLocal(wb)?.bindings["filehub-path"]).toBe(resolvePath(fh)); // resolvePath realpaths /var -> /private/var on macOS
  expect(existsSync(join(wb, "workspace", "files"))).toBe(true);
});

test("register dry-run reports plan without writing", () => {
  const fh = join(wb, "filehub");
  const r = filehubInit(fh, true, "files", fhDeps(wb), true);
  expect(r.lines.some((l) => l.includes("would create domain: files"))).toBe(true);
  expect(r.lines.some((l) => l.includes("would register filehub resource"))).toBe(true);
  expect(loadHub(wb).resources).toHaveLength(0);
});

// ---- embedded template: the shipped README is the SSOT for the contract ----

test("embedded README carries a current JSPACE:FILEHUB contract block", () => {
  const content = embeddedFilehubReadme();
  const block = extractFilehubContractBlock(content);
  expect(block).not.toBeNull();
  expect(parseFilehubContractVersion(block!)).toBe(FILEHUB_CONTRACT_VERSION);
});

test("embedded contract keeps types as metadata and forbids format directories", () => {
  const block = extractFilehubContractBlock(embeddedFilehubReadme());
  expect(block).not.toBeNull();
  expect(block!).toContain("layout: flat | workstream | period");
  expect(block!).toContain("类型只做元数据");
  expect(block!).toMatch(/禁止.*docs/);
  // no recommendation of the legacy vocabulary as an archive target
  expect(block!).not.toMatch(/推荐.*(docs|decks|data|notes)\//);
});

// ---- `jspace filehub upgrade` ----

test("upgrade creates the README when missing (contract-bearing template)", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const r = filehubUpgrade(fh, fhDeps(wb), false);
  expect(r.lines.join("\n")).toContain("create-readme");
  expect(readFileSync(join(fh, "README.md"), "utf-8")).toBe(README_V2);
});

test("upgrade inserts the block at the top and preserves user text byte-for-byte", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const user = "# 我的文件中心\n\n我自己的说明。\n";
  writeFileSync(join(fh, "README.md"), user);

  const r = filehubUpgrade(fh, fhDeps(wb), false);
  expect(r.lines.join("\n")).toContain("create-block");
  const after = readFileSync(join(fh, "README.md"), "utf-8");
  expect(after.startsWith("<!-- JSPACE:FILEHUB:START -->")).toBe(true);
  expect(after.endsWith(user)).toBe(true);
  expect(parseFilehubContractVersion(extractFilehubContractBlock(after)!)).toBe(FILEHUB_CONTRACT_VERSION);
});

test("upgrade replaces only an outdated block; text before/after is preserved", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const before = "# 用户标题\n\n";
  const after = "\n\n# 用户结尾\n";
  const oldBlock = "<!-- JSPACE:FILEHUB:START -->\n> filehub-contract-version: 1\n\n旧契约\n<!-- JSPACE:FILEHUB:END -->";
  writeFileSync(join(fh, "README.md"), `${before}${oldBlock}${after}`);

  const r = filehubUpgrade(fh, fhDeps(wb), false);
  expect(r.lines.join("\n")).toContain("update-block");
  const content = readFileSync(join(fh, "README.md"), "utf-8");
  expect(content.startsWith(before)).toBe(true);
  expect(content.endsWith(after)).toBe(true);
  expect(parseFilehubContractVersion(extractFilehubContractBlock(content)!)).toBe(FILEHUB_CONTRACT_VERSION);
  expect(content).not.toContain("旧契约");
});

test("upgrade is idempotent: second run is a no-op with identical bytes", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  writeFileSync(join(fh, "README.md"), "# 用户说明\n");
  filehubUpgrade(fh, fhDeps(wb), false);
  const first = readFileSync(join(fh, "README.md"), "utf-8");

  const r = filehubUpgrade(fh, fhDeps(wb), false);
  expect(r.lines.join("\n")).toContain("no-op");
  expect(readFileSync(join(fh, "README.md"), "utf-8")).toBe(first);
});

test("upgrade --dry-run reports the action and writes nothing", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const user = "# 用户说明\n";
  writeFileSync(join(fh, "README.md"), user);

  const r = filehubUpgrade(fh, fhDeps(wb), true);
  expect(r.lines.join("\n")).toContain("would create-block");
  expect(r.lines.join("\n")).toContain("dry-run");
  expect(readFileSync(join(fh, "README.md"), "utf-8")).toBe(user);
});

test("upgrade refuses a malformed marker block and leaves the file unchanged", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const damaged = "# 标题\n\n<!-- JSPACE:FILEHUB:START -->\n契约没闭合\n";
  writeFileSync(join(fh, "README.md"), damaged);

  expect(() => filehubUpgrade(fh, fhDeps(wb), false)).toThrow(/malformed/);
  expect(readFileSync(join(fh, "README.md"), "utf-8")).toBe(damaged);
});

test("upgrade refuses a symlinked README and leaves the link target unchanged", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const target = join(wb, "outside-readme.md");
  writeFileSync(target, "# 外部文件\n");
  symlinkSync(target, join(fh, "README.md"));

  expect(() => filehubUpgrade(fh, fhDeps(wb), false)).toThrow(/symlinked/);
  expect(readFileSync(target, "utf-8")).toBe("# 外部文件\n");
});

test("upgrade refuses a DANGLING README symlink instead of replacing the link", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const target = join(wb, "never-created.md");
  symlinkSync(target, join(fh, "README.md"));

  expect(() => filehubUpgrade(fh, fhDeps(wb), false)).toThrow(/symlinked/);
  expect(lstatSync(join(fh, "README.md")).isSymbolicLink()).toBe(true);
  expect(existsSync(target)).toBe(false);
});

test("upgrade --dry-run refuses a dangling README symlink too", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  symlinkSync(join(wb, "never-created.md"), join(fh, "README.md"));

  expect(() => filehubUpgrade(fh, fhDeps(wb), true)).toThrow(/symlinked/);
  expect(lstatSync(join(fh, "README.md")).isSymbolicLink()).toBe(true);
});

test("upgrade refuses a non-UTF-8 README and leaves every byte untouched", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const raw = Buffer.concat([Buffer.from("# 用户说明\n", "utf-8"), Buffer.from([0xff, 0xfe, 0x00])]);
  writeFileSync(join(fh, "README.md"), raw);

  expect(() => filehubUpgrade(fh, fhDeps(wb), false)).toThrow(/UTF-8/);
  expect(readFileSync(join(fh, "README.md")).equals(raw)).toBe(true);
});

test("upgrade keeps a UTF-8 BOM at byte offset zero", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  writeFileSync(join(fh, "README.md"), "\uFEFF# 用户说明\n", "utf-8");

  filehubUpgrade(fh, fhDeps(wb), false);
  const out = readFileSync(join(fh, "README.md"));
  expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(out.toString("utf-8")).toContain("# 用户说明");
  expect(filehubUpgrade(fh, fhDeps(wb), false).lines.join("\n")).toContain("no-op");
});

test("upgrade inserts the block AFTER YAML frontmatter, not above it", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  writeFileSync(join(fh, "README.md"), "---\ntags: [filehub]\n---\n# 用户说明\n");

  filehubUpgrade(fh, fhDeps(wb), false);
  const out = readFileSync(join(fh, "README.md"), "utf-8");
  expect(out.startsWith("---\ntags: [filehub]\n---\n")).toBe(true);
  expect(out.indexOf("JSPACE:FILEHUB:START")).toBeGreaterThan(out.indexOf("tags: [filehub]"));
  expect(filehubUpgrade(fh, fhDeps(wb), false).lines.join("\n")).toContain("no-op");
});

test("upgrade refuses a read-only README instead of silently replacing it", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const p = join(fh, "README.md");
  writeFileSync(p, "# 用户说明\n");
  chmodSync(p, 0o444);
  try {
    expect(() => filehubUpgrade(fh, fhDeps(wb), false)).toThrow(/not writable/);
    expect(readFileSync(p, "utf-8")).toBe("# 用户说明\n");
  } finally {
    chmodSync(p, 0o644);
  }
});

test("upgrade preserves a restrictive mode (0600 README stays private)", () => {
  const fh = join(wb, "filehub");
  mkdirSync(fh, { recursive: true });
  const p = join(fh, "README.md");
  writeFileSync(p, "# 用户说明\n");
  chmodSync(p, 0o600);

  filehubUpgrade(fh, fhDeps(wb), false);
  expect(statSync(p).mode & 0o777).toBe(0o600);
});

test("an inline marker mention is not mistaken for a managed block", () => {
  const inline = "# 用户说明\n\n写法见 <!-- JSPACE:FILEHUB:START --> 一节\n";
  expect(inspectFilehubContractBlock(inline).kind).toBe("none");
  const out = replaceFilehubContractBlock(inline, extractFilehubContractBlock(README_V2)!);
  expect(out.startsWith("<!-- JSPACE:FILEHUB:START -->")).toBe(true);
  expect(out).toContain("写法见 <!-- JSPACE:FILEHUB:START --> 一节");
});

test("upgrade resolves the registered filehub when no path is given", () => {
  const fh = join(wb, "filehub");
  filehubInit(fh, true, "files", fhDeps(wb), false);
  const r = filehubUpgrade(undefined, fhDeps(wb), true);
  expect(r.lines.join("\n")).toContain(resolvePath(fh));
  expect(r.lines.join("\n")).toContain("no-op"); // init already wrote the current block
});

test("upgrade without a path and no registered filehub fails with a hint", () => {
  expect(() => filehubUpgrade(undefined, fhDeps(wb), false)).toThrow(/no registered filehub/);
  expect(() => filehubUpgrade(undefined, fhDeps(wb), false)).toThrow(/filehub init <path> --register/);
});

// ---- pure block helpers ----

test("block helpers: no markers -> null/insert; single/duplicate/out-of-order markers -> throw", () => {
  expect(extractFilehubContractBlock("no markers here")).toBeNull();
  expect(() => extractFilehubContractBlock("<!-- JSPACE:FILEHUB:START -->\nx")).toThrow(/malformed/);
  expect(() => extractFilehubContractBlock("x\n<!-- JSPACE:FILEHUB:END -->")).toThrow(/malformed/);
  expect(() =>
    extractFilehubContractBlock("<!-- JSPACE:FILEHUB:END -->\nx\n<!-- JSPACE:FILEHUB:START -->"),
  ).toThrow(/malformed/);
  expect(() =>
    extractFilehubContractBlock(
      "<!-- JSPACE:FILEHUB:START -->\na\n<!-- JSPACE:FILEHUB:START -->\nb\n<!-- JSPACE:FILEHUB:END -->",
    ),
  ).toThrow(/malformed/);
  expect(() =>
    replaceFilehubContractBlock("<!-- JSPACE:FILEHUB:START -->\nonly start", "NEW"),
  ).toThrow(/malformed/);
});

test("replace inserts at the top when no block, and preserves text outside CRLF markers", () => {
  const inserted = replaceFilehubContractBlock("# 用户标题\n", "<!-- JSPACE:FILEHUB:START -->\nNEW\n<!-- JSPACE:FILEHUB:END -->");
  expect(inserted.startsWith("<!-- JSPACE:FILEHUB:START -->\nNEW\n<!-- JSPACE:FILEHUB:END -->\n\n# 用户标题\n")).toBe(true);

  const crlf = "# 头部\r\n<!-- JSPACE:FILEHUB:START -->\r\nOLD\r\n<!-- JSPACE:FILEHUB:END -->\r\n# 尾部\r\n";
  const out = replaceFilehubContractBlock(crlf, "<!-- JSPACE:FILEHUB:START -->\nNEW\n<!-- JSPACE:FILEHUB:END -->");
  expect(out.startsWith("# 头部\r\n")).toBe(true);
  expect(out.endsWith("\r\n# 尾部\r\n")).toBe(true);
  expect(out).toContain("\nNEW\n");
  expect(out).not.toContain("OLD");
});

test("replace works when the block sits in the middle of the document", () => {
  const content = "# 前\n\n<!-- JSPACE:FILEHUB:START -->\nOLD\n<!-- JSPACE:FILEHUB:END -->\n\n# 后\n";
  const out = replaceFilehubContractBlock(content, "<!-- JSPACE:FILEHUB:START -->\nNEW\n<!-- JSPACE:FILEHUB:END -->");
  expect(out).toBe("# 前\n\n<!-- JSPACE:FILEHUB:START -->\nNEW\n<!-- JSPACE:FILEHUB:END -->\n\n# 后\n");
});

test("parseFilehubContractVersion reads the version line, null when absent/not numeric", () => {
  expect(parseFilehubContractVersion("> filehub-contract-version: 2")).toBe(2);
  expect(parseFilehubContractVersion(">  filehub-contract-version: 10  ")).toBe(10);
  expect(parseFilehubContractVersion("no version line")).toBeNull();
  expect(parseFilehubContractVersion("> filehub-contract-version: v2")).toBeNull();
});

// ---- anti-drift: the shipped skill text follows the same contract ----

test("asset-ingest filing reference has no format-dir path targets", () => {
  const text = readFileSync(join(devRoot(), "skills/asset-ingest/references/filing.md"), "utf-8");
  expect(text).toContain("layout");
  for (const legacy of ["docs/", "decks/", "data/", "notes/"]) {
    expect(text).not.toContain(`\`${legacy}\``);
  }
});

test("migration runbook covers per-file rollback + gbrain pointer updates", () => {
  const text = readFileSync(join(devRoot(), "skills/asset-ingest/references/migration.md"), "utf-8");
  for (const needle of ["Pointer", "rel_path", "回滚", "读回", "用户"]) {
    expect(text).toContain(needle);
  }
  expect(text).toMatch(/不自动批处理|禁止无确认批量/);
});
