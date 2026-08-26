// cli/commands/workspace.test.ts — B10 CLI combo: upgrade post-steps, cron run
// contract, context envelopes. Injected deps / temp workbench — never touches
// real home or the platform scheduler.
// Run: bun test cli/commands/workspace.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../../application/workspace/init.ts";
import { parse, type CmdContext, type CmdResult, type CommandSpec } from "../../application/commands/command.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "../embed.ts";
import { resolvePath } from "../paths.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { COMMANDS } from "./registry.ts";
import { workspaceUpgradeHandler } from "./workspace.ts";
import type { CronHealthDeps } from "../../application/diagnostics/doctor.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };
const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };

let wb: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-workspace-cli-"));
  initWorkbench(wb, false, initDeps);
});
afterEach(() => {
  rmSync(wb, { recursive: true, force: true });
});

const ctx = (): CmdContext => ({ root: wb, json: false, dryRun: false, dir: undefined, cwd: wb });

async function run(argv: string[]): Promise<CmdResult> {
  const out = parse(argv, ROOT);
  if (out.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(out)}`);
  const r = out as { args: Record<string, unknown>; spec: CommandSpec };
  const c: CmdContext = { root: wb, json: r.args.json === true, dryRun: r.args.dryRun === true, dir: undefined, cwd: wb };
  const res = await r.spec.handler?.(c, r.args);
  return (res as CmdResult | undefined) ?? { lines: [] };
}

function seedCron(id = "test-cron", harness = "claude"): void {
  writeFileSync(
    join(wb, ".jspace", "cron.json"),
    JSON.stringify({
      schema_version: 1,
      crons: [{ id, schedule: "0 21 * * *", harness, prompt: "do the thing", enabled: true }],
    }),
  );
}

const stubCronDeps = (): CronHealthDeps => ({
  loadCrons: () => ({ crons: [] }),
  parseSchedule: () => ({}),
  installedCronIds: () => [],
  linuxCronHealth: () => ({ crontab: "ok", service: "ok" }),
  officialSkillNames: () => [],
});

test("workspace upgrade success appends refresh + doctor lines", () => {
  let refreshCalled = false;
  let doctorCalled = false;
  const r = workspaceUpgradeHandler(ctx(), {}, {
    workspaceUpgrade: () => ({ lines: ["jspace: ok: upgraded"], exitCode: undefined }),
    refreshExternalSkills: () => {
      refreshCalled = true;
      return ["jspace: ok: refreshed user-level skill file(s) in ~/.agents/skills: jspace-use/SKILL.md"];
    },
    doctorWorkbench: (root, _cron) => {
      doctorCalled = true;
      expect(root).toBe(wb);
      return { lines: ["jspace: doctor ok: 0 error(s), 0 warning(s), 0 info"] };
    },
    cronDeps: stubCronDeps(),
    manifest: BUNDLE_MANIFEST,
    assets: {},
    readFile: () => null,
    writeFile: () => {},
  });
  expect(refreshCalled).toBe(true);
  expect(doctorCalled).toBe(true);
  expect(r.lines.join("\n")).toContain("upgraded");
  expect(r.lines.join("\n")).toContain("refreshed user-level skill");
  expect(r.lines.join("\n")).toContain("jspace: doctor ok");
});

test("workspace upgrade dry-run does not append refresh or doctor", () => {
  let refreshCalled = false;
  let doctorCalled = false;
  const r = workspaceUpgradeHandler(ctx(), { dryRun: true }, {
    workspaceUpgrade: () => ({ lines: ["jspace: (dry-run) would upgrade"] }),
    refreshExternalSkills: () => {
      refreshCalled = true;
      return ["should not appear"];
    },
    doctorWorkbench: () => {
      doctorCalled = true;
      return { lines: ["should not appear"] };
    },
    cronDeps: stubCronDeps(),
    manifest: BUNDLE_MANIFEST,
    assets: {},
    readFile: () => null,
    writeFile: () => {},
  });
  expect(refreshCalled).toBe(false);
  expect(doctorCalled).toBe(false);
  expect(r.lines.join("\n")).toContain("dry-run");
  expect(r.lines.join("\n")).not.toContain("should not appear");
});

test("workspace upgrade rollback does not append refresh or doctor", () => {
  let refreshCalled = false;
  let doctorCalled = false;
  const r = workspaceUpgradeHandler(ctx(), { rollback: "journal-1" }, {
    workspaceUpgrade: () => ({ lines: ["jspace: ok: rolled back"] }),
    refreshExternalSkills: () => {
      refreshCalled = true;
      return ["should not appear"];
    },
    doctorWorkbench: () => {
      doctorCalled = true;
      return { lines: ["should not appear"] };
    },
    cronDeps: stubCronDeps(),
    manifest: BUNDLE_MANIFEST,
    assets: {},
    readFile: () => null,
    writeFile: () => {},
  });
  expect(refreshCalled).toBe(false);
  expect(doctorCalled).toBe(false);
  expect(r.lines.join("\n")).toContain("rolled back");
  expect(r.lines.join("\n")).not.toContain("should not appear");
});

test("workspace upgrade failure exitCode skips refresh and doctor", () => {
  let refreshCalled = false;
  workspaceUpgradeHandler(ctx(), {}, {
    workspaceUpgrade: () => ({ lines: ["jspace: error: upgrade failed"], exitCode: 1 }),
    refreshExternalSkills: () => {
      refreshCalled = true;
      return [];
    },
    doctorWorkbench: () => ({ lines: ["should not appear"] }),
    cronDeps: stubCronDeps(),
    manifest: BUNDLE_MANIFEST,
    assets: {},
    readFile: () => null,
    writeFile: () => {},
  });
  expect(refreshCalled).toBe(false);
});

test("cron run --dry-run prints argv contract without executing", async () => {
  seedCron("nightly", "claude");
  const { lines } = await run(["cron", "run", "nightly", "--dry-run"]);
  const text = lines.join("\n");
  expect(text).toContain("jspace: dry-run: would run in");
  expect(text).toContain("claude");
  expect(text).toMatch(/-p|do the thing/);
});

test("cron run --harness override uses the override in dry-run argv", async () => {
  seedCron("nightly", "claude");
  const { lines } = await run(["cron", "run", "nightly", "--dry-run", "--harness", "pi"]);
  const text = lines.join("\n");
  expect(text).toContain("jspace: dry-run: would run in");
  expect(text).toContain("pi");
  expect(text).not.toMatch(/\bclaude\b/);
});

test("context session-start default envelope is hook JSON", async () => {
  const { lines } = await run(["context", "session-start"]);
  expect(lines.length).toBe(1);
  const parsed = JSON.parse(lines[0]) as { hookSpecificOutput?: { hookEventName?: string } };
  expect(parsed.hookSpecificOutput?.hookEventName).toBe("SessionStart");
});

test("context session-start --envelope cursor uses additional_context", async () => {
  const { lines } = await run(["context", "session-start", "--envelope", "cursor"]);
  expect(lines.length).toBe(1);
  const parsed = JSON.parse(lines[0]) as { additional_context?: string };
  expect(typeof parsed.additional_context).toBe("string");
  expect(parsed.additional_context!.length).toBeGreaterThan(0);
  expect((parsed as { hookEventName?: string }).hookEventName).toBeUndefined();
});

test("context pre-compact emits pre-compact envelope JSON", async () => {
  const { lines } = await run(["context", "pre-compact"]);
  expect(lines.length).toBe(1);
  const parsed = JSON.parse(lines[0]) as { hookSpecificOutput?: { hookEventName?: string } };
  expect(parsed.hookSpecificOutput?.hookEventName).toBe("PreCompact");
});
