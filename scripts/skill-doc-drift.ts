// scripts/skill-doc-drift.ts — pure helpers for C5 (README/AGENTS ↔ manifest).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSkillsManifest, type SkillsManifestV1 } from "../core/contracts/skills.ts";
import { isId } from "../core/contracts/ids.ts";

export interface ManifestSkillSets {
  workbench: string[];
  global: string[];
  total: number;
}

export interface DocSkillListing {
  /** Skill names mentioned in the listing line (workbench + global). */
  names: Set<string>;
  /** Value from "manifest 合计 N", if present. */
  totalClaimed: number | null;
}

/** Read skills-manifest.json and return sorted workbench/global name lists. */
export function manifestSkillSets(manifest: SkillsManifestV1): ManifestSkillSets {
  const workbench = manifest.workbench.map((s) => s.name).sort();
  const global = manifest.global.map((s) => s.name).sort();
  return { workbench, global, total: workbench.length + global.length };
}

/** Load and decode skills-manifest.json from repo root. */
export function loadManifestSkillSets(repoRoot: string): ManifestSkillSets | { error: string } {
  const raw = JSON.parse(readFileSync(join(repoRoot, "skills-manifest.json"), "utf-8")) as unknown;
  const decoded = decodeSkillsManifest(raw);
  if (!decoded.ok) {
    return {
      error: decoded.issues.map((i) => `${i.code}: ${i.message}`).join("; "),
    };
  }
  return manifestSkillSets(decoded.value);
}

/**
 * Find the dev-repo prose line that enumerates official skills (contains
 * "manifest 合计" and a skills/workbench marker). README and AGENTS each
 * have exactly one such line today.
 */
export function findSkillListingLine(docText: string): string | null {
  for (const line of docText.split("\n")) {
    if (!line.includes("manifest 合计")) continue;
    if (line.includes("workbench 技能") || line.includes("skills/")) return line;
  }
  return null;
}

/** Extract skill names and the claimed manifest total from a listing line. */
export function parseSkillListingLine(line: string): DocSkillListing {
  const names = new Set<string>();

  // Backtick-wrapped ids (AGENTS style, and global names in README).
  for (const m of line.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)) {
    if (isId(m[1])) names.add(m[1]);
  }

  // Slash-separated workbench block (README style: "workbench 技能：a / b / c；").
  // AGENTS uses backtick+顿号 lists; its segment runs until a later "；" and must
  // not be slash-parsed (paths like .claude/skills/ would false-positive).
  const wbMatch = line.match(/workbench 技能[：—]+([^；]+)/);
  if (wbMatch && wbMatch[1].includes(" / ")) {
    for (const part of wbMatch[1].split("/")) {
      const candidate = part.trim().replace(/`/g, "");
      if (isId(candidate)) names.add(candidate);
    }
  }

  const totalMatch = line.match(/manifest 合计\s*(\d+)\s*个?/);
  const totalClaimed = totalMatch ? Number.parseInt(totalMatch[1], 10) : null;

  return { names, totalClaimed };
}

export function diffSkillNameSets(expected: string[], found: Set<string>): { missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected);
  const missing = expected.filter((n) => !found.has(n));
  const extra = [...found].filter((n) => !expectedSet.has(n)).sort();
  return { missing, extra };
}

/** Compare one doc's skill listing line against manifest workbench + global names. */
export function checkDocSkillListing(
  docText: string,
  docLabel: string,
  sets: ManifestSkillSets,
): string[] {
  const failures: string[] = [];
  const line = findSkillListingLine(docText);
  if (!line) {
    failures.push(`C5 ${docLabel}: no skill listing line (expected "manifest 合计" + workbench/skills marker)`);
    return failures;
  }

  const listing = parseSkillListingLine(line);
  const expectedAll = [...sets.workbench, ...sets.global];

  const { missing, extra } = diffSkillNameSets(expectedAll, listing.names);
  if (missing.length > 0) {
    failures.push(`C5 ${docLabel}: missing skill names: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    failures.push(`C5 ${docLabel}: extra skill names not in manifest: ${extra.join(", ")}`);
  }

  if (listing.totalClaimed === null) {
    failures.push(`C5 ${docLabel}: no "manifest 合计 N" count on skill listing line`);
  } else if (listing.totalClaimed !== sets.total) {
    failures.push(
      `C5 ${docLabel}: manifest 合计 claims ${listing.totalClaimed}, manifest has ${sets.total} (${sets.workbench.length} workbench + ${sets.global.length} global)`,
    );
  }

  return failures;
}
