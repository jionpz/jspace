// cli/commands/gbrain-alias.test.ts — `gbrain wire` must be a *true* alias for
// `harness wire --harness claude`: same temporary HOME/workbench, identical
// dry-run plan text, identical written target bytes, identical failure exit
// code. If the alias ever grows its own writer/backup path again, these diverge.
// Deps are injected — a real home/fs is never touched.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CmdContext } from "../../application/commands/command.ts";
import type { BackupResult, HarnessWireDeps } from "../../application/harness/wire.ts";
import { runHarnessWire } from "./harness.ts";
import { wireHandler as gbrainWire } from "./gbrain.ts";

const HOME = "/Users/t";
const ROOT = "/Users/t/wb";
const CLAUDE_JSON = join(HOME, ".claude.json");

function ctx(dryRun: boolean): CmdContext {
  return { json: false, dryRun, dir: undefined, root: ROOT, cwd: ROOT };
}

interface Sandbox {
  deps: HarnessWireDeps;
  files: Map<string, string>;
  writes: { path: string; content: string }[];
  backups: string[];
}

function sandbox(seed: Record<string, string> = {}): Sandbox {
  const files = new Map(Object.entries(seed));
  const writes: { path: string; content: string }[] = [];
  const backups: string[] = [];
  const deps: HarnessWireDeps = {
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, content) => {
      writes.push({ path: p, content });
      files.set(p, content);
    },
    backup: (p): BackupResult => {
      backups.push(p);
      return { ok: true, path: `${p}.jspace-bak` };
    },
    homedir: () => HOME,
    resolveWorkbenchSkillsDir: (r) => join(r, ".jspace", "skills"),
    ensureResolverFile: () => true,
    resolveGbrainBin: () => "/usr/local/bin/gbrain",
    dryRun: false,
  };
  return { deps, files, writes, backups };
}

const gbrainServerWithoutEnv = JSON.stringify({
  mcpServers: { gbrain: { command: "gbrain", args: ["serve"] }, other: { command: "x" } },
});

describe("gbrain wire ≡ harness wire --harness claude", () => {
  test("dry-run: identical output text, no writes on either path", () => {
    const a = sandbox({ [CLAUDE_JSON]: gbrainServerWithoutEnv });
    const b = sandbox({ [CLAUDE_JSON]: gbrainServerWithoutEnv });
    a.deps.dryRun = true;
    b.deps.dryRun = true;

    const alias = gbrainWire(ctx(true), a.deps);
    const canonical = runHarnessWire(ctx(true), "claude", { deps: b.deps });

    expect(alias.exitCode).toBeUndefined();
    expect(alias.lines).toEqual(canonical.lines);
    expect(alias.lines.join("\n")).toContain("(dry-run)");
    expect(alias.lines.join("\n")).toContain(join(ROOT, ".jspace", "skills"));
    expect(a.writes).toHaveLength(0);
    expect(b.writes).toHaveLength(0);
  });

  test("real write: identical target bytes, unrelated keys preserved", () => {
    const a = sandbox({ [CLAUDE_JSON]: gbrainServerWithoutEnv });
    const b = sandbox({ [CLAUDE_JSON]: gbrainServerWithoutEnv });

    const alias = gbrainWire(ctx(false), a.deps);
    const canonical = runHarnessWire(ctx(false), "claude", { deps: b.deps });

    expect(alias.exitCode).toBeUndefined();
    expect(alias.lines).toEqual(canonical.lines);
    expect(a.writes.map((w) => [w.path, w.content])).toEqual(b.writes.map((w) => [w.path, w.content]));
    const written = JSON.parse(a.files.get(CLAUDE_JSON)!) as Record<string, any>;
    expect(written.mcpServers.gbrain.env.GBRAIN_SKILLS_DIR).toBe(join(ROOT, ".jspace", "skills"));
    expect(written.mcpServers.other).toEqual({ command: "x" });
    expect(a.backups).toEqual(b.backups);
  });

  test("failure: same exit code + non-empty stderr semantics", () => {
    const invalid = "{ not json";
    const a = sandbox({ [CLAUDE_JSON]: invalid });
    const b = sandbox({ [CLAUDE_JSON]: invalid });

    const alias = gbrainWire(ctx(false), a.deps);
    const canonical = runHarnessWire(ctx(false), "claude", { deps: b.deps });

    expect(alias.exitCode).toBe(1);
    expect(canonical.exitCode).toBe(1);
    expect(alias.errors?.length).toBeGreaterThan(0);
    expect(canonical.errors?.length).toBeGreaterThan(0);
    expect(alias.lines).toHaveLength(0);
    expect(a.writes).toHaveLength(0);
    expect(a.files.get(CLAUDE_JSON)).toBe(invalid);
  });
});
