// application/harness/wire.ts — unified per-harness gbrain MCP wiring backend.
//
// Issue #12: `jspace harness wire --harness <claude|grok|opencode|cursor|pi>`
// must be a symmetric command (Trellis init --<platform> equivalent). Each
// harness's wire target comes from capabilities.yaml `mcp_config` (single source
// of truth — adding a harness = adding an entry + a backend here, no CLI change).
//
// Semantics per harness (documented in design.md §2.3):
//   claude/grok  — reuse application/gbrain/{wiring,grok-wiring}.ts unchanged
//                  ("never create the machine-level gbrain server" conservative
//                  rule preserved for backward compat).
//   cursor/pi    — `~/.cursor/mcp.json` / `~/.pi/agent/mcp.json` are MCP *lists*,
//                  so create/merge the gbrain server is the correct default
//                  (file missing → start from `{}`).
//   opencode     — `~/.config/opencode/opencode.json` `mcp.<name>` local-server
//                  shape: `{ type, command: [bin, ...], enabled, environment }`.
//
// All backends are idempotent (already-correct → already-wired, no write),
// merge (never whole-file rewrite — opencode.json can carry provider apiKeys),
// backup before write, and honor dryRun (return planned writes without touching
// disk). Pure: fs access goes through injected deps.
import { join } from "node:path";
import { getCapability, loadCapabilities } from "../../adapters/harness/registry.ts";
import type { HarnessCapability } from "../../adapters/harness/types.ts";
import { wireSkillsDir, type WireDeps } from "../gbrain/wiring.ts";
import { wireGrokSkillsDir, type GrokWireDeps } from "../gbrain/grok-wiring.ts";

/** A planned write surfaced to the CLI (dry-run shows path+content). */
export interface WirePlan {
  path: string;
  content: string;
}

export type WireOutcome =
  | { ok: true; status: "wired" | "already-wired"; skillsDir: string; plans: WirePlan[] }
  | { ok: false; status: "missing-config" | "invalid-config" | "no-gbrain-bin" | "unsupported"; reason: string };

export interface HarnessWireDeps {
  readFile: (p: string) => string | null; // missing/malformed -> null
  writeFile: (p: string, content: string) => void;
  /** Copy backup of a machine config before rewriting; returns backup path (null when skipped). */
  backup: (p: string) => string | null;
  homedir: () => string;
  /** `<workbench>/.jspace/skills` — the env value injected into each harness's gbrain server. */
  resolveWorkbenchSkillsDir: (root: string) => string;
  /** Ensure `.jspace/skills/RESOLVER.md` exists (gbrain's hasResolverFile gate). */
  ensureResolverFile: (skillsDir: string) => boolean;
  /** Resolve the gbrain binary per harnesses.md: $GBRAIN_BIN → `command -v gbrain` → ~/.bun/bin/gbrain. */
  resolveGbrainBin: () => string | null;
  /** When true, skip write/backup and only compute what would change. */
  dryRun?: boolean;
}

// ---- helpers ----------------------------------------------------------------

/** Default gbrain binary resolver (per harnesses.md): `$GBRAIN_BIN` → PATH
 *  (`which`/`where`) → `~/.bun/bin/gbrain` (win32 `.exe`). Returns null only
 *  when every source is unavailable, so a wire never guesses a path. The CLI
 *  supplies this via deps; tests inject a fake. Pure: env + fs probing are
 *  injected (`binOnPath` returns the resolved path or the bare name when absent). */
export function defaultGbrainBin(home: string, platform: string, envGbrainBin: string | undefined, binOnPath: (name: string) => string): string | null {
  const envBin = envGbrainBin?.trim();
  if (envBin) return envBin;
  const onPath = binOnPath("gbrain");
  // resolveHarnessBin falls back to the bare name when absent — a real result
  // differs from the name.
  if (onPath !== "gbrain") return onPath;
  const fallback = platform === "win32" ? join(home, ".bun", "bin", "gbrain.exe") : join(home, ".bun", "bin", "gbrain");
  return fallback;
}

/** Expand a leading `~` in a declared config path (`~/.cursor/mcp.json` → home-relative). */
function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

