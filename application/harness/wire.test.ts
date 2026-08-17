// application/harness/wire.test.ts — unified per-harness gbrain MCP wiring.
// All backends are exercised with injected fs deps (nothing touches a real home
// dir): dry-run plans, idempotent re-run, merge-preserves-fields (opencode.json
// can carry provider apiKeys), backup-on-write, no-gbrain-bin, unsupported.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { wireHarness, describeCapability, type HarnessWireDeps, type WirePlan } from "./wire.ts";

const HOME = "/Users/t";
const ROOT = "/Users/t/wb";
const WB_SKILLS = join(ROOT, ".jspace", "skills");

interface Ctx {
  files: Map<string, string>;
  writes: { path: string; content: string }[];
  backups: string[];
  deps: HarnessWireDeps;
}

function makeCtx(overrides: { files?: Record<string, string>; dryRun?: boolean; gbrainBin?: string | null } = {}): Ctx {
  const ctx: Ctx = {
    files: new Map(Object.entries(overrides.files ?? {})),
    writes: [],
    backups: [],
    deps: {
      readFile: (p) => ctx.files.get(p) ?? null,
      writeFile: (p, content) => ctx.writes.push({ path: p, content }),
      backup: (p) => {
        ctx.backups.push(p);
        return `${p}.jspace-bak`;
      },
      homedir: () => HOME,
      resolveWorkbenchSkillsDir: () => WB_SKILLS,
      ensureResolverFile: () => true,
      resolveGbrainBin: () => overrides.gbrainBin === undefined ? "/usr/local/bin/gbrain" : overrides.gbrainBin,
      dryRun: overrides.dryRun ?? false,
    },
  };
  return ctx;
}

function planPaths(plans: WirePlan[]): string[] {
  return plans.map((p) => p.path);
}

describe("harness wire — dispatch", () => {
  test("unknown harness fails loud", () => {
    const { deps } = makeCtx();
    const r = wireHarness("codex", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("unsupported");
  });

  test("describeCapability prints honest boundary lines", () => {
    const cursor = describeCapability("cursor");
    expect(cursor[0]).toContain("IDE-only");
    expect(cursor[0]).toContain("NOT a cron harness");
    const grok = describeCapability("grok");
    expect(grok[0]).toContain("cron harness=grok");
  });
});

describe("harness wire — cursor (MCP-list create/merge)", () => {
  const CURSOR_MCP = join(HOME, ".cursor", "mcp.json");

  test("dry-run plans ~/.cursor/mcp.json without writing", () => {
    const { deps, writes, backups } = makeCtx({ dryRun: true });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("wired");
    expect(planPaths(r.plans)).toEqual([CURSOR_MCP]);
    expect(writes.length).toBe(0);
    expect(backups.length).toBe(0);
    const plan = JSON.parse(r.plans[0].content) as Record<string, any>;
    expect(plan.mcpServers.gbrain.command).toBe("/usr/local/bin/gbrain");
    expect(plan.mcpServers.gbrain.args).toEqual(["serve"]);
    expect(plan.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(WB_SKILLS);
  });

  test("real wire writes + backs up the file", () => {
    const { deps, writes, backups } = makeCtx();
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    expect(writes.length).toBe(1);
    expect(writes[0].path).toBe(CURSOR_MCP);
    expect(backups).toEqual([CURSOR_MCP]);
  });

  test("idempotent: already-correct server → already-wired, no write", () => {
    const existing = JSON.stringify({
      mcpServers: { gbrain: { command: "/usr/local/bin/gbrain", args: ["serve"], env: { GBRAIN_SKILLS_DIR: WB_SKILLS } } },
    });
    const { deps, writes } = makeCtx({ files: { [CURSOR_MCP]: existing }, dryRun: true });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("already-wired");
    expect(r.plans).toEqual([]);
    expect(writes.length).toBe(0);
  });

  test("merge preserves unrelated MCP servers and fields", () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { command: "some-tool", args: [] },
        gbrain: { command: "/old/bin", args: ["serve"], env: { KEEP: "me" } },
      },
    });
    const { deps } = makeCtx({ files: { [CURSOR_MCP]: existing }, dryRun: true });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    const doc = JSON.parse(r.ok && r.plans[0] ? r.plans[0].content : "{}") as Record<string, any>;
    expect(doc.mcpServers.other.command).toBe("some-tool"); // unrelated server untouched
    expect(doc.mcpServers.gbrain.command).toBe("/usr/local/bin/gbrain"); // bin refreshed
    expect(doc.mcpServers.gbrain.env.KEEP).toBe("me"); // other env vars preserved
    expect(doc.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(WB_SKILLS);
  });

  test("no gbrain binary → no-gbrain-bin failure (no guess)", () => {
    const { deps } = makeCtx({ gbrainBin: null });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("no-gbrain-bin");
  });

  test("malformed existing mcp.json → invalid-config", () => {
    const { deps } = makeCtx({ files: { [CURSOR_MCP]: "{ not json" }, dryRun: true });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("invalid-config");
  });

  test("workbench session-start seed missing → sessionStart missing + upgrade hint", () => {
    const { deps } = makeCtx({ dryRun: true });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionStart?.status).toBe("missing");
    expect(r.sessionStart?.notes.join("\n")).toContain("workspace upgrade");
  });

  test("workbench session-start seed already wired → sessionStart already-wired", () => {
    const { deps } = makeCtx({
      files: { [join(ROOT, ".cursor", "hooks.json")]: JSON.stringify({ hooks: { sessionStart: [{ command: "jspace context session-start --envelope cursor" }] } }) },
      dryRun: true,
    });
    const r = wireHarness("cursor", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionStart?.status).toBe("already-wired");
  });
});

