// application/diagnostics/checks/gbrain.ts — gbrain MCP wiring + Cursor skills links.
import { homedir } from "node:os";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { CONFIG_DIR } from "../../../core/contracts/files.ts";
import { loadCapabilities } from "../../../adapters/harness/registry.ts";
import type { CursorSkillsDeps, GbrainDeps } from "../deps.ts";

/** Is a TOML config's `<server_key>` section already pointing GBRAIN_SKILLS_DIR
 *  at the workbench skills dir? (grok's config.toml, issue #8 #16.) Scoped to
 *  the target section only — a sibling server section carrying the same env key
 *  must not mask a missing wire (issue #9 #9-07). */
function tomlSkillsDirWired(toml: string, serverKey: string, wbSkillsDir: string): boolean {
  const lines = toml.split("\n");
  const section = lines.findIndex((l) => l.trim() === `[${serverKey}]`);
  if (section === -1) return false;
  const rest = lines.slice(section + 1);
  const nextHeader = rest.findIndex((l) => /^\s*\[/.test(l));
  const body = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).join("\n");
  const m = body.match(/GBRAIN_SKILLS_DIR\s*=\s*["']([^"']*)["']/);
  return m !== null && m[1] === wbSkillsDir;
}

/** Resolve a dot-path `server_key` (`mcpServers.gbrain`, `mcp.gbrain`) through a
 *  JSON doc — the json branch of checkGBrain mirrors the wire backend instead of
 *  hard-coding the top-level `mcpServers.gbrain` shape (opencode's local servers
 *  live under `mcp.<name>`, issue #12). */
function serverAtKeyPath(doc: unknown, key: string): Record<string, unknown> | null {
  let cur = doc;
  for (const seg of key.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : null;
}

/** True when the server's env (field name per `env_key`, default "env";
 *  opencode uses "environment") already points GBRAIN_SKILLS_DIR at the dir. */
function serverEnvWired(server: Record<string, unknown>, envKey: string, dir: string): boolean {
  const env = server[envKey];
  if (!env || typeof env !== "object") return false;
  return (env as Record<string, unknown>).GBRAIN_SKILLS_DIR === dir;
}

/** gbrain skill-routing wiring (info), for EVERY native-MCP harness that has a
 *  declared config path (capabilities.mcp_config — single source, issue #8 #16). */
export function checkGBrain(root: string, cron: GbrainDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const wbSkillsDir = join(root, CONFIG_DIR, "skills");
  const home = homedir();
  for (const [name, cap] of Object.entries(loadCapabilities().harnesses)) {
    const cfg = cap.mcp_config;
    if (cfg === null) continue;
    if (cap.mcp === undefined || !("native" in cap.mcp) || !cap.mcp.native) continue;
    const cfgPath = cfg.path.replace("~", home);
    const raw = cron.readHarnessConfig?.(cfgPath);
    if (raw === null || raw === undefined) continue;
    const wired =
      cfg.format === "toml"
        ? tomlSkillsDirWired(raw, cfg.server_key, wbSkillsDir)
        : (() => {
            try {
              const server = serverAtKeyPath(JSON.parse(raw), cfg.server_key);
              return server !== null && serverEnvWired(server, cfg.env_key ?? "env", wbSkillsDir);
            } catch {
              diags.push({
                severity: "info",
                code: "gbrain.config_invalid_json",
                path: "gbrain",
                message: `harness config for ${name} is not valid JSON; run ${name === "claude" ? "jspace gbrain wire" : `jspace harness wire --harness ${name}`} to re-wire GBRAIN_SKILLS_DIR`,
              });
              return true;
            }
          })();
    if (!wired) {
      const cmd = name === "claude" ? "jspace gbrain wire" : `jspace harness wire --harness ${name}`;
      diags.push({
        severity: "info",
        code: "gbrain.skillsdir_unwired",
        path: "gbrain",
        message: `gbrain resolver for ${name} not pointed at this workbench's official skills (${wbSkillsDir}); run ${cmd} to wire GBRAIN_SKILLS_DIR`,
      });
    }
  }
  return diags;
}

/** Cursor user-level skills thin-links (issue #12): official skills should be
 *  linked into ~/.cursor/skills/ so the IDE sees them. Missing links are info
 *  (the wire command creates them; doctor only surfaces the gap). */
export function checkCursorSkills(cron: CursorSkillsDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const linked = cron.cursorSkillsLinked;
  if (!linked) return diags;
  const names = cron.officialSkillNames();
  if (names.length === 0) return diags;
  const missing = names.filter((n) => !linked(n));
  if (missing.length === 0) return diags;
  diags.push({
    severity: "info",
    code: "cursor.skills_unlinked",
    path: "cursor",
    message: `Cursor user-level skills missing jspace thin-links: ${missing.join(", ")} (run 'jspace harness wire --harness cursor' after 'jspace skills install')`,
  });
  return diags;
}
