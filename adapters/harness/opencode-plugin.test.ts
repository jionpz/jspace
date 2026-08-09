// adapters/harness/opencode-plugin.test.ts — OpenCode plugin event dispatch
// (pure handlers from the template, spawn mocked). Pins the D3 contract:
// session.idle flushes pending + cron check, NEVER memory-writeback.
// Run: bun test adapters/harness/opencode-plugin.test.ts
import { expect, test } from "bun:test";
import { createEventHandler, createCompactingHandler } from "../../templates/workbench/.opencode/plugins/jspace.ts";

const WB = "/wb";

test("session.created -> jspace context session-start", async () => {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const handler = createEventHandler((cmd, cwd) => calls.push({ cmd, cwd }), WB);
  await handler({ event: { type: "session.created" } });
  expect(calls).toEqual([{ cmd: ["jspace", "context", "session-start"], cwd: WB }]);
});

test("session.idle -> pending apply --quiet + cron check --quiet (no writeback)", async () => {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const handler = createEventHandler((cmd, cwd) => calls.push({ cmd, cwd }), WB);
  await handler({ event: { type: "session.idle" } });
  const cmds = calls.map((c) => c.cmd.join(" "));
  expect(cmds).toContain("jspace pending apply --quiet");
  expect(cmds).toContain("jspace cron check --quiet");
  // D3 hard constraint: idle NEVER triggers a write-back / session-end
  expect(cmds.some((c) => /writeback|memory-writeback|session-end/i.test(c))).toBe(false);
  expect(calls.every((c) => c.cwd === WB)).toBe(true);
});

test("unrelated event types are ignored (no spawn)", async () => {
  const calls: string[][] = [];
  const handler = createEventHandler((cmd) => calls.push(cmd), WB);
  await handler({ event: { type: "chat.message" } });
  await handler({ event: { type: "session.compacted" } });
  expect(calls).toEqual([]);
});

test("compacting pushes non-empty session-start context", async () => {
  const handler = createCompactingHandler(async () => "<jspace-workbench>state</jspace-workbench>");
  const output = { context: [] as string[] };
  await handler({}, output);
  expect(output.context).toEqual(["<jspace-workbench>state</jspace-workbench>"]);
});

test("compacting skips empty context (nothing to inject)", async () => {
  const handler = createCompactingHandler(async () => "   ");
  const output = { context: [] as string[] };
  await handler({}, output);
  expect(output.context).toEqual([]);
});