describe("harness wire — opencode (mcp.<name> local-server shape)", () => {
  const OPENCODE_JSON = join(HOME, ".config", "opencode", "opencode.json");

  test("dry-run writes mcp.gbrain with local-server shape + environment", () => {
    const { deps, writes } = makeCtx({ dryRun: true });
    const r = wireHarness("opencode", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planPaths(r.plans)).toEqual([OPENCODE_JSON]);
    expect(writes.length).toBe(0);
    const doc = JSON.parse(r.plans[0].content) as Record<string, any>;
    expect(doc.mcp.gbrain.type).toBe("local");
    expect(doc.mcp.gbrain.command).toEqual(["/usr/local/bin/gbrain", "serve"]);
    expect(doc.mcp.gbrain.enabled).toBe(true);
    expect(doc.mcp.gbrain.environment.GBRAIN_SKILLS_DIR).toBe(WB_SKILLS);
  });

  test("merge preserves unrelated config (e.g. provider apiKey) — never whole-file rewrite", () => {
    const existing = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: { opencodego: { apiKey: "sk-secret", baseURL: "https://example.com" } },
      mcp: { context7: { type: "local", command: ["npx", "-y", "context7"], enabled: true } },
    });
    const { deps } = makeCtx({ files: { [OPENCODE_JSON]: existing }, dryRun: true });
    const r = wireHarness("opencode", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(r.plans[0].content) as Record<string, any>;
    expect(doc.provider.opencodego.apiKey).toBe("sk-secret"); // preserved
    expect(doc.mcp.context7.command).toEqual(["npx", "-y", "context7"]); // preserved
    expect(doc.mcp.gbrain.environment.GBRAIN_SKILLS_DIR).toBe(WB_SKILLS);
  });

  test("idempotent opencode re-run → already-wired", () => {
    const existing = JSON.stringify({
      mcp: {
        gbrain: {
          type: "local",
          command: ["/usr/local/bin/gbrain", "serve"],
          enabled: true,
          environment: { GBRAIN_SKILLS_DIR: WB_SKILLS },
        },
      },
    });
    const { deps, writes } = makeCtx({ files: { [OPENCODE_JSON]: existing }, dryRun: true });
    const r = wireHarness("opencode", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("already-wired");
    expect(writes.length).toBe(0);
  });

  test("no gbrain binary → no-gbrain-bin", () => {
    const { deps } = makeCtx({ gbrainBin: null });
    const r = wireHarness("opencode", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("no-gbrain-bin");
  });
});

describe("harness wire — pi (MCP-list, ~/.pi/agent/mcp.json)", () => {
  const PI_MCP = join(HOME, ".pi", "agent", "mcp.json");
  const PI_EXT = join(HOME, ".pi", "agent", "extensions", "jspace", "index.ts");

  test("dry-run writes claude-shaped gbrain server", () => {
    const { deps, writes } = makeCtx({ dryRun: true });
    const r = wireHarness("pi", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planPaths(r.plans)).toEqual([PI_MCP]);
    expect(writes.length).toBe(0);
    const doc = JSON.parse(r.plans[0].content) as Record<string, any>;
    expect(doc.mcpServers.gbrain.command).toBe("/usr/local/bin/gbrain");
    expect(doc.mcpServers.gbrain.args).toEqual(["serve"]);
    expect(doc.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(WB_SKILLS);
  });

  test("dry-run also plans the Pi session-start extension", () => {
    const { deps, writes } = makeCtx({ dryRun: true });
    const r = wireHarness("pi", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionStart?.status).toBe("wired");
    expect(r.sessionStart?.plans).toHaveLength(1);
    expect(r.sessionStart?.plans[0].path).toBe(PI_EXT);
    expect(r.sessionStart?.plans[0].content).toContain("jspace context session-start");
    expect(writes.length).toBe(0);
  });

  test("real wire writes MCP + Pi session-start extension", () => {
    const { deps, writes, backups } = makeCtx();
    const r = wireHarness("pi", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(writes.map((w) => w.path).sort()).toEqual([PI_EXT, PI_MCP].sort());
    expect(r.sessionStart?.status).toBe("wired");
    expect(backups).toEqual([PI_MCP]); // missing extension has no backup
  });

  test("pi session-start extension already wired → already-wired, no extra write", () => {
    const existing = "// jspace context session-start\nconst x = 1;\n";
    const { deps, writes } = makeCtx({
      files: { [PI_EXT]: existing, [PI_MCP]: "{}" },
      dryRun: true,
    });
    const r = wireHarness("pi", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionStart?.status).toBe("already-wired");
    expect(r.sessionStart?.plans).toEqual([]);
    expect(writes.length).toBe(0);
  });

  test("idempotent pi re-run → already-wired", () => {
    const existing = JSON.stringify({
      mcpServers: { gbrain: { command: "/usr/local/bin/gbrain", args: ["serve"], env: { GBRAIN_SKILLS_DIR: WB_SKILLS } } },
    });
    const { deps, writes } = makeCtx({ files: { [PI_MCP]: existing }, dryRun: true });
    const r = wireHarness("pi", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("already-wired");
    expect(writes.length).toBe(0);
  });
});

describe("harness wire — claude (reuses application/gbrain/wiring.ts)", () => {
  const CLAUDE_JSON = join(HOME, ".claude.json");

  test("dry-run: existing gbrain server without env → wired plan", () => {
    const existing = JSON.stringify({ mcpServers: { gbrain: { command: "gbrain", args: ["serve"] } } });
    const { deps, writes } = makeCtx({ files: { [CLAUDE_JSON]: existing }, dryRun: true });
    const r = wireHarness("claude", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("wired");
    expect(writes.length).toBe(0); // dry-run
    // wireSkillsDir returns plans:[] today; the CLI surfaces the skillsDir in its message
    expect(r.skillsDir).toBe(WB_SKILLS);
  });

  test("already-wired claude → already-wired, no write", () => {
    const existing = JSON.stringify({ mcpServers: { gbrain: { command: "gbrain", args: ["serve"], env: { GBRAIN_SKILLS_DIR: WB_SKILLS } } } });
    const { deps, writes } = makeCtx({ files: { [CLAUDE_JSON]: existing }, dryRun: true });
    const r = wireHarness("claude", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("already-wired");
    expect(writes.length).toBe(0);
  });

  test("no gbrain server in ~/.claude.json → missing-config (never creates)", () => {
    const existing = JSON.stringify({ mcpServers: { other: {} } });
    const { deps } = makeCtx({ files: { [CLAUDE_JSON]: existing }, dryRun: true });
    const r = wireHarness("claude", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("missing-config");
  });

  test("missing ~/.claude.json → missing-config", () => {
    const { deps } = makeCtx();
    const r = wireHarness("claude", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("missing-config");
  });
});

describe("harness wire — grok (reuses application/gbrain/grok-wiring.ts)", () => {
  const GROK_TOML = join(HOME, ".grok", "config.toml");

  test("dry-run: existing [mcp_servers.gbrain] without env → wired", () => {
    const toml = "[mcp_servers.gbrain]\ncommand = \"gbrain\"\nargs = [\"serve\"]\n";
    const { deps, writes } = makeCtx({ files: { [GROK_TOML]: toml }, dryRun: true });
    const r = wireHarness("grok", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("wired");
    expect(writes.length).toBe(0);
  });

  test("already-wired grok → already-wired", () => {
    const toml = `[mcp_servers.gbrain]\ncommand = "gbrain"\nenv = { GBRAIN_SKILLS_DIR = "${WB_SKILLS}" }\n`;
    const { deps, writes } = makeCtx({ files: { [GROK_TOML]: toml }, dryRun: true });
    const r = wireHarness("grok", deps, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("already-wired");
    expect(writes.length).toBe(0);
  });

  test("missing grok config → missing-config", () => {
    const { deps } = makeCtx();
    const r = wireHarness("grok", deps, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("missing-config");
  });
});
