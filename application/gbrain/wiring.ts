// application/gbrain/wiring.ts — wire gbrain's skill resolver to the workbench's
// official skills (`.jspace/skills/`). gbrain's `autoDetectSkillsDir` only looks
// at `$GBRAIN_SKILLS_DIR` / a root `skills/` dir, never `.jspace/skills/`; the
// fix is to inject `GBRAIN_SKILLS_DIR=<wb>/.jspace/skills` into the Claude Code
// MCP gbrain server's env in `~/.claude.json`, so `gbrain serve` starts with it.
// Pure: filesystem access goes through injected deps (unit-testable), and the
// machine-level config is merged, never rewritten (backup before write).
import { join } from "node:path";

export interface WireResult {
  ok: boolean;
  status: "wired" | "already-wired" | "no-claude-json" | "invalid-claude-json" | "no-gbrain-server";
  reason?: string;
  /** The env value that was (or would be) written; undefined when not wired. */
  skillsDir?: string;
}

export interface WireDeps {
  readJson: (p: string) => unknown | null; // malformed file -> null
  writeJson: (p: string, doc: unknown) => void;
  backup: (p: string) => string | null; // returns backup path (null when skipped)
  homedir: () => string;
  resolveWorkbenchSkillsDir: (root: string) => string;
  /** Ensure `.jspace/skills/RESOLVER.md` exists (empty placeholder suffices for
   *  gbrain's hasResolverFile gate). Returns true if created, false if present. */
  ensureResolverFile: (skillsDir: string) => boolean;
  /** When true, skip write/backup and only compute what would change. */
  dryRun?: boolean;
}

export function claudeJsonPath(homedir: string): string {
  return join(homedir, ".claude.json");
}

/** The `mcpServers.gbrain` server object from a parsed ~/.claude.json, or null. */
export function gbrainServer(doc: unknown): Record<string, unknown> | null {
  if (!doc || typeof doc !== "object") return null;
  const mcp = (doc as Record<string, unknown>).mcpServers;
  if (!mcp || typeof mcp !== "object") return null;
  const g = (mcp as Record<string, unknown>).gbrain;
  return g && typeof g === "object" ? (g as Record<string, unknown>) : null;
}

/** True when the server's env already points GBRAIN_SKILLS_DIR at the workbench. */
export function gbrainSkillsDirWired(server: Record<string, unknown>, wbSkillsDir: string): boolean {
  const env = server.env;
  if (!env || typeof env !== "object") return false;
  return (env as Record<string, unknown>).GBRAIN_SKILLS_DIR === wbSkillsDir;
}

/**
 * Wire GBRAIN_SKILLS_DIR into ~/.claude.json's gbrain MCP server env (merged,
 * preserving every other field). Never creates the server or the config file —
 * those are the user's Claude Code setup. Idempotent: an already-correct value
 * reports already-wired and writes nothing.
 */
export function wireSkillsDir(deps: WireDeps, root: string): WireResult {
  const path = claudeJsonPath(deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);

  const doc = deps.readJson(path);
  if (doc === null) {
    // distinguish missing vs malformed via a second probe: readJson returned
    // null for either; treat as "not wireable" and let the command guide.
    return { ok: false, status: "no-claude-json", reason: `${path} is missing or not valid JSON; set up Claude Code first` };
  }

  const server = gbrainServer(doc);
  if (server === null) {
    return { ok: false, status: "no-gbrain-server", reason: 'no mcpServers.gbrain in ~/.claude.json; wire the gbrain MCP first (claude mcp add --scope user)' };
  }

  if (gbrainSkillsDirWired(server, skillsDir)) {
    return { ok: true, status: "already-wired", skillsDir };
  }

  if (deps.dryRun) {
    return { ok: true, status: "wired", skillsDir };
  }

  deps.ensureResolverFile(skillsDir);
  deps.backup(path);
  const env = (server.env && typeof server.env === "object" ? server.env : {}) as Record<string, unknown>;
  env.GBRAIN_SKILLS_DIR = skillsDir;
  server.env = env;
  deps.writeJson(path, doc);
  return { ok: true, status: "wired", skillsDir };
}
