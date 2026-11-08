// application/gbrain/grok-wiring.test.ts — Grok MCP config wiring (TOML
// read-modify-write). Bun.TOML parses but cannot stringify, so the merge is a
// targeted line edit that preserves every byte outside the env inline table.
// Run: bun test application/gbrain/grok-wiring.test.ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { mergeGrokEnv, wireGrokSkillsDir, grokConfigPath, type GrokWireDeps } from "./grok-wiring.ts";

const SKILLS = "/wb/.jspace/skills";
const ENV = { GBRAIN_SKILLS_DIR: SKILLS, GBRAIN_SURFACE: "starter" };

test("mergeGrokEnv adds both gbrain keys to an existing env inline table", () => {
  const input = `[model]\nprovider = "x"\n\n[mcp_servers.gbrain]\ncommand = "gbrain"\nargs = ["serve"]\nenv = { OTHER = "keep" }\n`;
  const { content, changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(true);
  expect(content).toContain('OTHER = "keep"');
  expect(content).toContain(`GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}`);
  expect(content).toContain('GBRAIN_SURFACE = "starter"');
  expect(content).toContain("[model]"); // unrelated sections preserved
  expect(content).toContain("[mcp_servers.gbrain]"); // header preserved
});

test("mergeGrokEnv replaces existing skills-dir and surface values", () => {
  const input = `[mcp_servers.gbrain]\ncommand = "gbrain"\nenv = { GBRAIN_SKILLS_DIR = "/old/path", GBRAIN_SURFACE = "full" }\n`;
  const { content, changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(true);
  expect(content).toContain(`GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}`);
  expect(content).toContain('GBRAIN_SURFACE = "starter"');
  expect(content).not.toContain("/old/path");
  expect(content).not.toContain('"full"');
});

test("mergeGrokEnv adds an env line when the section has none", () => {
  const input = `[mcp_servers.gbrain]\ncommand = "gbrain"\nargs = ["serve"]\n`;
  const { content, changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(true);
  expect(content).toContain('env = {');
  expect(content).toContain(`GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}`);
  expect(content).toContain('GBRAIN_SURFACE = "starter"');
});

test("mergeGrokEnv reports already-wired when both values match exactly", () => {
  const input = `[mcp_servers.gbrain]\nenv = { GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}, GBRAIN_SURFACE = "starter" }\n`;
  const { content, changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(false);
  expect(content).toBe(input); // byte-identical
});

test("mergeGrokEnv rewires a skills-dir-only config and adds the surface", () => {
  const input = `[mcp_servers.gbrain]\nenv = { GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)} }\n`;
  const { content, changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(true);
  expect(content).toContain('GBRAIN_SURFACE = "starter"');
});

test("mergeGrokEnv with no [mcp_servers.gbrain] section -> not changed (never creates the server)", () => {
  const input = `[other]\nx = 1\n`;
  const { changed } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(false);
});

test("mergeGrokEnv refuses a multiline inline table instead of pretending already-wired", () => {
  const input = `[mcp_servers.gbrain]\nenv = {\n  OTHER = "keep"\n}\n`;
  const { changed, unsupported } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(false);
  expect(unsupported).toBe(true);
});

test("mergeGrokEnv refuses a [mcp_servers.gbrain.env] sub-table", () => {
  const input = `[mcp_servers.gbrain]\n[mcp_servers.gbrain.env]\nGBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}\n`;
  const { changed, unsupported } = mergeGrokEnv(input, ENV);
  expect(changed).toBe(false);
  expect(unsupported).toBe(true);
});

test("wireGrokSkillsDir wires both keys and is idempotent", () => {
  const writes: string[] = [];
  const backups: string[] = [];
  const deps: GrokWireDeps = {
    readFile: () => `[mcp_servers.gbrain]\ncommand = "gbrain"\n`,
    writeFile: (_p, c) => writes.push(c),
    backup: (p) => { backups.push(p); return `${p}.bak`; },
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => SKILLS,
    ensureResolverFile: () => true,
  };
  const r1 = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
  expect(r1.ok).toBe(true);
  if (r1.ok) {
    expect(r1.status).toBe("wired");
    expect(r1.skillsDir).toBe(SKILLS);
  }
  expect(writes.length).toBe(1);
  expect(writes[0]).toContain(`GBRAIN_SKILLS_DIR = ${JSON.stringify(SKILLS)}`);
  expect(writes[0]).toContain('GBRAIN_SURFACE = "starter"');
  expect(backups.length).toBe(1);
  expect(grokConfigPath("/home/u")).toBe(join("/home/u", ".grok/config.toml"));

  // second call with the already-wired content -> already-wired, no write
  deps.readFile = () => writes[0];
  const r2 = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
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
  const r = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
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
  const r = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("missing");
});

test("wireGrokSkillsDir multiline env -> unsupported-env-shape with manual fix", () => {
  const deps: GrokWireDeps = {
    readFile: () => `[mcp_servers.gbrain]\nenv = {\n  OTHER = "keep"\n}\n`,
    writeFile: () => { throw new Error("must not write"); },
    backup: () => null,
    homedir: () => "/home/u",
    resolveWorkbenchSkillsDir: () => SKILLS,
    ensureResolverFile: () => true,
  };
  const r = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.status).toBe("unsupported-env-shape");
    expect(r.reason).toContain("GBRAIN_SURFACE");
  }
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
  const r = wireGrokSkillsDir(deps, "/home/u/jspace", "starter");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.status).toBe("wired");
  expect(writes.length).toBe(0);
  expect(backups.length).toBe(0);
});
