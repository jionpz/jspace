// cli/commands/integration.test.ts — CLI end-to-end init/enable/status/disable.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, type CmdContext, type CmdResult, type CommandSpec } from "../../application/commands/command.ts";
import { COMMANDS } from "./registry.ts";

const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };
async function execute(root: string, argv: string[]): Promise<CmdResult> {
  const outcome = parse(argv, ROOT);
  if (outcome.kind !== "run") throw new Error(`unexpected parser outcome: ${outcome.kind}`);
  const context: CmdContext = { root, cwd: root, dir: root, dryRun: outcome.args.dryRun === true, json: outcome.args.json === true };
  return await outcome.spec.handler!(context, outcome.args);
}
function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "jspace-jstack-cli-"));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("init --integration jstack enables bridge, while default init remains disabled", async () => withRoot(async (root) => {
  const result = await execute(root, ["init", "--dir", root, "--integration", "jstack"]);
  expect(result.lines.join("\n")).toContain("JStack integration enabled");
  const status = await execute(root, ["integration", "status", "jstack", "--dir", root, "--json"]);
  expect(status.data).toMatchObject({ enabled: true, state: "ok", bridge: "current" });
  expect(existsSync(join(root, ".jspace", "skills", "jspace-jstack", "SKILL.md"))).toBe(true);
}));

test("init with unsupported integration fails before creating any files", async () => withRoot(async (root) => {
  await expect(execute(root, ["init", "--dir", root, "--integration", "arbitrary"])).rejects.toThrow(/unsupported integration/);
  expect(existsSync(join(root, ".jspace", "marker.json"))).toBe(false);
}));

test("existing workspace can be enabled, disabled, enabled; status reflects each phase", async () => withRoot(async (root) => {
  await execute(root, ["init", "--dir", root]);
  const initially = await execute(root, ["integration", "status", "jstack", "--dir", root]);
  expect(initially.lines.join("\n")).toContain("disabled");
  const preview = await execute(root, ["integration", "enable", "jstack", "--dir", root, "--dry-run"]);
  expect(preview.lines.join("\n")).toContain("dry-run");
  expect(readFileSync(join(root, ".jspace", "integrations.json"), "utf8")).toContain('"enabled": false');
  await execute(root, ["integration", "enable", "jstack", "--dir", root]);
  const enabled = await execute(root, ["integration", "status", "jstack", "--dir", root]);
  expect(enabled.lines.join("\n")).toContain("enabled");
  await execute(root, ["integration", "disable", "jstack", "--dir", root]);
  expect((await execute(root, ["integration", "status", "jstack", "--dir", root])).lines.join("\n")).toContain("disabled");
  await execute(root, ["integration", "enable", "jstack", "--dir", root]);
  expect((await execute(root, ["integration", "status", "jstack", "--dir", root])).lines.join("\n")).toContain("enabled");
}));

test("init refuses re-initializing an existing enabled workbench", async () => withRoot(async (root) => {
  await execute(root, ["init", "--dir", root, "--integration", "jstack"]);
  await expect(execute(root, ["init", "--dir", root, "--integration", "jstack", "--force"])).rejects.toThrow(/already a JSpace workbench/);
}));

test("integration attach requires explicit repo and source arguments", () => {
  expect(() => parse(["integration", "attach", "jstack", "--repo", "/tmp/test"], ROOT)).toThrow(/--source/);
  expect(() => parse(["integration", "attach", "jstack", "--source", "/tmp/jstack"], ROOT)).toThrow(/--repo/);
  expect(() => parse(["integration", "enable", "unknown"], ROOT)).toThrow(/unsupported integration/);
});
