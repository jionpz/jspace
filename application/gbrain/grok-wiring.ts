// application/gbrain/grok-wiring.ts — wire gbrain's skill resolver into the
// Grok Build MCP config (`~/.grok/config.toml`, `[mcp_servers.gbrain]`).
//
// Mirrors application/gbrain/wiring.ts (claude ~/.claude.json) but for a TOML
// config. Bun.TOML parses but cannot stringify, so a full parse→reserialize
// would lose comments/ordering; the edit is a targeted line rewrite that only
// touches the `env = { ... }` inline table of `[mcp_servers.gbrain]` and
// preserves every other byte. Pure: fs access goes through injected deps.
import { join } from "node:path";

export type GrokWireResult =
  | { ok: true; status: "wired" | "already-wired"; skillsDir?: string }
  | { ok: false; status: "no-grok-gbrain-server"; reason: string };

export interface GrokWireDeps {
  readFile: (p: string) => string | null; // malformed/missing -> null
  writeFile: (p: string, content: string) => void;
  backup: (p: string) => string | null; // returns backup path (null when skipped)
  homedir: () => string;
  resolveWorkbenchSkillsDir: (root: string) => string;
  /** Ensure `.jspace/skills/RESOLVER.md` exists (gbrain's hasResolverFile gate). */
  ensureResolverFile: (skillsDir: string) => boolean;
  /** When true, skip write/backup and only compute what would change. */
  dryRun?: boolean;
}

export function grokConfigPath(homedir: string): string {
  return join(homedir, ".grok", "config.toml");
}

/** Locate the `[mcp_servers.gbrain]` section: returns the line index of its
 *  header, or -1 when absent. */
function findGbrainSection(lines: string[]): number {
  return lines.findIndex((l) => l.trim() === "[mcp_servers.gbrain]");
}

/** Is the given line a TOML section header (`[...]`)? */
function isSectionHeader(line: string): boolean {
  return /^\s*\[.*\]\s*$/.test(line);
}

/**
 * Merge GBRAIN_SKILLS_DIR into the `env = { ... }` inline table of the
 * `[mcp_servers.gbrain]` section (single-line inline table form). If no env
 * table exists, insert `env = { GBRAIN_SKILLS_DIR = "<dir>" }` after the section
 * header. Returns { content, changed } — the section must exist (the caller
 * returns no-grok-gbrain-server when it does not, mirroring wireSkillsDir's
 * "never create the server" rule).
 */
export function mergeGrokEnv(content: string, skillsDir: string): { content: string; changed: boolean } {
  const lines = content.split("\n");
  const section = findGbrainSection(lines);
  if (section === -1) return { content, changed: false };

  // section end = next `[...]` header (or EOF)
  let end = lines.length;
  for (let i = section + 1; i < lines.length; i++) {
    if (isSectionHeader(lines[i])) {
      end = i;
      break;
    }
  }

  const quote = JSON.stringify(skillsDir); // TOML string literal == JSON for plain paths

  // find an existing `env =` line in the section
  let envIdx = -1;
  for (let i = section + 1; i < end; i++) {
    if (/^\s*env\s*=/.test(lines[i])) {
      envIdx = i;
      break;
    }
  }

  if (envIdx === -1) {
    // no env line: insert after the section header (line 0 of the section)
    const insertAt = section + 1;
    const envLine = `env = { GBRAIN_SKILLS_DIR = ${quote} }`;
    // skip comment/blank lines right after the header so the insert lands on code
    let pos = insertAt;
    while (pos < end && (lines[pos].trim() === "" || lines[pos].trimStart().startsWith("#"))) pos++;
    lines.splice(pos, 0, envLine);
    return { content: lines.join("\n"), changed: true };
  }

  const line = lines[envIdx];
  // replace an existing GBRAIN_SKILLS_DIR value in the inline table
  if (line.includes("GBRAIN_SKILLS_DIR")) {
    const replaced = line.replace(/GBRAIN_SKILLS_DIR\s*=\s*"[^"]*"/, `GBRAIN_SKILLS_DIR = ${quote}`);
    if (replaced === line) return { content, changed: false }; // already exact
    lines[envIdx] = replaced;
    return { content: lines.join("\n"), changed: true };
  }

  // env inline table without GBRAIN_SKILLS_DIR: insert into the braces
  const brace = line.indexOf("}");
  if (brace === -1) {
    // not a single-line inline table (multiline env block) — do not rewrite it;
    // report as changed=false (caller treats as already-satisfied limitation).
    return { content, changed: false };
  }
  const inner = line.slice(0, brace).trimEnd();
  const needsComma = !/,\s*$/.test(inner) && !/\{\s*$/.test(inner);
  lines[envIdx] = `${inner}${needsComma ? ", " : ""}GBRAIN_SKILLS_DIR = ${quote} }`;
  return { content: lines.join("\n"), changed: true };
}

/**
 * Wire GBRAIN_SKILLS_DIR into ~/.grok/config.toml's `[mcp_servers.gbrain]` env.
 * Merged, preserving every other field. Never creates the config file or the
 * gbrain server (mirrors wireSkillsDir). Idempotent: already-correct value
 * reports already-wired and writes nothing.
 */
export function wireGrokSkillsDir(deps: GrokWireDeps, root: string): GrokWireResult {
  const path = grokConfigPath(deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);

  const content = deps.readFile(path);
  if (content === null) {
    return { ok: false, status: "no-grok-gbrain-server", reason: `${path} is missing; set up Grok Build first (its config.toml must exist)` };
  }
  if (findGbrainSection(content.split("\n")) === -1) {
    return { ok: false, status: "no-grok-gbrain-server", reason: `no [mcp_servers.gbrain] in ${path}; wire the gbrain MCP in Grok first` };
  }

  const { content: merged, changed } = mergeGrokEnv(content, skillsDir);
  if (!changed) {
    return { ok: true, status: "already-wired", skillsDir };
  }

  if (deps.dryRun) {
    return { ok: true, status: "wired", skillsDir };
  }

  deps.ensureResolverFile(skillsDir);
  deps.backup(path);
  deps.writeFile(path, merged);
  return { ok: true, status: "wired", skillsDir };
}
