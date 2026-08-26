// scripts/check-harness-consistency.ts — drift guard: every harness surface in
// code/docs/templates must agree with capabilities.yaml (the single source of
// truth). Run locally and in CI: `bun run scripts/check-harness-consistency.ts`.
// Any assertion failure exits 1 (CI red). Philosophy: over-red, never silent
// drift — a new harness added to capabilities.yaml but forgotten in a doc list
// turns red so the doc gets fixed, not silently ignored.
//
// Assertions:
//   1. harness-*.md files in skills/jspace-use/references = documented:true keys
//   2. core/contracts/cron.ts HARNESSES == capabilities cron_harness_enum_value
//      set (bidirectional); templates/workbench/.jspace/cron.json values ⊆ keys
//   3. adapters/harness/*.ts adapter filenames ⊆ capabilities keys
//   4. field-value: via_pi_mcp_adapter literal in capabilities.pi AND
//      harness-pi.md; each grok/opencode session event has a template hook/plugin
//   5. skills/jspace-use/SKILL.md reference area covers every harness-*.md
//   6. hand-written harness lists in templates/AGENTS.md + docs/PLATFORMS.md +
//      harnesses.md contain the full support set (display-name mapping)
//   7. every adapter hookFilePath points at an existing template (P2.14)
//   8. every headless-capable harness's headlessArgv prefix == capabilities
//      headless.slice(1) (P2.14; the P0 unification made this a lockable seam)
//   9. lifecycle grades match the real wiring matrix (P2.14; hardcoded
//      expectation table — a grade upgrade without wiring turns red)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAdapter } from "../adapters/harness/index.ts";
import { harnessArgv } from "../adapters/harness/argv.ts";

const ROOT = join(import.meta.dir, "..");
const REF_DIR = join(ROOT, "skills/jspace-use/references");
const caps = Bun.YAML.parse(readFileSync(join(ROOT, "adapters/harness/capabilities.yaml"), "utf-8")) as {
  harnesses: Record<
    string,
    {
      documented?: boolean;
      cron_harness_enum_value?: string | null;
      headless?: string[] | null;
      mcp?: { via?: string };
      sessions?: { name?: string; source?: string }[];
      session_start?: { path?: string; format?: string; key?: string };
      lifecycle?: { session_start?: string; session_end?: string; fallback?: string; crash_recovery?: string };
    }
  >;
};

const SUPPORT_DISPLAY_NAMES = ["Claude Code", "Grok Build", "OpenCode", "Pi", "Cursor", "Codex"];

let failures: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(`${name}: ${detail}`);
  else console.log(`  ok: ${name} — ${detail}`);
}

// ---- 1. harness-*.md files = documented:true keys --------------------------
const docFiles = readdirSync(REF_DIR).filter((f) => f.startsWith("harness-") && f.endsWith(".md"));
const documentedKeys = Object.entries(caps.harnesses).filter(([, c]) => c.documented !== false).map(([k]) => k);
const docKeys = docFiles.map((f) => f.replace(/^harness-/, "").replace(/\.md$/, ""));
const missingDocs = documentedKeys.filter((k) => !docKeys.includes(k));
const extraDocs = docKeys.filter((k) => !caps.harnesses[k]);
check(
  "1.harness-docs",
  missingDocs.length === 0 && extraDocs.length === 0,
  missingDocs.length || extraDocs.length
    ? `docs set mismatch — missing ${missingDocs.join(",") || "-"}, extra ${extraDocs.join(",") || "-"}; capabilities documented keys = ${documentedKeys.join(",")}`
    : `${docFiles.length} harness-*.md for ${documentedKeys.join(",")}`,
);

