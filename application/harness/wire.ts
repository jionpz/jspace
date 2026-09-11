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
import { getCapability, loadCapabilities, wireHarnessNames } from "../../adapters/harness/registry.ts";
import type { HarnessCapability, McpWriter } from "../../adapters/harness/types.ts";
import { wireSkillsDir, type WireDeps } from "../gbrain/wiring.ts";
import { wireGrokSkillsDir, type GrokWireDeps } from "../gbrain/grok-wiring.ts";

/** A planned write surfaced to the CLI (dry-run shows path+content). */
export interface WirePlan {
  path: string;
  content: string;
}

export interface WireSessionStartOutcome {
  status: "wired" | "already-wired" | "missing" | "unsupported" | "failed";
  plans: WirePlan[];
  notes: string[];
  reason?: string;
}

export type WireOutcome =
  | { ok: true; status: "wired" | "already-wired"; skillsDir: string; plans: WirePlan[]; sessionStart?: WireSessionStartOutcome }
  | { ok: false; status: "missing-config" | "invalid-config" | "no-gbrain-bin" | "backup-failed" | "unsupported"; reason: string };

export type BackupResult =
  | { ok: true; path: string | null } // null = no prior file, no backup needed
  | { ok: false; reason: string };

export interface HarnessWireDeps {
  readFile: (p: string) => string | null; // missing/malformed -> null
  writeFile: (p: string, content: string) => void;
  /** Copy backup of an existing machine config before rewriting. */
  backup: (p: string) => BackupResult;
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

/** Shared write gate: existing target requires a successful backup first;
 *  missing target may be created directly. Throws only for writeFile failures so
 *  the CLI keeps its existing I/O error semantics. */
function writeConfigWithBackup(deps: HarnessWireDeps, path: string, content: string, existed: boolean): { ok: true } | { ok: false; reason: string } {
  if (existed) {
    const backup = deps.backup(path);
    if (!backup.ok) return { ok: false, reason: `backup failed for ${path}: ${backup.reason}` };
  }
  deps.writeFile(path, content);
  return { ok: true };
}

/** Raised by the legacy-writer backup shim so `wireClaudeBackend` /
 *  `wireGrokBackend` can convert a backup failure into the same
 *  `backup-failed` outcome every other writer returns (never a stray throw). */
class BackupFailedError extends Error {}

/** Adapt the fail-closed backup result to the legacy writer interface. A failed
 *  backup throws before the legacy writer reaches its write call. */
function legacyBackup(deps: HarnessWireDeps, path: string): string | null {
  const backup = deps.backup(path);
  if (!backup.ok) throw new BackupFailedError(`backup failed for ${path}: ${backup.reason}`);
  return backup.path;
}

/** True when the server's env already points GBRAIN_SKILLS_DIR at the workbench. */
function skillsDirWired(server: Record<string, unknown>, envKey: string, skillsDir: string): boolean {
  const env = server[envKey];
  if (!env || typeof env !== "object") return false;
  return (env as Record<string, unknown>).GBRAIN_SKILLS_DIR === skillsDir;
}

/** Shared create/merge MCP-list backend for cursor/pi (claude-shaped server:
 *  `{ command, args, env }`; the declared `mcp_config` supplies path + server_key). */
function wireMcpListBackend(cap: HarnessCapability, deps: HarnessWireDeps, root: string): WireOutcome {
  const cfg = cap.mcp_config;
  if (cfg === null) return { ok: false, status: "missing-config", reason: `${cap.name} has no mcp_config declared` };
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
  const raw = deps.readFile(path);
  const parsed = parseJsonFile(raw, path);
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
  const written = writeConfigWithBackup(deps, path, content, raw !== null);
  if (!written.ok) return { ok: false, status: "backup-failed", reason: written.reason };
  return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
}

/** opencode backend — `mcp.<name>` local-server shape differs from cursor/pi:
 *  `{ type: "local", command: [bin, ...], enabled: true, environment }`. */
function wireOpencodeBackend(cap: HarnessCapability, deps: HarnessWireDeps, root: string): WireOutcome {
  const cfg = cap.mcp_config;
  if (cfg === null) return { ok: false, status: "missing-config", reason: `${cap.name} has no mcp_config declared` };
  const bin = deps.resolveGbrainBin();
  if (bin === null) {
    return { ok: false, status: "no-gbrain-bin", reason: "could not resolve the gbrain binary (set $GBRAIN_BIN, or install gbrain on PATH); cannot wire the MCP server command" };
  }
  const path = expandHome(cfg.path, deps.homedir());
  const skillsDir = deps.resolveWorkbenchSkillsDir(root);
  const raw = deps.readFile(path);
  const parsed = parseJsonFile(raw, path);
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
  const written = writeConfigWithBackup(deps, path, content, raw !== null);
  if (!written.ok) return { ok: false, status: "backup-failed", reason: written.reason };
  return { ok: true, status: "wired", skillsDir, plans: [{ path, content }] };
}

// ---- existing claude/grok backends (thin adapters, logic reused unchanged) ----

function wireClaudeBackend(cap: HarnessCapability, deps: HarnessWireDeps, root: string): WireOutcome {
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
    backup: (p) => legacyBackup(deps, p),
    homedir: deps.homedir,
    resolveWorkbenchSkillsDir: deps.resolveWorkbenchSkillsDir,
    ensureResolverFile: deps.ensureResolverFile,
    dryRun: deps.dryRun,
  };
  let r: ReturnType<typeof wireSkillsDir>;
  try {
    r = wireSkillsDir(wireDeps, root);
  } catch (e) {
    if (e instanceof BackupFailedError) return { ok: false, status: "backup-failed", reason: e.message };
    throw e;
  }
  if (!r.ok) {
    const status: "missing-config" | "invalid-config" = r.status === "invalid-claude-json" ? "invalid-config" : "missing-config";
    return { ok: false, status, reason: r.reason ?? `${cap.name} wire failed (${r.status})` };
  }
  // WireResult.ok is a plain boolean (not a discriminated union), so narrow the
  // status explicitly: any ok=true result is wired or already-wired.
  const status: "wired" | "already-wired" = r.status === "already-wired" ? "already-wired" : "wired";
  return { ok: true, status, skillsDir: r.skillsDir ?? "", plans: [] };
}

