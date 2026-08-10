// cli/commands/gbrain.ts — `jspace gbrain wire` — wire gbrain's skill resolver
// to the workbench's official skills. gbrain's auto-detect only looks at
// `$GBRAIN_SKILLS_DIR` / a root `skills/` dir; the fix is to inject
// `GBRAIN_SKILLS_DIR=<wb>/.jspace/skills` into the gbrain MCP server's env in
// `~/.claude.json` (merged, backed up, never rewritten). Requires an existing
// gbrain MCP server — we never create machine-level config.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import {
  claudeJsonPath,
  wireSkillsDir,
  type WireDeps,
  type WireResult,
} from "../../application/gbrain/wiring.ts";

function readJsonOrNull(p: string): unknown | null {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(p: string, doc: unknown): void {
  writeFileSync(p, JSON.stringify(doc, null, 2) + "\n", "utf-8");
}

function backupClaudeJson(p: string): string | null {
  const backup = `${p}.jspace-bak-${Date.now()}`;
  try {
    copyFileSync(p, backup);
    return backup;
  } catch {
    return null;
  }
}

/** gbrain's `hasResolverFile` gate requires a resolver file (RESOLVER.md /
 *  AGENTS.md) in the skills dir for GBRAIN_SKILLS_DIR to be honored. An empty
 *  placeholder suffices — gbrain reads the actual triggers from each
 *  SKILL.md frontmatter, and the resolver file just makes the gate pass. */
function ensureResolverFile(skillsDir: string): boolean {
  const p = join(skillsDir, "RESOLVER.md");
  if (existsSync(p)) return false;
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(p, "", "utf-8");
  return true;
}

const wireDeps = (dryRun: boolean): WireDeps => ({
  readJson: readJsonOrNull,
  writeJson,
  backup: backupClaudeJson,
  homedir,
  resolveWorkbenchSkillsDir: (r) => join(r, ".jspace", "skills"),
  ensureResolverFile,
  dryRun,
});

/** `gbrain wire` handler — exported for tests with injected deps (write
 *  failures must surface as errors + exit 1, never a silent exit 0 — issue #8 #9). */
export function wireHandler(ctx: CmdContext, deps: WireDeps = wireDeps(ctx.dryRun)): CmdResult {
  const path = claudeJsonPath(homedir());
  let result: WireResult;
  try {
    result = wireSkillsDir(deps, ctx.root);
  } catch (e) {
    return { lines: [], errors: [`gbrain wire: ${e instanceof Error ? e.message : String(e)}`], exitCode: 1 };
  }

  switch (result.status) {
    case "already-wired":
      return { lines: [`jspace: ok: gbrain skillsDir already wired → ${result.skillsDir}`] };
    case "wired":
      if (ctx.dryRun) {
        return { lines: [`jspace: (dry-run) would wire GBRAIN_SKILLS_DIR=${result.skillsDir} in ${path}`] };
      }
      return {
        lines: [
          `jspace: ok: wired GBRAIN_SKILLS_DIR=${result.skillsDir} in ${path}`,
          "restart the claude session (MCP reconnect) so gbrain serve starts with the new env",
        ],
      };
    case "no-claude-json":
      return { lines: [], errors: [result.reason ?? `${path} not found`], exitCode: 1 };
    case "no-gbrain-server":
      return { lines: [], errors: [result.reason ?? "no gbrain MCP server"], exitCode: 1 };
    case "invalid-claude-json":
      return { lines: [], errors: [result.reason ?? `${path} is not valid JSON`], exitCode: 1 };
  }
}

export const gbrainSpec: CommandSpec = {
  name: "gbrain",
  summary: "wire gbrain skill routing (GBRAIN_SKILLS_DIR → workbench .jspace/skills)",
  description:
    "gbrain's skill resolver only auto-detects a root `skills/` dir; wire it to the workbench's official " +
    "skills by injecting GBRAIN_SKILLS_DIR=<wb>/.jspace/skills into the gbrain MCP server env in ~/.claude.json.",
  features: { dir: true },
  children: [
    {
      name: "wire",
      summary: "inject GBRAIN_SKILLS_DIR=<wb>/.jspace/skills into the gbrain MCP server env",
      features: { dir: true, dryRun: true },
      handler: (ctx) => wireHandler(ctx),
    },
  ],
};