// ---- 2. cron.ts HARNESSES == capabilities cron enum (bidirectional) --------
const cronTs = readFileSync(join(ROOT, "core/contracts/cron.ts"), "utf-8");
const enumMatch = cronTs.match(/HARNESSES\s*=\s*\[([^\]]+)\]/);
if (!enumMatch) {
  check("2.cron-enum", false, "HARNESSES array not found in core/contracts/cron.ts");
} else {
  const enumKeys = enumMatch[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const capEnum = Object.values(caps.harnesses)
    .map((c) => c.cron_harness_enum_value)
    .filter((v): v is string => v !== null && v !== undefined)
    .sort();
  const sortedEnum = [...enumKeys].sort();
  check(
    "2.cron-enum",
    JSON.stringify(sortedEnum) === JSON.stringify(capEnum),
    `cron.ts HARNESSES ${sortedEnum.join(",")} vs capabilities enum ${capEnum.join(",")}`,
  );
  const cronJson = JSON.parse(readFileSync(join(ROOT, "templates/workbench/.jspace/cron.json"), "utf-8")) as {
    crons: { id?: string; harness?: string; target?: { kind?: string; skill?: string; entrypoint?: string } }[];
  };
  const cronValues = cronJson.crons.map((c) => c.harness).filter(Boolean);
  check(
    "2b.cron-json-values",
    cronValues.every((v) => v !== undefined && caps.harnesses[v] !== undefined),
    `cron.json harness values ${cronValues.join(",")} all ⊆ capabilities keys`,
  );
  // 2c: skill-target crons must reference a real workbench skill + entrypoint.
  // compileSkillTarget only validates ENABLED crons at runtime; a typo in a
  // disabled cron would otherwise ship to release undetected.
  const skillsManifest = JSON.parse(readFileSync(join(ROOT, "skills-manifest.json"), "utf-8")) as {
    workbench: { name: string; entrypoints?: string[] }[];
  };
  const entryBySkill: Record<string, string[]> = {};
  for (const s of skillsManifest.workbench) entryBySkill[s.name] = s.entrypoints ?? [];
  for (const c of cronJson.crons) {
    const t = c.target;
    if (!t || t.kind !== "skill") continue;
    const label = c.id ?? c.harness ?? "?";
    const skill = t.skill ?? "";
    const ep = t.entrypoint ?? "";
    const eps = entryBySkill[skill];
    if (eps === undefined) {
      check(`2c.cron-target.${label}`, false, `target.skill "${skill}" not in skills-manifest workbench`);
    } else if (!eps.includes(ep)) {
      check(`2c.cron-target.${label}`, false, `target.entrypoint "${ep}" not in ${skill} entrypoints [${eps.join(",")}]`);
    } else {
      check(`2c.cron-target.${label}`, true, `${skill}.${ep} valid`);
    }
  }
}

// ---- 3. adapter filenames ⊆ capabilities keys -------------------------------
const adapterFiles = readdirSync(join(ROOT, "adapters/harness")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".generated.ts"));
const adapterKeys = adapterFiles.map((f) => f.replace(/\.ts$/, "")).filter((k) => !["argv", "bin", "registry", "types", "harness", "index", "capabilities"].includes(k));
const unknownAdapters = adapterKeys.filter((k) => !caps.harnesses[k]);
const missingAdapters = Object.keys(caps.harnesses).filter((k) => !adapterKeys.includes(k));
check(
  "3.adapters",
  unknownAdapters.length === 0 && missingAdapters.length === 0,
  unknownAdapters.length || missingAdapters.length
    ? `unknown ${unknownAdapters.join(",") || "-"}, missing ${missingAdapters.join(",") || "-"}`
    : `${adapterKeys.length} adapters match capabilities keys`,
);

// ---- 4. field-value drift ------------------------------------------------
const piCapMcp = caps.harnesses.pi?.mcp?.via;
const piDoc = readFileSync(join(REF_DIR, "harness-pi.md"), "utf-8");
check("4.pi-mcp-literal", piCapMcp === "pi_mcp_adapter" && piDoc.includes("pi-mcp-adapter"), "capabilities.pi via:pi_mcp_adapter + harness-pi.md mentions pi-mcp-adapter");