function wireGrokBackend(_cap: HarnessCapability, deps: HarnessWireDeps, root: string): WireOutcome {
  const grokDeps: GrokWireDeps = {
    readFile: deps.readFile,
    writeFile: deps.writeFile,
    backup: (p) => legacyBackup(deps, p),
    homedir: deps.homedir,
    resolveWorkbenchSkillsDir: deps.resolveWorkbenchSkillsDir,
    ensureResolverFile: deps.ensureResolverFile,
    dryRun: deps.dryRun,
  };
  let r: ReturnType<typeof wireGrokSkillsDir>;
  try {
    r = wireGrokSkillsDir(grokDeps, root);
  } catch (e) {
    if (e instanceof BackupFailedError) return { ok: false, status: "backup-failed", reason: e.message };
    throw e;
  }
  if (!r.ok) {
    return { ok: false, status: "missing-config", reason: r.reason };
  }
  return { ok: true, status: r.status, skillsDir: r.skillsDir ?? "", plans: [] };
}

// ---- session-start hook materialization --------------------------------------

const PI_EXTENSION_SOURCE = `// JSpace Pi session-start briefing extension.
// Generated by \`jspace harness wire --harness pi\` (issue #13). Do not edit manually.
// Wire marker: jspace context session-start --plain
// Best-effort: never blocks a Pi session; if jspace is missing/times out, the
// briefing is skipped silently.
import { spawn } from "node:child_process";

let pending = "";

export default function (pi: any) {
  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    try {
      const cwd = ctx?.cwd ?? process.cwd();
      pending = await runSessionStart(cwd);
    } catch {
      pending = "";
    }
  });

  pi.on("context", (event: any) => {
    if (!pending) return;
    const text = pending;
    pending = "";
    if (!event?.messages) return;
    event.messages.push({ role: "user", content: text });
    return { messages: event.messages };
  });
}

function runSessionStart(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("jspace", ["context", "session-start", "--plain"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve("");
      return;
    }
    let out = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* best effort */ }
      resolve("");
    }, 8000);
    child.stdout?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : "");
    });
  });
}
`;

/** Resolve a declared session_start path to an absolute path. */
function sessionStartPath(cap: HarnessCapability, deps: HarnessWireDeps, root: string): string {
  const p = cap.session_start?.path ?? "";
  if (p.startsWith("~/") || p.startsWith("~\\")) return expandHome(p, deps.homedir());
  if (p.startsWith("/")) return p;
  return join(root, p);
}

/** True when the existing file content already carries the session-start wire. */
function sessionStartAlreadyWired(raw: string | null): boolean {
  return raw !== null && raw.includes("jspace context session-start");
}

