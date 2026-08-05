// cli/handler-wiring.test.ts — CommandSpec handler wiring end-to-end: parse →
// handler against a real temp workbench. Exercises the s()/b() arg-coercion
// helpers and use-case binding for command families that avoid the platform
// scheduler (which spawns real commands — never in tests). The review flagged
// this layer as almost entirely unexercised.
// Run: bun test cli/handler-wiring.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../application/workspace/init.ts";
import { loadCrons } from "../application/automation/definitions.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "./embed.ts";
import { resolvePath } from "./paths.ts";
import { BUNDLE_MANIFEST } from "./manifest.generated.ts";
import { parse, type CmdContext, type CmdResult, type CommandSpec } from "../application/commands/command.ts";
import { COMMANDS } from "./commands/registry.ts";

const initDeps = { resolvePath, expandTilde, isCompiled, devRoot, materialize: materializeTree, manifest: BUNDLE_MANIFEST };
const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };

let wb: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-handler-"));
  initWorkbench(wb, false, initDeps);
});
afterEach(() => {
  rmSync(wb, { recursive: true, force: true });
});

function seedCrons(enabled: boolean): void {
  writeFileSync(
    join(wb, ".jspace", "cron.json"),
    JSON.stringify({ version: 1, crons: [{ id: "a", schedule: "0 21 * * *", harness: "claude", prompt: "p", enabled }] }),
  );
}

function run(argv: string[]): { lines: string[]; data?: unknown } {
  const out = parse(argv, ROOT);
  if (out.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(out)}`);
  const r = out as { args: Record<string, unknown>; spec: CommandSpec };
  const ctx: CmdContext = { root: wb, json: false, dryRun: false, dir: undefined, cwd: wb };
  const res = r.spec.handler?.(ctx, r.args) as CmdResult | undefined;
  return { lines: res?.lines ?? [], data: res?.data };
}

test("cron enable/disable wire through the parser to cronSetEnabled", () => {
  seedCrons(false);
  run(["cron", "enable", "a"]);
  expect(loadCrons(wb).crons[0].enabled).toBe(true);
  run(["cron", "disable", "a"]);
  expect(loadCrons(wb).crons[0].enabled).toBe(false);
});

test("cron list --json returns the crons via the parser (b() coercion)", () => {
  seedCrons(true);
  const { data } = run(["cron", "list", "--json"]);
  expect((data as { crons: unknown[] }).crons).toHaveLength(1);
});

test("unknown cron subcommand fails at the parser (ArgError, not a handler crash)", () => {
  expect(() => parse(["cron", "nope"], ROOT)).toThrow();
});

test("ingest list --json on a fresh workbench is a stable empty shape", () => {
  const { data } = run(["ingest", "list", "--json"]);
  const shape = data as { journals: unknown[] };
  expect(Array.isArray(shape.journals)).toBe(true);
  expect(shape.journals).toHaveLength(0);
});
