// cli/commands/harness.ts — `jspace harness wire` — wire a session harness's
// gbrain MCP/skill-routing config. This round supports grok (`~/.grok/config.toml`,
// `[mcp_servers.gbrain]` env); claude keeps the existing `gbrain wire`
// (`~/.claude.json`). The Grok config is TOML, so the write is a targeted
// line-edit of the `env = { ... }` inline table (Bun.TOML cannot stringify), never
// a full rewrite. Requires an existing gbrain MCP server — never creates
// machine-level config.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandSpec, CmdContext } from "../../application/commands/command.ts";
import { wireGrokSkillsDir, grokConfigPath, type GrokWireDeps, type GrokWireResult } from "../../application/gbrain/grok-wiring.ts";
import { optS, s } from "./helpers.ts";

function readFileOrNull(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function backupConfig(p: string): string | null {
  const backup = `${p}.jspace-bak-${Date.now()}`;
  try {
    copyFileSync(p, backup);
    return backup;
  } catch {
    return null;
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

function grokWireDeps(dryRun: boolean): GrokWireDeps {
  return {
    readFile: readFileOrNull,
    writeFile: (p, content) => writeFileSync(p, content, "utf-8"),
    backup: backupConfig,
    homedir,
    resolveWorkbenchSkillsDir: (r) => join(r, ".jspace", "skills"),
    ensureResolverFile,
    dryRun,
  };
}

function grokWireHandler(ctx: CmdContext): { lines: string[]; exitCode?: number; warnings?: string[] } {
  const path = grokConfigPath(homedir());
  let result: GrokWireResult;
  try {
    result = wireGrokSkillsDir(grokWireDeps(ctx.dryRun), ctx.root);
  } catch (e) {
    return { lines: [], warnings: [`harness wire grok: ${e instanceof Error ? e.message : String(e)}`] };
  }

  if (!result.ok) {
    return { lines: [`jspace: error: ${result.reason}`], exitCode: 1 };
  }
  switch (result.status) {
    case "already-wired":
      return { lines: [`jspace: ok: grok gbrain skillsDir already wired → ${result.skillsDir}`] };
    case "wired":
      if (ctx.dryRun) {
        return { lines: [`jspace: (dry-run) would wire GBRAIN_SKILLS_DIR=${result.skillsDir} in ${path}`] };
      }
      return {
        lines: [
          `jspace: ok: wired GBRAIN_SKILLS_DIR=${result.skillsDir} in ${path}`,
          "restart the grok session (MCP reconnect) so gbrain serve starts with the new env",
        ],
      };
  }
}

export const harnessSpec: CommandSpec = {
  name: "harness",
  summary: "wire a session harness's gbrain MCP/skill-routing config",
  description:
    "Wires GBRAIN_SKILLS_DIR into the selected harness's gbrain MCP server env so gbrain's skill resolver " +
    "points at this workbench's .jspace/skills. Supported: grok (~/.grok/config.toml [mcp_servers.gbrain]); " +
    "claude uses the existing `gbrain wire`.",
  features: { dir: true },
  children: [
    {
      name: "wire",
      summary: "inject GBRAIN_SKILLS_DIR into a harness's gbrain MCP server env",
      features: { dir: true, dryRun: true },
      options: [{ name: "--harness", takesValue: true, required: true, help: "harness to wire (grok)" }],
      handler: (ctx, args) => {
        const harness = s(args.harness);
        if (harness === "grok") return grokWireHandler(ctx);
        if (harness === "") {
          return { lines: ["jspace: error: the following arguments are required: --harness"], exitCode: 2 };
        }
        const hint = optS(harness);
        return {
          lines: [`jspace: error: unsupported harness for harness wire: ${hint} (supported: grok; claude uses jspace gbrain wire)`],
          exitCode: 1,
        };
      },
    },
  ],
};
