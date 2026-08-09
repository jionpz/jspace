// application/gbrain/grok-wiring.test.ts — Grok MCP config wiring (TOML
// read-modify-write). Bun.TOML parses but cannot stringify, so the merge is a
// targeted line edit that preserves every byte outside the env inline table.
// Run: bun test application/gbrain/grok-wiring.test.ts
import { expect, test } from "bun:test";
import { mergeGrokEnv, wireGrokSkillsDir, grokConfigPath, type GrokWireDeps } from "./grok-wiring.ts";

test("mergeGrokEnv adds GBRAIN_SKILLS_DIR to an existing env inline table", () => {
  const input = `[model]\nprovider = "x"\n\n[mcp_servers.gbrain]\ncommand = "gbrain"\nargs = ["serve"]\nenv = { OTHER = "keep" }\n`;
  const { content, changed } = mergeGrokEnv(input, "/wb/.jspace/skills");
  expect(changed).toBe(true);
  expect(content).toContain('env = { OTHER = "keep", GBRAIN_SKILLS_DIR = "/wb/.jspace/skills" }');
  expect(content).toContain("[model]"); // unrelated sections preserved
  expect(content).toContain('[mcp_servers.gbrain]'); // header preserved
});

test("mergeGrokEnv replaces an existing GBRAIN_SKILLS_DIR value", () => {
  const input = `[mcp_servers.gbrain]\ncommand = "gbrain"\nenv = { GBRAIN_SKILLS_DIR = "/old/path" }\n`;
  const { content, changed } = mergeGrokEnv(input, "/new/skills");
  expect(changed).toBe(true);
  expect(content).toContain('GBRAIN_SKILLS_DIR = "/new/skills"');
  expect(content).not.toContain("/old/path");
});

test("mergeGrokEnv adds an env line when the section has none", () => {
  const input = `[mcp_servers.gbrain]\ncommand = "gbrain"\nargs = ["serve"]\n`;
  const { content, changed } = mergeGrokEnv(input, "/wb/.jspace/skills");
  expect(changed).toBe(true);
  expect(content).toContain(`env = { GBRAIN_SKILLS_DIR = "/wb/.jspace/skills" }`);
});

test("mergeGrokEnv reports already-wired when the value matches exactly", () => {
  const input = `[mcp_servers.gbrain]\nenv = { GBRAIN_SKILLS_DIR = "/wb/.jspace/skills" }\n`;
  const { content, changed } = mergeGrokEnv(input, "/wb/.jspace/skills");
  expect(changed).toBe(false);
  expect(content).toBe(input); // byte-identical
});

test("mergeGrokEnv with no [mcp_servers.gbrain] section -> not changed (never creates the server)", () => {
  const input = `[other]\nx = 1\n`;
  const { changed } = mergeGrokEnv(input, "/wb/.jspace/skills");
  expect(changed).toBe(false);
});

test("wireGrokSkillsDir wires and is idempotent", () => {
  const writes: string[] = [];
  const backups: string[] = [];
  const deps: GrokWireDeps = {
    readFile: () => `[mcp_servers.gbrain]\ncommand = "gbrain"\n`,
    writeFile: (_p, c) => writes.push(c),
    backup: (p) => { backups.push(p); return `${p}.bak`; },
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => "/home/u/jspace/.jspace/skills",
    ensureResolverFile: () => true,
  };
  const r1 = wireGrokSkillsDir(deps, "/home/u/jspace");
  expect(r1.ok).toBe(true);
  if (r1.ok) {
    expect(r1.status).toBe("wired");
    expect(r1.skillsDir).toBe("/home/u/jspace/.jspace/skills");
  }
  expect(writes.length).toBe(1);
  expect(writes[0]).toContain('GBRAIN_SKILLS_DIR = "/home/u/jspace/.jspace/skills"');
  expect(backups.length).toBe(1);
  expect(grokConfigPath("/home/u")).toBe("/home/u/.grok/config.toml");

  // second call with the already-wired content -> already-wired, no write
  deps.readFile = () => writes[0];
  const r2 = wireGrokSkillsDir(deps, "/home/u/jspace");
  expect(r2.ok).toBe(true);
  if (r2.ok) expect(r2.status).toBe("already-wired");
  expect(writes.length).toBe(1); // no second write
});

test("wireGrokSkillsDir without [mcp_servers.gbrain] section -> error, never creates", () => {
  const deps: GrokWireDeps = {
    readFile: () => `[other]\nx = 1\n`,
    writeFile: () => { throw new Error("must not write"); },
    backup: () => null,
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => "/x",
    ensureResolverFile: () => true,
  };
  const r = wireGrokSkillsDir(deps, "/home/u/jspace");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("[mcp_servers.gbrain]");
});

test("wireGrokSkillsDir missing config file -> error", () => {
  const deps: GrokWireDeps = {
    readFile: () => null,
    writeFile: () => { throw new Error("must not write"); },
    backup: () => null,
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => "/x",
    ensureResolverFile: () => true,
  };
  const r = wireGrokSkillsDir(deps, "/home/u/jspace");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("missing");
});

test("dry-run computes the change without writing or backing up", () => {
  const writes: string[] = [];
  const backups: string[] = [];
  const deps: GrokWireDeps = {
    readFile: () => `[mcp_servers.gbrain]\ncommand = "gbrain"\n`,
    writeFile: (_p, c) => writes.push(c),
    backup: (p) => { backups.push(p); return p; },
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => "/x/skills",
    ensureResolverFile: () => true,
    dryRun: true,
  };
  const r = wireGrokSkillsDir(deps, "/home/u/jspace");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.status).toBe("wired");
  expect(writes.length).toBe(0);
  expect(backups.length).toBe(0);
});
