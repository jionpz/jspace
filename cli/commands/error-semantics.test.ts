// cli/commands/error-semantics.test.ts — issue #8 #9: skills/harness/gbrain
// handlers must surface business/IO failures as errors + exit 1 (never a silent
// exit 0 warning), and error text belongs in `errors` (stderr) not stdout `lines`.
// Deps are injected so a real home/fs is never touched.
// Run: bun test cli/commands/error-semantics.test.ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { ArgError, parse, type CmdContext, type CommandSpec } from "../../application/commands/command.ts";
import type { InstallDeps } from "../../application/skills/install.ts";
import type { GrokWireDeps } from "../../application/gbrain/grok-wiring.ts";
import type { WireDeps } from "../../application/gbrain/wiring.ts";
import { COMMANDS } from "./registry.ts";
import { installHandler } from "./skills.ts";
import { grokWireHandler } from "./harness.ts";
import { wireHandler } from "./gbrain.ts";

const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };
const tmp = "/tmp/jspace-error-semantics"; // never written to — deps are stubbed
const ctx = (over: Partial<CmdContext> = {}): CmdContext => ({ json: false, dryRun: false, dir: undefined, root: tmp, cwd: tmp, ...over });

test("skills install: write failure -> errors + exit 1, not a silent warning", () => {
  // handler iterates the REAL bundled skill names (SKILLS_MANIFEST), so the
  // injected asset key must match one of them for installSkills to reach writeFile.
  const deps: InstallDeps = {
    assetKeys: () => ["skills/jspace-use/SKILL.md"],
    assetContent: () => "# test",
    userSkillsRoot: () => join(tmp, ".agents", "skills"),
    exists: () => false,
    readFile: () => null,
    writeFile: () => {
      throw new Error("EACCES: permission denied");
    },
    dryRun: false,
  };
  const r = installHandler(ctx(), { refresh: false }, deps);
  expect(r.exitCode).toBe(1);
  expect(r.errors?.[0]).toContain("skills install: EACCES");
  expect(r.warnings ?? []).toHaveLength(0);
  expect(r.lines).toHaveLength(0);
});

test("skills install: dry-run success path has no errors/warnings", () => {
  const deps: InstallDeps = {
    assetKeys: () => ["skills/jspace-use/SKILL.md"],
    assetContent: () => "# test",
    userSkillsRoot: () => join(tmp, ".agents", "skills"),
    exists: () => false,
    readFile: () => null,
    writeFile: () => {
      throw new Error("must not write in dry-run");
    },
    dryRun: true,
  };
  const r = installHandler(ctx({ dryRun: true }), { refresh: false }, deps);
  expect(r.exitCode).toBeUndefined();
  expect(r.errors ?? []).toHaveLength(0);
  expect(r.warnings ?? []).toHaveLength(0);
  expect(r.lines.join("\n")).toContain("(dry-run)");
});

test("skills install: covers machine-global skills (manifest.global, issue #37)", () => {
  // The handler must request workbench AND global names; with a union key set
  // (ASSETS ∪ GLOBAL_SKILLS, as wired by embeddedSkillAssets), harness-config
  // files land under ~/.agents/skills/ like any official skill.
  const written = new Map<string, string>();
  const deps: InstallDeps = {
    assetKeys: () => [
      "skills/jspace-use/SKILL.md",
      "skills/harness-config/SKILL.md",
      "skills/harness-config/scripts/detect.sh",
    ],
    assetContent: () => "# test",
    userSkillsRoot: () => join(tmp, ".agents", "skills"),
    exists: () => false,
    readFile: () => null,
    writeFile: (p, c) => void written.set(p, c),
    dryRun: false,
  };
  const r = installHandler(ctx(), { refresh: false }, deps);
  expect(r.exitCode).toBeUndefined();
  expect(r.errors ?? []).toHaveLength(0);
  expect([...written.keys()].some((k) => k.endsWith("harness-config/SKILL.md"))).toBe(true);
  expect([...written.keys()].some((k) => k.endsWith("harness-config/scripts/detect.sh"))).toBe(true);
  expect(r.lines.join("\n")).toContain("harness-config@");
});

test("gbrain wire: write failure -> errors + exit 1, not a silent warning", () => {
  const deps: WireDeps = {
    readJson: () => ({ mcpServers: { gbrain: { command: "gbrain", env: {} } } }),
    writeJson: () => {
      throw new Error("EACCES: permission denied");
    },
    backup: () => null,
    homedir: () => tmp,
    resolveWorkbenchSkillsDir: (root) => join(root, ".jspace", "skills"),
    ensureResolverFile: () => true,
    dryRun: false,
  };
  const r = wireHandler(ctx(), deps);
  expect(r.exitCode).toBe(1);
  expect(r.errors?.[0]).toContain("gbrain wire: EACCES");
  expect(r.warnings ?? []).toHaveLength(0);
  expect(r.lines).toHaveLength(0);
});

test("gbrain wire: no-claude-json status -> errors (not stdout lines) + exit 1", () => {
  const deps: WireDeps = {
    readJson: () => null,
    writeJson: () => {
      throw new Error("unreachable");
    },
    backup: () => null,
    homedir: () => tmp,
    resolveWorkbenchSkillsDir: (root) => join(root, ".jspace", "skills"),
    ensureResolverFile: () => true,
    dryRun: false,
  };
  const r = wireHandler(ctx(), deps);
  expect(r.exitCode).toBe(1);
  expect(r.errors?.length).toBeGreaterThan(0);
  expect(r.lines).toHaveLength(0); // error text never on stdout
});

test("harness wire grok: write failure -> errors + exit 1, not a silent warning", () => {
  const deps: GrokWireDeps = {
    readFile: () => "[mcp_servers.gbrain]\ncommand = 'gbrain'\n",
    writeFile: () => {
      throw new Error("EACCES: permission denied");
    },
    backup: () => null,
    homedir: () => tmp,
    resolveWorkbenchSkillsDir: (root) => join(root, ".jspace", "skills"),
    ensureResolverFile: () => true,
    dryRun: false,
  };
  const r = grokWireHandler(ctx(), deps);
  expect(r.exitCode).toBe(1);
  expect(r.errors?.[0]).toContain("harness wire grok: EACCES");
  expect(r.warnings ?? []).toHaveLength(0);
  expect(r.lines).toHaveLength(0);
});

test("harness wire grok: missing config status -> errors (not stdout lines) + exit 1", () => {
  const deps: GrokWireDeps = {
    readFile: () => null,
    writeFile: () => {
      throw new Error("unreachable");
    },
    backup: () => null,
    homedir: () => tmp,
    resolveWorkbenchSkillsDir: (root) => join(root, ".jspace", "skills"),
    ensureResolverFile: () => true,
    dryRun: false,
  };
  const r = grokWireHandler(ctx(), deps);
  expect(r.exitCode).toBe(1);
  expect(r.errors?.length).toBeGreaterThan(0);
  expect(r.lines).toHaveLength(0);
});

test("harness wire: unsupported --harness value is an argument error (ArgError exit 2)", () => {
  let caught: ArgError | undefined;
  try {
    parse(["harness", "wire", "--harness", "codex"], ROOT);
  } catch (e) {
    caught = e instanceof ArgError ? e : undefined;
  }
  expect(caught).toBeDefined();
  expect(caught!.message).toContain("codex is a cron-compat entry, not a session harness");
  // main.ts maps ArgError to process.exitCode = 2 (see cli/main.ts catch)
});

test("harness wire: missing --harness stays an argument error (exit 2)", () => {
  expect(() => parse(["harness", "wire"], ROOT)).toThrow(ArgError);
});
