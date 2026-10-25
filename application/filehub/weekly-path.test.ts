// application/filehub/weekly-path.test.ts — the weekly-report location is
// resolved from the owner index, never invented from a run date.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWeeklyPath, weeklyFileName, weeklySlug } from "./weekly-path.ts";

const MONDAY = "2026-10-12";
let root: string;
let fh: string;
let area: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-weekly-path-"));
  fh = join(root, "filehub");
  area = join(fh, "areas", "周报");
  mkdirSync(join(root, ".jspace"), { recursive: true });
  mkdirSync(area, { recursive: true });
  writeHub(fh);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeHub(filehub: string): void {
  writeFileSync(
    join(root, ".jspace", "hub.json"),
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
      projects: [],
    }),
  );
  writeFileSync(
    join(root, ".jspace", "local.json"),
    JSON.stringify({
      schema_version: 1,
      installation_id: "i",
      bindings: { "filehub-path": filehub },
    }),
  );
}

function writeIndex(rows: string[], extra = ""): void {
  writeFileSync(
    join(area, "index.md"),
    [
      "# 周报",
      "",
      "| 文件 | 类型 | 日期 | gbrain slug |",
      "|---|---|---|---|",
      ...rows,
      extra,
      "",
    ].join("\n"),
  );
}

function row(path: string, slug = weeklySlug(MONDAY)): string {
  return `| ${path} | document | 2026-10-12 | \`${slug}\` |`;
}

function resolve() {
  return resolveWeeklyPath(root, MONDAY);
}

test("no area or index yet: default path, index not ready", () => {
  rmSync(area, { recursive: true, force: true });
  const result = resolve();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.state).toBe("default");
  expect(result.value.relPath).toBe(`areas/周报/${MONDAY}-周报.md`);
  expect(result.value.index).toMatchObject({ state: "missing", ready: false });
  expect(result.value.path).toBe(join(fh, "areas", "周报", `${MONDAY}-周报.md`));
});

test("empty ready index keeps the default root path", () => {
  writeIndex([]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("default");
  expect(result.value.index.ready).toBe(true);
  expect(result.value.relPath).toBe(`areas/周报/${MONDAY}-周报.md`);
});

test("a registered root report is reused", () => {
  const name = weeklyFileName(MONDAY);
  writeFileSync(join(area, name), "report");
  writeIndex([row(name)]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("reuse");
  expect(result.value.relPath).toBe(`areas/周报/${name}`);
  expect(result.value.candidates).toEqual([
    expect.objectContaining({ relPath: `areas/周报/${name}`, source: "file" }),
    expect.objectContaining({ relPath: `areas/周报/${name}`, source: "index", exists: true }),
  ]);
});

test("an explicitly registered year location is reused, not the default", () => {
  mkdirSync(join(area, "2026"));
  const rel = `2026/${MONDAY}-周报.md`;
  writeFileSync(join(area, "2026", `${MONDAY}-周报.md`), "report");
  writeIndex([row(rel)]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("reuse");
  expect(result.value.relPath).toBe(`areas/周报/${rel}`);
  expect(existsSync(join(area, "2026", `${MONDAY}-周报.md`))).toBe(true);
});

test("root and year copies are a conflict; no third path is offered", () => {
  const name = weeklyFileName(MONDAY);
  mkdirSync(join(area, "2026"));
  writeFileSync(join(area, name), "root");
  writeFileSync(join(area, "2026", name), "year");
  writeIndex([]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("duplicate_files");
  expect(result.value.relPath).toBeUndefined();
});

test("an existing but unregistered file is a conflict, never silently rewritten", () => {
  writeFileSync(join(area, weeklyFileName(MONDAY)), "handmade");
  writeIndex([]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("file_not_registered");
});

test("an index row whose file is missing is a conflict", () => {
  writeIndex([row(weeklyFileName(MONDAY))]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("index_path_missing");
});

test("duplicate index rows for the same week are a conflict", () => {
  const name = weeklyFileName(MONDAY);
  writeFileSync(join(area, name), "report");
  writeIndex([row(name), row(name)]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("duplicate_index_rows");
});

test("a same-named file registered under another slug is a conflict", () => {
  const name = weeklyFileName(MONDAY);
  writeFileSync(join(area, name), "report");
  writeIndex([row(name, "assets/周报/2026-10-05")]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("index_slug_mismatch");
});

test("a damaged index blocks the decision instead of falling back to the default", () => {
  writeIndex([], "<!-- JSPACE:ASSET-HISTORY:START -->\n- [old](./old.md) — `assets/周报/old`");
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("index_damaged");
});

test("a symlinked index is refused", () => {
  const outside = join(root, "outside-index.md");
  writeFileSync(outside, "# x\n");
  symlinkSync(outside, join(area, "index.md"));
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("index_damaged");
  expect(result.value.index.state).toBe("symlink");
});

test("a symlinked weekly file is not followed and is a conflict", () => {
  const outside = join(root, "outside.md");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(area, weeklyFileName(MONDAY)));
  writeIndex([]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("file_not_regular");
});

test("an index row cannot reach through a symlinked year directory", () => {
  const outsideDir = join(root, "outside-year");
  mkdirSync(outsideDir);
  writeFileSync(join(outsideDir, `${MONDAY}-周报.md`), "outside");
  symlinkSync(outsideDir, join(area, "2026"));
  writeIndex([row(`2026/${MONDAY}-周报.md`)]);
  const result = resolve();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.state).toBe("conflict");
  expect(result.value.code).toBe("index_path_missing");
});

test("week identity must be a real Monday", () => {
  const sunday = resolveWeeklyPath(root, "2026-10-11");
  expect(sunday.ok).toBe(false);
  if (!sunday.ok) expect(sunday.error).toContain("Monday");
  const impossible = resolveWeeklyPath(root, "2026-02-30");
  expect(impossible.ok).toBe(false);
});

test("an unregistered filehub is an explicit error", () => {
  rmSync(join(root, ".jspace", "hub.json"));
  const result = resolve();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("no registered filehub");
});

test("a cross-year week uses the Monday as its identity", () => {
  // 2026-12-28 is the Monday of the week containing New Year's Day 2027.
  const monday = "2026-12-28";
  const result = resolveWeeklyPath(root, monday);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.slug).toBe("assets/周报/2026-12-28");
  expect(result.value.relPath).toBe("areas/周报/2026-12-28-周报.md");
});
