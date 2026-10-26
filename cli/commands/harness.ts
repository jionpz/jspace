// cli/commands/harness.ts — `jspace harness` — per-harness initialization +
// machine-level gbrain MCP wiring (issue #12). Trellis `init --<platform>`
// equivalent: five session harnesses (claude/grok/opencode/cursor/pi) go through
// the SAME pair of commands — `harness init` (ensure workbench seed/projection
// exists) and `harness wire` (idempotent machine-level gbrain MCP + skills
// wiring).
//
// Wire targets come from capabilities.yaml `mcp_config` (single source of truth).
// The declared `mcp_config.writer` selects a strategy (existing-server-env-json,
// existing-server-env-toml, merge-json-server, merge-opencode-local) — never a
// harness-name branch. All writes are merge + backup, never whole-file rewrites.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { CommandSpec, OptionSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import { wireHarness, describeCapability, defaultGbrainBin, type BackupResult, type HarnessWireDeps } from "../../application/harness/wire.ts";
import { loadCapabilities, wireHarnessNames } from "../../adapters/harness/registry.ts";
import { resolveHarnessBin, isExecutableFile } from "../../adapters/harness/bin.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { s } from "./helpers.ts";

/** Session harnesses with a declared machine MCP config (`capabilities.mcp_config`).
 *  Codex declares `mcp_config: null` — Codex supports MCP natively, but JSpace has
 *  no writer for its `~/.codex/config.toml`, so this command cannot wire it. */
const WIRE_HARNESSES = wireHarnessNames();

