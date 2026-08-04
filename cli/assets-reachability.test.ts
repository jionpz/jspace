// cli/assets-reachability.test.ts — materialized workbench reference reachability
// (RD2 / AC-D2) + manifest/bundle consistency (RD1, harness-config global scope).
// Scans every bundled .md that materializes into the workbench
// (templates/workbench/* + skills/**), resolves bundle-internal references
// (skills/…, references/…, scripts/…) and rejects dead repo-docs references.
// Lifecycle-matrix / bootstrap-safety wording checks live in
// cli/lifecycle-and-safety.test.ts (Child D M7/M8).
// Run: bun test cli/assets-reachability.test.ts
import { expect, test } from "bun:test";
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
  if (clean.startsWith("skills/")) return clean; // repo/workbench-relative
  // `references/X` and `scripts/X` are relative to the SKILL ROOT, not to the
  // referencing file's directory (e.g. skills/memory-recall/references/discipline.md
  // references `references/memory-acceptance.md`).
  if (key.startsWith("skills/")) {
    const skillRoot = key.split("/").slice(0, 2).join("/"); // skills/<name>
    if (clean.startsWith("references/") || clean.startsWith("scripts/")) return `${skillRoot}/${clean}`;
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
