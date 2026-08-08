// application/gbrain/wiring.test.ts — GBRAIN_SKILLS_DIR wiring into ~/.claude.json.
// Run: bun test application/gbrain/wiring.test.ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  claudeJsonPath,
  gbrainServer,
  gbrainSkillsDirWired,
  wireSkillsDir,
  type WireDeps,
} from "./wiring.ts";

const WB = "/tmp/wb";
const SKILLS = `${WB}/.jspace/skills`;

function mkDeps(
  doc: unknown | null,
  over: Partial<WireDeps> = {},
): { deps: WireDeps; written: unknown[]; backedUp: string[]; resolvers: string[] } {
  const written: unknown[] = [];
  const backedUp: string[] = [];
  const resolvers: string[] = [];
  const deps: WireDeps = {
    readJson: () => doc,
    writeJson: (_p, d) => {
      written.push(d);
    },
    backup: (p) => {
      backedUp.push(p);
      return `${p}.bak`;
    },
    homedir: () => "/Users/test",
    resolveWorkbenchSkillsDir: (r) => join(r, ".jspace", "skills"),
    ensureResolverFile: (d) => {
      resolvers.push(d);
      return true;
    },
    ...over,
  };
  return { deps, written, backedUp, resolvers };
}

function serverWith(env?: Record<string, unknown>): Record<string, unknown> {
  return { command: "/x/gbrain", args: ["serve"], type: "stdio", ...(env ? { env } : {}) };
}

test("claudeJsonPath joins homedir", () => {
  expect(claudeJsonPath("/home/u")).toBe("/home/u/.claude.json");
});

test("gbrainServer: top-level mcpServers.gbrain; null when absent", () => {
  expect(gbrainServer({ mcpServers: { gbrain: { command: "x" } } })).toEqual({ command: "x" });
  expect(gbrainServer({ mcpServers: {} })).toBeNull();
  expect(gbrainServer({})).toBeNull();
  expect(gbrainServer(null)).toBeNull();
  expect(gbrainServer("x")).toBeNull();
});

test("gbrainSkillsDirWired: exact match; env absent/mismatch false", () => {
  expect(gbrainSkillsDirWired(serverWith({ GBRAIN_SKILLS_DIR: SKILLS }), SKILLS)).toBe(true);
  expect(gbrainSkillsDirWired(serverWith({ GBRAIN_SKILLS_DIR: "/other/skills" }), SKILLS)).toBe(false);
  expect(gbrainSkillsDirWired(serverWith({}), SKILLS)).toBe(false);
  expect(gbrainSkillsDirWired({ command: "x" }, SKILLS)).toBe(false);
});

test("wire: missing ~/.claude.json -> no-claude-json, nothing written", () => {
  const { deps, written } = mkDeps(null);
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("no-claude-json");
  expect(r.ok).toBe(false);
  expect(written).toHaveLength(0);
});

test("wire: no gbrain server -> no-gbrain-server, nothing written", () => {
  const { deps, written } = mkDeps({ mcpServers: {} });
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("no-gbrain-server");
  expect(written).toHaveLength(0);
});

test("wire: already correct -> already-wired, no backup, no write", () => {
  const { deps, written, backedUp } = mkDeps({ mcpServers: { gbrain: serverWith({ GBRAIN_SKILLS_DIR: SKILLS }) } });
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("already-wired");
  expect(r.skillsDir).toBe(SKILLS);
  expect(written).toHaveLength(0);
  expect(backedUp).toHaveLength(0);
});

test("wire: absent env -> resolver ensured, backed up, merged, written; other fields preserved", () => {
  const doc = { mcpServers: { gbrain: { command: "/x/gbrain", args: ["serve"], type: "stdio" } }, permissions: { defaultMode: "acceptEdits" } };
  const { deps, written, backedUp, resolvers } = mkDeps(doc);
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("wired");
  expect(resolvers).toEqual([SKILLS]); // RESOLVER.md ensured first
  expect(backedUp).toHaveLength(1);
  expect(written).toHaveLength(1);
  const out = written[0] as { mcpServers: { gbrain: Record<string, unknown> & { env: Record<string, unknown> } }; permissions: { defaultMode: string } };
  expect(out.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(SKILLS);
  expect(out.mcpServers.gbrain.command).toBe("/x/gbrain"); // preserved
  expect(out.mcpServers.gbrain.args).toEqual(["serve"]); // preserved
  expect(out.permissions.defaultMode).toBe("acceptEdits"); // untouched unrelated field
});

test("wire: existing env with other keys -> GBRAIN_SKILLS_DIR set, others kept", () => {
  const doc = { mcpServers: { gbrain: serverWith({ PATH: "/usr/bin" }) } };
  const { deps, written } = mkDeps(doc);
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("wired");
  const out = written[0] as { mcpServers: { gbrain: { env: Record<string, unknown> } } };
  expect(out.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(SKILLS);
  expect(out.mcpServers.gbrain.env.PATH).toBe("/usr/bin"); // other env key preserved
});

test("wire: dry-run computes without writing or backing up", () => {
  const doc = { mcpServers: { gbrain: { command: "x" } } };
  const { deps, written, backedUp } = mkDeps(doc, { dryRun: true });
  const r = wireSkillsDir(deps, WB);
  expect(r.status).toBe("wired");
  expect(r.skillsDir).toBe(SKILLS);
  expect(written).toHaveLength(0);
  expect(backedUp).toHaveLength(0);
});