// Session-event double ledger: the hand-written expectation below must match
// BOTH capabilities.yaml `sessions` AND the seed template that materializes the
// hook/plugin. Dropping an event from one side (or from both at once) turns red,
// so a lifecycle grade can never outlive its wiring (B4: claude/cursor
// session-end; evidence in docs/session-end-hooks.md).
const SEED_SESSION_EVENTS: Record<string, { seed: string; events: string[] }> = {
  claude: { seed: "templates/workbench/.claude/settings.json", events: ["SessionStart", "UserPromptSubmit", "SessionEnd"] },
  grok: { seed: "templates/workbench/.grok/hooks/jspace.json", events: ["SessionStart", "UserPromptSubmit", "PreCompact", "SessionEnd"] },
  cursor: { seed: "templates/workbench/.cursor/hooks.json", events: ["sessionStart", "sessionEnd"] },
  opencode: { seed: "templates/workbench/.opencode/plugins/jspace.ts", events: ["session.created", "session.idle", "experimental.session.compacting"] },
};
for (const [h, { seed, events }] of Object.entries(SEED_SESSION_EVENTS)) {
  const body = readFileSync(join(ROOT, seed), "utf-8");
  const declared = (caps.harnesses[h]?.sessions ?? []).map((s) => s.name);
  for (const ev of events) {
    check(`4.${h}-seed-${ev}`, body.includes(ev), `${seed} declares ${ev}`);
    check(`4.${h}-caps-${ev}`, declared.includes(ev), `capabilities.${h}.sessions declares ${ev}`);
  }
  const extra = declared.filter((n) => n !== undefined && !events.includes(n));
  check(`4.${h}-caps-extra`, extra.length === 0, extra.length ? `capabilities.${h}.sessions has ${extra.join(",")} with no seed expectation` : `no undeclared session events`);
}

// ---- 4b. session-start materialization (issue #13) -------------------------
// Every harness with a session-start event must declare where the briefing hook
// lives. Workbench-relative paths must point at a real template file; Pi's
// machine-level extension path is documented in harness-pi.md.
for (const [h, cap] of Object.entries(caps.harnesses)) {
  const hasStart = (cap.sessions ?? []).some((s) => /session.?start/i.test(s.name ?? ""));
  if (!hasStart) continue;
  const ss = cap.session_start;
  check(`4b.${h}-session-start-declared`, ss?.path !== undefined, `${h} declares session_start in capabilities.yaml`);
  if (!ss?.path) continue;
  const isWorkbenchPath = !ss.path.startsWith("~") && !ss.path.startsWith("/");
  if (isWorkbenchPath) {
    check(`4b.${h}-session-start-template`, existsSync(join(ROOT, "templates/workbench", ss.path)), `session_start template exists (${ss.path})`);
  } else if (h === "pi") {
    check(`4b.pi-session-start-doc`, piDoc.includes("extensions/jspace"), `harness-pi.md documents ~/.pi/agent/extensions/jspace/`);
  }
}

// ---- 5. SKILL.md reference area covers every harness-*.md ------------------
const skillMd = readFileSync(join(ROOT, "skills/jspace-use/SKILL.md"), "utf-8");
const refArea = skillMd.slice(skillMd.indexOf("## 参考"));
// Accept both a literal `harness-x.md` mention and a brace-group shorthand
// `harness-{x,y,z}.md` whose keys cover all documented harnesses.
function braceGroupCovers(doc: string): boolean {
  const groups = [...doc.matchAll(/harness-\{([^}]+)\}\.md/g)];
  for (const g of groups) {
    const keys = g[1].split(",").map((k) => k.trim());
    if (documentedKeys.every((k) => keys.includes(k))) return true;
  }
  return false;
}
const uncovered = docFiles.filter((f) => !refArea.includes(f));
const uncoveredByGroup = !braceGroupCovers(refArea) && uncovered.length > 0;
check("5.skill-refs", uncoveredByGroup === false, uncoveredByGroup ? `SKILL.md 参考区 missing ${uncovered.join(",")} (add literal filenames or a harness-{...}.md brace group covering all)` : `SKILL.md 参考区 covers all ${documentedKeys.length} harness-*.md`);

// ---- 6. hand-written harness lists contain the full support set ------------
// jspace-domain surfaces only (NOT skills/harness-config — machine-level wiring
// keeps its own set incl. hermes). A list missing a support harness = drift.
const surfaces: { label: string; path: string; mustInclude: string[] }[] = [
  { label: "README", path: "README.md", mustInclude: [...SUPPORT_DISPLAY_NAMES] },
  { label: "template-AGENTS", path: "templates/workbench/AGENTS.md", mustInclude: [...SUPPORT_DISPLAY_NAMES] },
  { label: "PLATFORMS", path: "docs/PLATFORMS.md", mustInclude: [...SUPPORT_DISPLAY_NAMES] },
  { label: "harnesses.md", path: "skills/jspace-use/references/harnesses.md", mustInclude: [...SUPPORT_DISPLAY_NAMES] },
];
for (const s of surfaces) {
  if (!existsSync(join(ROOT, s.path))) continue;
  const content = readFileSync(join(ROOT, s.path), "utf-8");
  const missing = s.mustInclude.filter((n) => !content.includes(n));
  check(`6.${s.label}`, missing.length === 0, missing.length ? `${s.path} missing support-set names: ${missing.join(", ")}` : `contains all support names`);
}

