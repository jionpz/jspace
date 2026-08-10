// cli/handler-wiring.test.ts — CommandSpec handler wiring end-to-end: parse →
// handler against a real temp workbench. Exercises the s()/b() arg-coercion
// helpers and use-case binding for command families that avoid the platform
// scheduler (which spawns real commands — never in tests). The review flagged
// this layer as almost entirely unexercised.
// Run: bun test cli/handler-wiring.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../application/workspace/init.ts";
import { loadCrons } from "../application/automation/definitions.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "./embed.ts";
import { resolvePath } from "./paths.ts";
import { BUNDLE_MANIFEST } from "./manifest.generated.ts";
import { parse, type CmdContext, type CmdResult, type CommandSpec } from "../application/commands/command.ts";
import { COMMANDS } from "./commands/registry.ts";
import { invocationArgv } from "../application/automation/invocation.ts";
import { CliError } from "../core/shared/errors.ts";

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
    JSON.stringify({ schema_version: 1, crons: [{ id: "a", schedule: "0 21 * * *", harness: "claude", prompt: "p", enabled }] }),
  );
}

function run(argv: string[]): { lines: string[]; data?: unknown; exitCode?: number } {
  const out = parse(argv, ROOT);
  if (out.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(out)}`);
  const r = out as { args: Record<string, unknown>; spec: CommandSpec };
  const ctx: CmdContext = { root: wb, json: r.args.json === true, dryRun: false, dir: undefined, cwd: wb };
  const res = r.spec.handler?.(ctx, r.args) as CmdResult | undefined;
  return { lines: res?.lines ?? [], data: res?.data, exitCode: res?.exitCode };
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

test("cron failures via the parser: needs attention -> exitCode 1 + data", () => {
  seedCrons(true);
  mkdirSync(join(wb, ".jspace", "state", "incidents"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "state", "incidents", "a-failed.json"),
    JSON.stringify({ id: "a-failed", cronId: "a", failureClass: "failed", status: "open", openedAt: "2026-08-03T12:00:00", evidence: [] }),
  );
  const { exitCode, data } = run(["cron", "failures"]);
  expect(exitCode).toBe(1); // SessionStart hook contract
  const summary = (data as { summary: { needs_attention: number } }).summary;
  expect(summary.needs_attention).toBe(1);
});

test("cron check (alias) mirrors failures; clean -> no exitCode", () => {
  seedCrons(true);
  const { exitCode } = run(["cron", "check"]);
  expect(exitCode).toBeUndefined();
});

test("cron status via the parser returns per-cron lines", () => {
  seedCrons(true);
  const { lines } = run(["cron", "status"]);
  expect(lines.join("\n")).toContain("a: never run");
});

test("invocationArgv round-trips through the real cron run parser (batch-identity audit)", () => {
  const cases = [
    { workbench: "/some/wb", cronId: "nightly" },
    { workbench: "/some wb with spaces", cronId: "a", force: true, timeoutSec: 900 },
  ];
  for (const inv of cases) {
    const out = parse(invocationArgv(inv), ROOT);
    if (out.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(out)}`);
    const r = out as { spec: CommandSpec; args: Record<string, unknown> };
    expect(r.spec.name).toBe("run");
    expect(r.args.id).toBe(inv.cronId);
    expect(r.args.dir).toBe(inv.workbench);
    expect(r.args.force).toBe(inv.force ?? false);
    expect(r.args.timeout).toBe(inv.timeoutSec === undefined ? undefined : String(inv.timeoutSec));
  }
});

test("init --dir wires --dir into ctx and the positional target stays legacy-compatible", () => {
  const viaDir = parse(["init", "--dir", "/some/dir"], ROOT);
  if (viaDir.kind !== "run") throw new Error("expected run");
  expect(viaDir.dir).toBe("/some/dir");
  expect((viaDir.args as { target?: unknown }).target).toBeUndefined();

  const viaPos = parse(["init", "/legacy"], ROOT);
  if (viaPos.kind !== "run") throw new Error("expected run");
  expect((viaPos.args as { target: unknown }).target).toBe("/legacy");
  expect(viaPos.dir).toBeUndefined();
});

test("init --dir and positional together -> CliError exit 2 (ambiguous)", () => {
  const out = parse(["init", "--dir", "/x", "/y"], ROOT);
  if (out.kind !== "run") throw new Error("expected run");
  const ctx: CmdContext = { root: "/x", json: false, dryRun: false, dir: "/x", cwd: "/" };
  let caught: CliError | undefined;
  try {
    (out.spec.handler as (c: CmdContext, a: Record<string, unknown>) => CmdResult)(ctx, out.args);
  } catch (e) {
    caught = e instanceof CliError ? e : undefined;
  }
  expect(caught).toBeDefined();
  expect(caught!.message).toContain("not allowed with argument --dir");
  expect(caught!.exitCode).toBe(2);
});

test("init --dir creates a real workbench (marker present)", () => {
  const target = mkdtempSync(join(tmpdir(), "jspace-init-dir-"));
  const out = parse(["init", "--dir", target], ROOT);
  if (out.kind !== "run") throw new Error("expected run");
  const ctx: CmdContext = { root: target, json: false, dryRun: false, dir: target, cwd: "/" };
  const res = (out.spec.handler as (c: CmdContext, a: Record<string, unknown>) => CmdResult)(ctx, out.args);
  expect(res?.errors ?? []).toHaveLength(0);
  expect(existsSync(join(target, ".jspace", "marker.json"))).toBe(true);
  rmSync(target, { recursive: true, force: true });
});
