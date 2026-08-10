// scripts/gen-assets.ts — walk templates/workbench + skills and emit
// cli/assets.generated.ts (content map) and cli/manifest.generated.ts
// (DistributionManifestV1 with sha256 + ownership). Embedded by bun build
// --compile for a self-contained binary. Regenerate after editing templates
// or skills.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { ownershipFor, sha256Of } from "../application/workspace/manifest.ts";
import { decodeSkillsManifest } from "../core/contracts/skills.ts";
import { renderAgentsBlocks } from "./skill-frontmatter.ts";
import { VERSION } from "../cli/version.generated.ts";
import { readManifestJson, staleManifestPaths } from "./asset-integrity.ts";

const repoRoot = resolve(import.meta.dir, "..");

// skills-manifest.json is the single source for which skills ship in the
// binary. gen-assets embeds every workbench-scoped skill dir (this pulls
// memory-recall/writeback into the bundle) and asserts each exists on disk so
// the manifest never drifts from the skills/ tree.
const skillsRaw = JSON.parse(readFileSync(join(repoRoot, "skills-manifest.json"), "utf-8")) as unknown;
const skillsDecoded = decodeSkillsManifest(skillsRaw);
if (!skillsDecoded.ok) {
  throw new Error(
    `skills-manifest.json invalid: ${skillsDecoded.issues.map((i) => `${i.code}: ${i.message}`).join("; ")}`,
  );
}
const skillsManifest = skillsDecoded.value;
const skillDirs = skillsManifest.workbench.map((s) => `skills/${s.name}`);
for (const d of skillDirs) {
  if (!statSync(join(repoRoot, d), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`skills-manifest declares missing skill dir: ${d}`);
  }
}
const SOURCES = ["templates/workbench", "templates/filehub", ...skillDirs];

// Render the generated AGENTS.md Brain-operations block (from each workbench
// skill's SKILL.md frontmatter triggers). Writes the template back to disk so
// the checked-in template stays fresh (regenerate -> diff clean) and the walk
// below embeds the same rendered bytes.
renderAgentsBlocks(repoRoot, skillsManifest.workbench.map((s) => s.name));

// Skip VCS/build artifacts so they never get embedded into the binary.
const SKIP_DIRS = new Set(["__pycache__", ".git", "node_modules"]);
const SKIP_EXT = new Set([".pyc", ".pyo", ".DS_Store"]);

function walk(dir: string, base: string, out: Map<string, string>): void {
  // deterministic traversal: readdir order differs across filesystems (APFS vs
  // ext4) and would make generated output non-reproducible / freshness-flaky.
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, base, out);
    } else {
      if (SKIP_EXT.has(extname(name))) continue;
      // test files never embed: TS unit tests + self-contained python tests
      // (verify.yml runs the python tests from the repo path, not the bundle)
      if (/\.test\.(ts|py)$/.test(name)) continue;
      const rel = relative(base, p).split(sep).join("/");
      const baseRel = relative(repoRoot, base).split(sep).join("/");
      out.set(`${baseRel}/${rel}`, readFileSync(p, "utf-8"));
    }
  }
}

const assets = new Map<string, string>();
for (const s of SOURCES) walk(join(repoRoot, s), join(repoRoot, s), assets);

// Source-integrity guard (issue #6): every path the previous committed
// manifest declared must still be producible by this walk. A committed manifest
// whose source is gone holds stale bytes that a fresh clone's gen-assets would
// silently drop (the .opencode/plugins/jspace.ts loss — gitignored source kept
// its bundle entry until the next regen removed it). Fail loudly instead. An
// INTENTIONAL removal (e.g. dropping a skill) hits this too: rerun with
// GEN_ASSETS_ALLOW_MISSING=1 to regenerate-and-drop the stale entries, then
// commit the regenerated files.
const manifestJsonPath = join(repoRoot, "cli", "manifest.json");
/** Only "1"/"true" enable the missing-source bypass; "0"/"false"/unset stay
 *  strict (issue #7 P2.13 — JS truthiness would otherwise let "false" through). */
function missingAllowed(): boolean {
  const v = process.env.GEN_ASSETS_ALLOW_MISSING;
  return v === "1" || v === "true";
}
if (!missingAllowed()) {
  // Read the previous round's committed manifest from the pure JSON twin
  // (issue #7 P3.16) — no TS regex, no comment/quote fragile matching.
  const oldPaths = existsSync(manifestJsonPath)
    ? readManifestJson(manifestJsonPath).files.map((f) => f.path)
    : [];
  const stale = staleManifestPaths(oldPaths, assets.keys());
  if (stale.length > 0) {
    console.error("gen-assets: stale manifest paths with no source on disk (source deleted without regenerating):");
    for (const p of stale) console.error(`  ${p}`);
    console.error("If the removal was intentional, rerun with GEN_ASSETS_ALLOW_MISSING=1, then commit the regenerated files.");
    process.exit(1);
  }
}