/**
 * Materialize (or verify) the session-start briefing hook for one harness.
 * Workbench seed hooks (claude/grok/cursor/opencode) are owned by init/upgrade;
 * `harness wire` only verifies and points to `workspace upgrade`. Pi is a
 * machine-level extension that this command writes directly.
 */
export function wireSessionStart(harness: string, deps: HarnessWireDeps, root: string): WireSessionStartOutcome {
  const cap = getCapability(harness);
  const ss = cap.session_start;
  if (!ss) return { status: "unsupported", plans: [], notes: [`${harness}: no session-start materialization declared`] };
  const path = sessionStartPath(cap, deps, root);
  const raw = deps.readFile(path);

  if (ss.format === "file") {
    if (harness === "pi") {
      if (sessionStartAlreadyWired(raw)) {
        return { status: "already-wired", plans: [], notes: [`pi: session-start extension already wired → ${path}`] };
      }
      const plan: WirePlan = { path, content: PI_EXTENSION_SOURCE };
      if (deps.dryRun) return { status: "wired", plans: [plan], notes: [`pi: (dry-run) would write session-start extension → ${path}`] };
      const written = writeConfigWithBackup(deps, path, plan.content, raw !== null);
      if (!written.ok) return { status: "failed", plans: [], notes: [`pi: session-start write blocked → ${path}`], reason: written.reason };
      return { status: "wired", plans: [plan], notes: [`pi: wrote session-start extension → ${path}`] };
    }
    // opencode plugin is a workbench seed — never write from wire.
    if (sessionStartAlreadyWired(raw)) {
      return { status: "already-wired", plans: [], notes: [`${harness}: session-start plugin already present → ${path}`] };
    }
    return { status: "missing", plans: [], notes: [`${harness}: session-start plugin missing or stale at ${path}; run 'jspace workspace upgrade' to materialize the seed`] };
  }

  // json/toml workbench seed hooks — verify only (upgrade owns the writes).
  if (sessionStartAlreadyWired(raw)) {
    return { status: "already-wired", plans: [], notes: [`${harness}: session-start hook already present → ${path}`] };
  }
  return { status: "missing", plans: [], notes: [`${harness}: session-start hook missing or stale at ${path}; run 'jspace workspace upgrade' to materialize the seed`] };
}

// ---- dispatch ---------------------------------------------------------------

type WireWriter = (cap: HarnessCapability, deps: HarnessWireDeps, root: string) => WireOutcome;

/** Constrained MCP writer strategies. Dispatch is by declared strategy, never by
 *  harness name; the capability remains the single source of selection. */
const WIRE_WRITERS: Record<McpWriter, WireWriter> = {
  "existing-server-env-json": wireClaudeBackend,
  "existing-server-env-toml": wireGrokBackend,
  "merge-json-server": wireMcpListBackend,
  "merge-opencode-local": wireOpencodeBackend,
};

/** Wire one already-resolved capability. Exported for fixture-level strategy tests. */
export function wireCapability(cap: HarnessCapability, deps: HarnessWireDeps, root: string): WireOutcome {
  const cfg = cap.mcp_config;
  if (cfg === null) {
    return {
      ok: false,
      status: "unsupported",
      reason: `${cap.name} has no declared session MCP config (cron-only or IDE compatibility entry)`,
    };
  }
  const writer = WIRE_WRITERS[cfg.writer as McpWriter];
  if (!writer) {
    return {
      ok: false,
      status: "unsupported",
      reason: `unsupported mcp_config.writer "${cfg.writer}" for harness ${cap.name}`,
    };
  }
  const backend = writer(cap, deps, root);
  if (!backend.ok) return backend;
  const sessionStart = wireSessionStart(cap.name, deps, root);
  if (sessionStart.status === "failed") {
    return { ok: false, status: "backup-failed", reason: sessionStart.reason ?? `${cap.name} session-start write failed` };
  }
  return { ...backend, sessionStart };
}

/** Uniform `harness wire` dispatch. Unknown harness → unsupported (loud fail). */
export function wireHarness(harness: string, deps: HarnessWireDeps, root: string): WireOutcome {
  let cap: HarnessCapability;
  try {
    cap = getCapability(harness);
  } catch {
    return {
      ok: false,
      status: "unsupported",
      reason: `unsupported harness: ${harness} (supported: ${wireHarnessNames().join(", ")}; codex is a cron-compat entry, not a session harness)`,
    };
  }
  return wireCapability(cap, deps, root);
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
