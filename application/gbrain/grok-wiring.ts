// application/gbrain/grok-wiring.ts — wire gbrain's skill resolver into the
// Grok Build MCP config (`~/.grok/config.toml`, `[mcp_servers.gbrain]`).
//
// Mirrors application/gbrain/wiring.ts (claude ~/.claude.json) but for a TOML
// config. Bun.TOML parses but cannot stringify, so a full parse→reserialize
// would lose comments/ordering; the edit is a targeted line rewrite that only
// touches the `env = { ... }` inline table of `[mcp_servers.gbrain]` and
// preserves every other byte. Pure: fs access goes through injected deps.
import { join } from "node:path";
import type { GbrainMcpSurface } from "../../adapters/harness/types.ts";

export type GrokWireResult =
  | { ok: true; status: "wired" | "already-wired"; skillsDir?: string }
  | { ok: false; status: "no-grok-gbrain-server" | "unsupported-env-shape"; reason: string };

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
 * Merge gbrain env keys into the `env = { ... }` inline table of the
 * `[mcp_servers.gbrain]` section (single-line inline table form). If no env
 * table exists, insert one after the section header. Returns
 * `{ content, changed, unsupported }`; `unsupported` means the env is a
 * multi-line table that this line-oriented writer refuses to rewrite.
 */
export function mergeGrokEnv(
  content: string,
  envVars: Record<string, string>,
): { content: string; changed: boolean; unsupported?: boolean } {
  const lines = content.split("\n");
  const section = findGbrainSection(lines);
  if (section === -1) return { content, changed: false };

  // A `[mcp_servers.gbrain.env]` sub-table is a multi-line env shape. Refuse it
  // loudly instead of inserting a conflicting inline `env = { ... }`.
  if (lines.some((line, i) => i > section && /^\s*\[mcp_servers\.gbrain\.env\]\s*$/.test(line))) {
    return { content, changed: false, unsupported: true };
  }

  // section end = next `[...]` header (or EOF)
  let end = lines.length;
  for (let i = section + 1; i < lines.length; i++) {
    if (isSectionHeader(lines[i])) {
      end = i;
      break;
    }
  }

  // find an existing `env =` line in the section
  let envIdx = -1;
  for (let i = section + 1; i < end; i++) {
    if (/^\s*env\s*=/.test(lines[i])) {
      envIdx = i;
      break;
    }
  }

  if (envIdx === -1) {
    // no env line: insert after the section header
    const insertAt = section + 1;
    const entries = Object.entries(envVars)
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
      .join(", ");
    const envLine = `env = { ${entries} }`;
    // skip comment/blank lines right after the header so the insert lands on code
    let pos = insertAt;
    while (pos < end && (lines[pos].trim() === "" || lines[pos].trimStart().startsWith("#"))) pos++;
    lines.splice(pos, 0, envLine);
    return { content: lines.join("\n"), changed: true };
  }

  const line = lines[envIdx];
  const brace = line.lastIndexOf("}");
  if (brace === -1) {
    // not a single-line inline table (multiline env block) — do not rewrite it
    return { content, changed: false, unsupported: true };
  }

  let inner = line.slice(0, brace).trimEnd();
  const tail = line.slice(brace);
  let changed = false;
  for (const [key, value] of Object.entries(envVars)) {
    const literal = `${key} = ${JSON.stringify(value)}`;
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^,}\\s]+)`);
    if (pattern.test(inner)) {
      const next = inner.replace(pattern, literal);
      if (next !== inner) {
        inner = next;
        changed = true;
      }
    } else {
      const separator = /,\s*$/.test(inner) ? " " : /\{\s*$/.test(inner) ? " " : ", ";
      inner = `${inner}${separator}${literal}`;
      changed = true;
    }
  }
  if (!changed) return { content, changed: false };
  lines[envIdx] = `${inner} ${tail}`;
  return { content: lines.join("\n"), changed: true };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wire GBRAIN_SKILLS_DIR + GBRAIN_SURFACE into ~/.grok/config.toml's
 * `[mcp_servers.gbrain]` env. Merged, preserving every other field. Never
 * creates the config file or the gbrain server (mirrors wireSkillsDir).
 * Idempotent: both values correct reports already-wired and writes nothing.
 * A multiline env table fails loudly (`unsupported-env-shape`) rather than
 * pretending the keys are already present.
 */
export function wireGrokSkillsDir(
  deps: GrokWireDeps,
  root: string,
  surface: GbrainMcpSurface,
): GrokWireResult {
  const path = grokConfigPath(deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);

  const content = deps.readFile(path);
  if (content === null) {
    return { ok: false, status: "no-grok-gbrain-server", reason: `${path} is missing; set up Grok Build first (its config.toml must exist)` };
  }
  if (findGbrainSection(content.split("\n")) === -1) {
    return { ok: false, status: "no-grok-gbrain-server", reason: `no [mcp_servers.gbrain] in ${path}; wire the gbrain MCP in Grok first` };
  }

  const { content: merged, changed, unsupported } = mergeGrokEnv(content, {
    GBRAIN_SKILLS_DIR: skillsDir,
    GBRAIN_SURFACE: surface,
  });
  if (unsupported) {
    return {
      ok: false,
      status: "unsupported-env-shape",
      reason: `[mcp_servers.gbrain] in ${path} uses a multiline env table; add GBRAIN_SKILLS_DIR = ${JSON.stringify(skillsDir)} and GBRAIN_SURFACE = ${JSON.stringify(surface)} to [mcp_servers.gbrain.env] manually`,
    };
  }
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