/** Resolve a dot-path `server_key` (`mcpServers.gbrain`, `mcp.gbrain`) through a JSON doc. */
function getByPath(doc: unknown, key: string): Record<string, unknown> | null {
  let cur = doc;
  for (const seg of key.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : null;
}

/** Read + JSON.parse a config file; null when missing, "invalid" when malformed. */
function parseJsonFile(raw: string | null, path: string): { ok: true; doc: unknown } | { ok: false; reason: string } {
  if (raw === null) return { ok: true, doc: {} }; // missing MCP-list file -> start from {}
  try {
    return { ok: true, doc: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: `${path} is not valid JSON; fix or remove it before wiring` };
  }
}

function jsonContent(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** True when the server's env already points GBRAIN_SKILLS_DIR at the workbench. */
function skillsDirWired(server: Record<string, unknown>, envKey: string, skillsDir: string): boolean {
  const env = server[envKey];
  if (!env || typeof env !== "object") return false;
  return (env as Record<string, unknown>).GBRAIN_SKILLS_DIR === skillsDir;
}

/** Shared create/merge MCP-list backend for cursor/pi (claude-shaped server:
 *  `{ command, args, env }`; the declared `mcp_config` supplies path + server_key). */
function wireMcpListBackend(harness: string, deps: HarnessWireDeps, root: string): WireOutcome {
  const cap = getCapability(harness);
  const cfg = cap.mcp_config;
  if (cfg === null) return { ok: false, status: "missing-config", reason: `${harness} has no mcp_config declared` };
  const bin = deps.resolveGbrainBin();
  if (bin === null) {
    return {
      ok: false,
      status: "no-gbrain-bin",
      reason: "could not resolve the gbrain binary (set $GBRAIN_BIN, or install gbrain on PATH); cannot wire the MCP server command",
    };
  }
  const path = expandHome(cfg.path, deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);
  const parsed = parseJsonFile(deps.readFile(path), path);
  if (!parsed.ok) return { ok: false, status: "invalid-config", reason: parsed.reason };
  const doc = parsed.doc as Record<string, unknown>;

  const server = getByPath(doc, cfg.server_key);
  const envKey = cfg.env_key ?? "env";
  // judge against the ORIGINAL server (never a mutated copy — shallow spreads
  // share the env object reference, and mergeEnv on a copy would flip this check)
  if (server !== null && skillsDirWired(server, envKey, skillsDir)) {
    return { ok: true, status: "already-wired", skillsDir, plans: [] };
  }
  const want: Record<string, unknown> = {
    ...(server ?? {}),
    command: bin,
    args: ["serve"],
    // fresh env object: existing vars preserved, GBRAIN_SKILLS_DIR added
    [envKey]: { ...((server?.[envKey] as Record<string, unknown>) ?? {}), GBRAIN_SKILLS_DIR: skillsDir },
  };

  // merge under the server_key path (mcpServers.gbrain / mcp.gbrain), preserving every other field
  const segs = cfg.server_key.split(".");
  let cur = doc;
  for (const seg of segs.slice(0, -1)) {
    if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = want;

  const content = jsonContent(doc);
  if (deps.dryRun) return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
  deps.ensureResolverFile(skillsDir);
  deps.backup(path);
  deps.writeFile(path, content);
  return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
}

/** opencode backend — `mcp.<name>` local-server shape differs from cursor/pi:
 *  `{ type: "local", command: [bin, ...], enabled: true, environment }`. */
function wireOpencodeBackend(deps: HarnessWireDeps, root: string): WireOutcome {
  const cap = getCapability("opencode");
  const cfg = cap.mcp_config;
  if (cfg === null) return { ok: false, status: "missing-config", reason: "opencode has no mcp_config declared" };
  const bin = deps.resolveGbrainBin();
  if (bin === null) {
    return { ok: false, status: "no-gbrain-bin", reason: "could not resolve the gbrain binary (set $GBRAIN_BIN, or install gbrain on PATH); cannot wire the MCP server command" };
  }
  const path = expandHome(cfg.path, deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);
  const parsed = parseJsonFile(deps.readFile(path), path);
  if (!parsed.ok) return { ok: false, status: "invalid-config", reason: parsed.reason };
  const doc = parsed.doc as Record<string, unknown>;

  const server = getByPath(doc, cfg.server_key);
  const envKey = cfg.env_key ?? "env";
  if (server !== null && skillsDirWired(server, envKey, skillsDir)) {
    return { ok: true, status: "already-wired", skillsDir, plans: [] };
  }
  const want: Record<string, unknown> = {
    ...(server ?? {}),
    type: "local",
    command: [bin, "serve"],
    enabled: true,
    // fresh env object: existing vars preserved, GBRAIN_SKILLS_DIR added
    [envKey]: { ...((server?.[envKey] as Record<string, unknown>) ?? {}), GBRAIN_SKILLS_DIR: skillsDir },
  };

  const segs = cfg.server_key.split(".");
  let cur = doc;
  for (const seg of segs.slice(0, -1)) {
    if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = want;

  const content = jsonContent(doc);
  if (deps.dryRun) return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
  deps.ensureResolverFile(skillsDir);
  deps.backup(path);
  deps.writeFile(path, content);
  return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
}

// ---- existing claude/grok backends (thin adapters, logic reused unchanged) ----

function wireClaudeBackend(deps: HarnessWireDeps, root: string): WireOutcome {
  const wireDeps: WireDeps = {
    readJson: (p) => {
      const raw = deps.readFile(p);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    writeJson: (p, doc) => deps.writeFile(p, jsonContent(doc)),
    backup: deps.backup,
    homedir: deps.homedir,
    resolveWorkbenchSkillsDir: deps.resolveWorkbenchSkillsDir,
    ensureResolverFile: deps.ensureResolverFile,
    dryRun: deps.dryRun,
  };
  const r = wireSkillsDir(wireDeps, root);
  if (!r.ok) {
    const status: "missing-config" | "invalid-config" = r.status === "invalid-claude-json" ? "invalid-config" : "missing-config";
    return { ok: false, status, reason: r.reason ?? `claude wire failed (${r.status})` };
  }
  // WireResult.ok is a plain boolean (not a discriminated union), so narrow the
  // status explicitly: any ok=true result is wired or already-wired.
  const status: "wired" | "already-wired" = r.status === "already-wired" ? "already-wired" : "wired";
  return { ok: true, status, skillsDir: r.skillsDir ?? "", plans: [] };
}

function wireGrokBackend(deps: HarnessWireDeps, root: string): WireOutcome {
  const grokDeps: GrokWireDeps = {
    readFile: deps.readFile,
    writeFile: deps.writeFile,
    backup: deps.backup,
    homedir: deps.homedir,
    resolveWorkbenchSkillsDir: deps.resolveWorkbenchSkillsDir,
    ensureResolverFile: deps.ensureResolverFile,
    dryRun: deps.dryRun,
  };
  const r = wireGrokSkillsDir(grokDeps, root);
  if (!r.ok) {
    return { ok: false, status: "missing-config", reason: r.reason };
  }
  return { ok: true, status: r.status, skillsDir: r.skillsDir ?? "", plans: [] };
}

// ---- dispatch ---------------------------------------------------------------

/** Uniform `harness wire` dispatch. Unknown harness → unsupported (loud fail). */
export function wireHarness(harness: string, deps: HarnessWireDeps, root: string): WireOutcome {
  switch (harness) {
    case "claude":
      return wireClaudeBackend(deps, root);
    case "grok":
      return wireGrokBackend(deps, root);
    case "opencode":
      return wireOpencodeBackend(deps, root);
    case "cursor":
      return wireMcpListBackend("cursor", deps, root);
    case "pi":
      return wireMcpListBackend("pi", deps, root);
    default:
      return { ok: false, status: "unsupported", reason: `unsupported harness: ${harness} (supported: claude, grok, opencode, cursor, pi; codex is a cron-compat entry, not a session harness)` };
  }
}

/** Capability-boundary lines printed after a successful wire (honest — never
 *  pretend an IDE-only harness runs cron). */
export function describeCapability(harness: string): string[] {
  const cap: HarnessCapability = getCapability(harness);
  const lines: string[] = [];
  lines.push(
    cap.headless !== null
      ? `capability: ${cap.name} — headless CLI (${cap.headless.join(" ")}); cron harness=${cap.cron_harness_enum_value}`
      : `capability: ${cap.name} — IDE-only (no headless CLI); NOT a cron harness`,
  );
  const hooks = cap.sessions.map((s) => `${s.name}(${s.source})`).join(", ") || "none";
  lines.push(`  sessions: ${hooks}`);
  lines.push(`  session-end memory writeback: ${cap.lifecycle.session_end} (manual = explicit, never automatic)`);
  const skills = [...cap.workbench_projection, ...loadCapabilities().shared_workbench_projection, ...cap.user_install];
  lines.push(`  MCP: ${"native" in cap.mcp ? "native" : `via ${cap.mcp.via}`}; skills: ${skills.join(", ") || "n/a"}`);
  return lines;
}