// ---- 7. every adapter hookFilePath points at an existing template ----------
for (const [h] of Object.entries(caps.harnesses)) {
  const a = getAdapter(h);
  if (!a.hookFilePath) continue;
  const p = a.hookFilePath(join(ROOT, "templates/workbench"));
  if (p === null) {
    check(`7.${h}-hookfile`, false, `${h} hookFilePath returned null for the template root`);
    continue;
  }
  check(`7.${h}-hookfile`, existsSync(p), `${h} hookFilePath template exists (${p.replace(ROOT + "/", "")})`);
}

// ---- 8. headlessArgv prefix == capabilities.headless.slice(1) --------------
for (const [h, cap] of Object.entries(caps.harnesses)) {
  if (!cap.headless || cap.headless.length === 0) continue; // cursor: no headless CLI
  const argv = harnessArgv(h, "p", "darwin", "/bin/x");
  const prefix = ["/bin/x", ...cap.headless.slice(1)];
  check(
    `8.${h}-headless-argv`,
    JSON.stringify(argv.slice(0, prefix.length)) === JSON.stringify(prefix),
    `headlessArgv prefix == capabilities.headless.slice(1) (${cap.headless.join(" ")})`,
  );
}

// ---- 9. lifecycle grades match the real wiring matrix ------------------------
// Expectation table: a grade must reflect actual wiring. best_effort only where
// a real mechanism exists (claude/grok/cursor session-end hooks; session_start
// mechanisms on the five session harnesses; crash_recovery on the
// CLI/headless-capable ones). Anything not listed defaults to manual — an
// unlisted "upgrade to best_effort without wiring" turns red here.
const LIFECYCLE_EXPECTED: Record<string, Record<string, string>> = {
  session_start: { claude: "best_effort", grok: "best_effort", opencode: "best_effort", pi: "best_effort", cursor: "best_effort" },
  // claude/grok/cursor seeds declare a session-end hook (evidence per harness in
  // docs/session-end-hooks.md); opencode/pi/codex have no matching event and
  // stay manual + the once-per-session `jspace context turn` nudge.
  session_end: { claude: "best_effort", grok: "best_effort", cursor: "best_effort" },
  fallback: {},
  crash_recovery: { claude: "best_effort", grok: "best_effort", opencode: "best_effort", pi: "best_effort", codex: "best_effort" },
};
for (const dim of ["session_start", "session_end", "fallback", "crash_recovery"]) {
  const expected = LIFECYCLE_EXPECTED[dim];
  for (const [h, cap] of Object.entries(caps.harnesses)) {
    const want = expected[h] ?? "manual";
    const got = cap.lifecycle?.[dim as keyof typeof cap.lifecycle] ?? "manual";
    check(`9.${dim}.${h}`, got === want, `${h} ${dim}=${got} (expect ${want})`);
  }
}

// ---- 10. harnesses.md lifecycle table == capabilities.yaml (no silent drift) -
// The table header claims "rendered from capabilities.yaml"; assert that claim by
// parsing the rendered lifecycle column and comparing it cell-by-cell against the
// source. A hand-edit that drifts a grade turns red instead of silently lying.
const harnessesMd = readFileSync(join(REF_DIR, "harnesses.md"), "utf-8");
const LIFECYCLE_DIMS = ["session_start", "session_end", "fallback", "crash_recovery"] as const;
for (const [h, cap] of Object.entries(caps.harnesses)) {
  const row = harnessesMd.split("\n").find((line) => line.startsWith(`| ${h} |`));
  if (!row) {
    check(`10.lifecycle.${h}`, false, `no lifecycle table row for ${h} in harnesses.md`);
    continue;
  }
  const cells = row.split("|").map((c) => c.trim());
  const grades = cells[cells.length - 2].split("/").map((g) => g.trim());
  const want = LIFECYCLE_DIMS.map((d) => cap.lifecycle?.[d] ?? "manual");
  check(
    `10.lifecycle.${h}`,
    JSON.stringify(grades) === JSON.stringify(want),
    `${h} table=[${grades.join("/")}] caps=[${want.join("/")}]`,
  );
}

if (failures.length > 0) {
  console.error(`\ncheck-harness-consistency: ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\ncheck-harness-consistency: all assertions pass");