function readFileOrNull(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

const CONFIG_BACKUP_KEEP = 3;

function pruneConfigBackups(configPath: string): void {
  const dir = dirname(configPath);
  const prefix = `${basename(configPath)}.jspace-bak-`;
  try {
    const backups = readdirSync(dir)
      .filter((n) => n.startsWith(prefix))
      .sort();
    while (backups.length > CONFIG_BACKUP_KEEP) {
      unlinkSync(join(dir, backups.shift()!));
    }
  } catch {
    // best-effort prune — the fresh backup still landed
  }
}

/** Timestamped backup beside a machine config before merge/write. Exported for tests. */
export function backupConfig(p: string): BackupResult {
  const backup = `${p}.jspace-bak-${Date.now()}`;
  try {
    copyFileSync(p, backup);
    pruneConfigBackups(p);
    return { ok: true, path: backup };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** gbrain's `hasResolverFile` gate requires a resolver file in the skills dir.
 *  Mirrors cli/commands/gbrain.ts. */
function ensureResolverFile(skillsDir: string): boolean {
  const p = join(skillsDir, "RESOLVER.md");
  if (existsSync(p)) return false;
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(p, "", "utf-8");
  return true;
}

function gbrainBin(): string | null {
  return defaultGbrainBin(
    process.env.GBRAIN_BIN,
    (name) => resolveHarnessBin(name, process.platform),
    (p) => isExecutableFile(p, process.platform),
  );
}

/** Write a harness MCP/config file atomically. writeBytesAtomic rename-replaces
 *  a symlink instead of writing through it, but a rename also swaps the inode —
 *  so carry the existing mode forward: these configs can be 0600
 *  (`~/.claude.json` and friends hold tokens) and a bare rename would
 *  republish them as 0644. A missing file keeps the umask default. Exported for
 *  tests. */
export function writeConfigAtomic(p: string, content: string): void {
  let mode: number | undefined;
  try {
    mode = statSync(p).mode & 0o777;
  } catch {
    mode = undefined;
  }
  writeBytesAtomic(p, content, mode);
}

function harnessWireDeps(dryRun: boolean): HarnessWireDeps {
  return {
    readFile: readFileOrNull,
    writeFile: writeConfigAtomic,
    backup: backupConfig,
    homedir,
    resolveWorkbenchSkillsDir: (r) => join(r, ".jspace", "skills"),
    ensureResolverFile,
    resolveGbrainBin: gbrainBin,
    dryRun,
  };
}

// ---- `harness wire` (unified dispatch) --------------------------------------

export interface RunHarnessWireOptions {
  /** Injected deps (tests). Defaults to the real fs/homedir factory. */
  deps?: HarnessWireDeps;
}

/** The single wire entry point: one set of write/backup/idempotency semantics. */
export function runHarnessWire(ctx: CmdContext, harness: string, opts: RunHarnessWireOptions = {}): CmdResult {
  const label = `harness wire ${harness}`;
  const deps = opts.deps ?? harnessWireDeps(ctx.dryRun);
  let r: ReturnType<typeof wireHarness>;
  try {
    r = wireHarness(harness, deps, ctx.root);
  } catch (e) {
    return { lines: [], errors: [`${label}: ${e instanceof Error ? e.message : String(e)}`], exitCode: 1 };
  }
  if (!r.ok) {
    return { lines: [], errors: [`${label}: ${r.reason}`], exitCode: 1 };
  }

  const lines: string[] = [];
  if (r.status === "already-wired") {
    lines.push(`jspace: ok: ${harness} gbrain already wired → ${r.skillsDir}`);
  } else if (ctx.dryRun) {
    lines.push(`jspace: (dry-run) would wire ${harness} gbrain → ${r.skillsDir}`);
    for (const plan of r.plans) {
      lines.push(`  write ${plan.path}:`);
      for (const l of plan.content.trimEnd().split("\n")) lines.push(`    ${l}`);
    }
    lines.push("  (nothing written)");
  } else {
    lines.push(`jspace: ok: wired ${harness} gbrain → ${r.skillsDir}`);
    for (const plan of r.plans) lines.push(`  wrote ${plan.path}`);
    lines.push(`restart the ${harness} session (MCP reconnect) so gbrain serve starts with the new env`);
  }
  if (r.sessionStart) {
    for (const note of r.sessionStart.notes) lines.push(`  session-start: ${note}`);
    for (const plan of r.sessionStart.plans) {
      lines.push(ctx.dryRun ? `  session-start: (dry-run) write ${plan.path}:` : `  session-start: wrote ${plan.path}`);
      if (ctx.dryRun) {
        for (const l of plan.content.trimEnd().split("\n")) lines.push(`    ${l}`);
      }
    }
  }
  // No Cursor-specific skills step: workbench skills reach Cursor through the
  // workbench's own `.agents/skills` projection (issue #52), never through a
  // user-level chain that can only name one workbench.
  lines.push(...describeCapability(harness));
  return { lines };
}

// ---- `harness init` (ensure workbench seed/projection for one harness) ------

/** `harness init --harness <端>`: report whether the selected harness's official
 *  skill projections (per capabilities.yaml workbench_projection + shared) are
 *  materialized in this workbench. init/upgrade already lay down ALL projections;
 *  this command is the per-harness view + doc-facing entry point (Trellis
 *  `init --<platform>` shape). Read-only: never materializes on its own — a gap
 *  points at `workspace upgrade`. */
function initHandler(ctx: CmdContext, args: Record<string, unknown>): CmdResult {
  const harness = s(args.harness);
  const caps = loadCapabilities();
  const cap = caps.harnesses[harness];
  const official = SKILLS_MANIFEST.workbench.map((x) => x.name);
  const projections = [...new Set([...(cap?.workbench_projection ?? []), ...caps.shared_workbench_projection])];

  const lines: string[] = [];
  const missing: string[] = [];
  for (const dir of projections) {
    for (const name of official) {
      const rel = `${dir}/${name}`;
      if (existsSync(join(ctx.root, rel))) lines.push(`ok: ${rel}`);
      else missing.push(rel);
    }
  }
  if (missing.length > 0) {
    lines.push(`missing: ${missing.join(", ")}`);
    lines.push(`run 'jspace workspace upgrade --dir ${ctx.root}' to materialize ${harness} skill projections`);
    return { lines };
  }
  lines.push(`jspace: ok: ${harness} skill projections up to date (${projections.length === 0 ? "no harness-specific projection; shared .agents/skills covered" : projections.join(", ")})`);
  return { lines };
}

function harnessChoice(h: string): string {
  return `unsupported harness for harness wire: ${h} (supported: ${WIRE_HARNESSES.join(", ")}; codex has no JSpace-managed MCP config — see skills/jspace-use/references/harness-codex.md)`;
}

function validateHarness(v: string): string | null {
  if (WIRE_HARNESSES.includes(v)) return null;
  if (v === "codex") return harnessChoice(v);
  return `unsupported harness for harness wire: ${v} (supported: ${WIRE_HARNESSES.join(", ")})`;
}

function harnessOption(): OptionSpec {
  return {
    name: "--harness",
    takesValue: true,
    required: true,
    validate: validateHarness,
    help: `harness to init/wire (${WIRE_HARNESSES.join("|")})`,
  };
}

export const harnessSpec: CommandSpec = {
  name: "harness",
  summary: "initialize/wire a session harness's gbrain MCP + skill routing",
  description:
    "Per-harness init + wire (Trellis init --<platform> equivalent). `init` ensures the selected harness's " +
    "skill projections are materialized in the workbench; `wire` idempotently points its gbrain MCP server's " +
    "GBRAIN_SKILLS_DIR at this workbench's .jspace/skills. Five session harnesses: claude/grok/opencode/cursor/pi. " +
    "Machine-level configs are merged + backed up, never rewritten.",
  features: { dir: true },
  children: [
    {
      name: "init",
      summary: "ensure the harness's skill projections exist in the workbench (read-only; gap → workspace upgrade)",
      features: { dir: true, dryRun: true },
      options: [harnessOption()],
      handler: (ctx, args) => initHandler(ctx, args as Record<string, unknown>),
    },
    {
      name: "wire",
      summary: "inject GBRAIN_SKILLS_DIR into a harness's gbrain MCP server env (idempotent, merge + backup)",
      features: { dir: true, dryRun: true },
      options: [harnessOption()],
      handler: (ctx, args) => runHarnessWire(ctx, s((args as Record<string, unknown>).harness)),
    },
  ],
};
