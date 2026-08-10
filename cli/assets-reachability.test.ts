// cli/assets-reachability.test.ts — materialized workbench reference reachability
// (skill-target reachability) + manifest/bundle consistency (harness-config global scope).
// Scans every bundled .md that materializes into the workbench
// (templates/workbench/* + skills/**), resolves bundle-internal references
// (skills/…, references/…, scripts/…) and rejects dead repo-docs references.
// Lifecycle-matrix / bootstrap-safety wording checks live in
// cli/lifecycle-and-safety.test.ts (lifecycle-matrix / bootstrap-safety wording).
// Run: bun test cli/assets-reachability.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { ASSETS } from "./assets.generated.ts";
import { SKILLS_MANIFEST } from "./skills.generated.ts";

/** Bundled .md files that land in the workbench (filehub is on-demand). */
function workbenchMds(): Array<[string, string]> {
  return Object.entries(ASSETS).filter(([key]) => {
    if (!key.endsWith(".md")) return false;
    if (key.startsWith("templates/filehub/")) return false;
    return key.startsWith("templates/workbench/") || key.startsWith("skills/");
  });
}

/** Extract backtick paths and markdown link targets from an md body. */
function refsOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) out.push(m[1]);
  return out;
}

function resolve(key: string, ref: string): string | null {
  const clean = ref.split("#")[0].split("?")[0].trim().replace(/\/$/, "");
  if (!clean) return null;
  // <placeholder> patterns (e.g. skills/<jspace-skill>/) are not real paths
  if (clean.includes("<") || clean.includes(">")) return null;
  // Workbench materialized skills: `.jspace/skills/<name>/…` maps to the
  // bundled `skills/<name>/…` (same bytes after init/upgrade).
  if (clean.startsWith(".jspace/skills/")) return clean.replace(/^\.jspace\//, "");
  if (clean.startsWith("skills/")) return clean; // repo/workbench-relative
  // `references/X` and `scripts/X` are relative to the SKILL ROOT, not to the
  // referencing file's directory (e.g. skills/memory-recall/references/discipline.md
  // references `references/memory-acceptance.md`).
  if (key.startsWith("skills/")) {
    const skillRoot = key.split("/").slice(0, 2).join("/"); // skills/<name>
    if (clean.startsWith("references/") || clean.startsWith("scripts/")) return `${skillRoot}/${clean}`;
    // Cross-skill references `../<skill>/...` (references/x.md or SKILL.md) are
    // relative to the REFERENCING skill's root (matches check-skills C1), so
    // skills/memory-writeback/references/writeback.md -> `../jspace-use/references/gbrain.md`
    // resolves to skills/jspace-use/references/gbrain.md. `../SKILL.md` (parent
    // skill from a references/ file) is a different, file-dir-relative ref and is
    // intentionally left out of scope here.
    if (clean.startsWith("../")) {
      const m = clean.match(/^\.\.\/([\w-]+)(\/.*)?$/);
      if (!m) return null;
      const target = posix.normalize(`${skillRoot}/${clean}`);
      return target.startsWith("skills/") ? target : null; // never escape the skills tree
    }
  }
  // templates/workbench/* — a bare `references/…` is a template-ROOT-relative
  // link (e.g. AGENTS.md -> `references/registry.md`). The workbench template
  // ships no references/ dir, so such a link is dead unless a bundled file at
  // templates/workbench/references/… actually exists. Note: bare `scripts/…`
  // refs are prose mentions of the dev-repo generator (scripts/gen-assets.ts),
  // not paths, and are intentionally not checked here.
  if (key.startsWith("templates/workbench/") && clean.startsWith("references/")) {
    return `${key.split("/").slice(0, 2).join("/")}/${clean}`;
  }
  return null; // not a bundle-internal reference
}

test("every manifest workbench skill is bundled", () => {
  for (const s of SKILLS_MANIFEST.workbench) {
    expect(ASSETS[`skills/${s.name}/SKILL.md`], `missing bundled skill: ${s.name}`).toBeDefined();
  }
});

test("harness-config stays machine-global (not bundled, install_source declared)", () => {
  const names = new Set(SKILLS_MANIFEST.workbench.map((s) => s.name));
  expect(names.has("harness-config"), "harness-config must not be a workbench skill").toBe(false);
  expect(
    Object.keys(ASSETS).some((k) => k.startsWith("skills/harness-config/")),
    "harness-config must not be embedded in the bundle",
  ).toBe(false);
  const global = SKILLS_MANIFEST.global.find((s) => s.name === "harness-config");
  expect(global, "harness-config must be declared in manifest.global").toBeDefined();
  expect(global?.install_source).toBeTruthy();
});

test("bundle-internal references resolve to an embedded file or dir", () => {
  const failures: string[] = [];
  for (const [key, body] of workbenchMds()) {
    for (const ref of refsOf(body)) {
      const target = resolve(key, ref);
      if (target === null) continue;
      const exists =
        ASSETS[target] !== undefined ||
        Object.keys(ASSETS).some((k) => k.startsWith(`${target}/`)); // dir prefix
      if (!exists) failures.push(`${key}: unresolved ref \`${ref}\``);
    }
  }
  expect(failures).toEqual([]);
});

test("workbench templates never reference a bare references/… file (dead-link regression)", () => {
  // P0-3: AGENTS.md used to link `references/registry.md` / `references/gbrain.md`,
  // which do not exist in the template root (skills references live under
  // .jspace/skills/<skill>/references/). A bare references/… in a workbench
  // template must resolve to a bundled templates/workbench/references/… file —
  // there is none, so any occurrence fails loudly.
  const bad: string[] = [];
  for (const [key, body] of workbenchMds()) {
    if (!key.startsWith("templates/workbench/")) continue;
    for (const ref of refsOf(body)) {
      if (!/^references\//.test(ref.split("#")[0].trim())) continue;
      bad.push(`${key}: bare references/ link \`${ref}\``);
    }
  }
  expect(bad).toEqual([]);
});

test("migrated repo docs are not referenced from the materialized tree", () => {
  for (const [key, body] of workbenchMds()) {
    expect(body.includes("docs/MEMORY-ACCEPTANCE.md"), `${key} still references migrated doc`).toBe(false);
    expect(body.includes("docs/HEADLESS-OPS.md"), `${key} still references migrated doc`).toBe(false);
  }
});

test("docs/ references are external-only (explicit owner marker)", () => {
  const bad: string[] = [];
  for (const [key, body] of workbenchMds()) {
    for (const ref of refsOf(body)) {
      if (!ref.startsWith("docs/")) continue;
      const line = body.split("\n").find((l) => l.includes(ref)) ?? "";
      if (!/来源:|external|外部|官方|http/i.test(line)) {
        bad.push(`${key}: non-external docs ref \`${ref}\``);
      }
    }
  }
  expect(bad).toEqual([]);
});

test("inbox batch log path is unified: skill writes, cron reads the same file (RE4)", () => {
  const expected = ".jspace-logs/inbox-batch.md";
  // writer: asset-ingest skill (bundled md)
  for (const key of ["skills/asset-ingest/SKILL.md", "skills/asset-ingest/references/batch.md"]) {
    expect(ASSETS[key], `${key} must exist`).toBeDefined();
    expect(ASSETS[key], `${key} must reference the batch log`).toContain(expected);
  }
  // reader: cron batch guard in execute.ts (source)
  const src = readFileSync(new URL("../application/automation/execute.ts", import.meta.url), "utf-8");
  expect(src).toContain("inbox-batch.md");
  expect(src).toContain(".jspace-logs");
});