const body = [...assets.entries()]
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n");
const output = `// generated by scripts/gen-assets.ts — do not edit by hand.
// Regenerate with: bun run scripts/gen-assets.ts
export const ASSETS: Record<string, string> = {
${body}
};
`;
writeFileSync(join(repoRoot, "cli", "assets.generated.ts"), output, "utf-8");
console.log(`wrote cli/assets.generated.ts (${assets.size} files, ${output.length} bytes)`);

// Bundle manifest (DistributionManifestV1): per-file sha256 + ownership.
const manifestBody = [...assets.entries()]
  .map(
    ([k, v]) =>
      `  { path: ${JSON.stringify(k)}, sha256: "${sha256Of(v)}", ownership: "${ownershipFor(k)}" },`,
  )
  .join("\n");
const manifestOutput = `// generated by scripts/gen-assets.ts — do not edit by hand.
// Regenerate with: bun run scripts/gen-assets.ts
import type { DistributionManifestV1 } from "../core/contracts/distribution.ts";
export const BUNDLE_MANIFEST: DistributionManifestV1 = {
  schema_version: 1,
  bundle_version: ${JSON.stringify(VERSION)},
  files: [
${manifestBody}
  ],
};
`;
writeFileSync(join(repoRoot, "cli", "manifest.generated.ts"), manifestOutput, "utf-8");
console.log(`wrote cli/manifest.generated.ts (${assets.size} files, ${manifestOutput.length} bytes)`);

// Pure-JSON twin of the bundle manifest (issue #7 P3.16): checks (gen-assets
// stale guard, check-manifest-integrity, manifest-integrity.test) parse this
// instead of regexing the TS — no comment/quote fragile matching. Not embedded
// in the binary; the .ts version carries the type + import graph.
const manifestJson = JSON.stringify(
  {
    schema_version: 1,
    bundle_version: VERSION,
    files: [...assets.entries()].map(([k, v]) => ({
      path: k,
      sha256: sha256Of(v),
      ownership: ownershipFor(k),
    })),
  },
  null,
  2,
);
writeFileSync(join(repoRoot, "cli", "manifest.json"), manifestJson + "\n", "utf-8");
console.log(`wrote cli/manifest.json (${assets.size} files)`);

// SkillsManifest embedded for runtime validation (validateSkillTarget reads
// which skills are required + their versions).
const skillsOutput = `// generated by scripts/gen-assets.ts — do not edit by hand.
// Regenerate with: bun run scripts/gen-assets.ts
import type { SkillsManifestV1 } from "../core/contracts/skills.ts";
export const SKILLS_MANIFEST: SkillsManifestV1 = ${JSON.stringify(skillsManifest, null, 2)};
`;
writeFileSync(join(repoRoot, "cli", "skills.generated.ts"), skillsOutput, "utf-8");
console.log(`wrote cli/skills.generated.ts (${JSON.stringify(skillsManifest.workbench.map((s) => s.name))})`);

// Capabilities single source of truth → adapters/harness/capabilities.generated.ts.
// Rendered as a typed TS module (not embedded as a raw asset) so the compiled
// binary carries it via the import graph (registry.ts imports it) with no yaml
// dependency at runtime. Bun.YAML.parse runs only here, at build/script time.
const capsYaml = readFileSync(join(repoRoot, "adapters/harness/capabilities.yaml"), "utf-8");
const capsParsed = Bun.YAML.parse(capsYaml) as unknown;
// name is derived from the harness key at registry load (not duplicated in the
// yaml); rendered here as-is so gen-assets stays idempotent against its own
// import graph (manifest.ts -> registry -> capabilities.generated.ts).
const capsOutput = `// generated by scripts/gen-assets.ts — do not edit by hand.
// Regenerate with: bun run scripts/gen-assets.ts
import type { HarnessCapabilitiesFile } from "./types.ts";
export const CAPABILITIES: HarnessCapabilitiesFile = ${JSON.stringify(capsParsed, null, 2)};
`;
writeFileSync(join(repoRoot, "adapters/harness/capabilities.generated.ts"), capsOutput, "utf-8");
console.log(`wrote adapters/harness/capabilities.generated.ts`);

