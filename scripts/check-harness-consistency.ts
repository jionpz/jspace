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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REF_DIR = join(ROOT, "skills/jspace-use/references");
const caps = Bun.YAML.parse(readFileSync(join(ROOT, "adapters/harness/capabilities.yaml"), "utf-8")) as {
  harnesses: Record<string, { documented?: boolean; cron_harness_enum_value?: string | null; mcp?: { via?: string } }>;
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
    crons: { harness?: string }[];
  };
  const cronValues = cronJson.crons.map((c) => c.harness).filter(Boolean);
  check(
    "2b.cron-json-values",
    cronValues.every((v) => v !== undefined && caps.harnesses[v] !== undefined),
    `cron.json harness values ${cronValues.join(",")} all ⊆ capabilities keys`,
  );
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

// each grok/opencode session event has a template hook/plugin branch
const grokHook = readFileSync(join(ROOT, "templates/workbench/.grok/hooks/jspace.json"), "utf-8");
for (const ev of ["SessionStart", "UserPromptSubmit", "PreCompact", "SessionEnd"]) {
  check(`4.grok-hook-${ev}`, grokHook.includes(`"${ev}"`), `grok hook JSON declares ${ev}`);
}
const opencodePlugin = readFileSync(join(ROOT, "templates/workbench/.opencode/plugins/jspace.ts"), "utf-8");
for (const ev of ["session.created", "session.idle", "experimental.session.compacting"]) {
  check(`4.opencode-${ev}`, opencodePlugin.includes(ev), `opencode plugin dispatches ${ev}`);
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

if (failures.length > 0) {
  console.error(`\ncheck-harness-consistency: ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\ncheck-harness-consistency: all assertions pass");
