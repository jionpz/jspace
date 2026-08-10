// adapters/harness/opencode-plugin.test.ts — OpenCode plugin event dispatch
// (pure handlers from the template, spawn/inject mocked). Pins the D3 contract:
// session.idle flushes pending + cron check, NEVER memory-writeback; and the
// P0 (issue #7) injection contract: session.created injects the session-start
// context via the client prompt (noReply), never fire-and-forget stdout.
// Run: bun test adapters/harness/opencode-plugin.test.ts
import { expect, test } from "bun:test";
import { createEventHandler, createCompactingHandler } from "../../templates/workbench/.opencode/plugins/jspace.ts";

const WB = "/wb";

function makeDeps(overrides: Partial<Parameters<typeof createEventHandler>[0]> = {}) {
  const spawns: { cmd: string[]; cwd: string }[] = [];
  const injected: string[] = [];
  const deps = {
    injectSessionStart: async (sessionID: string) => {
      injected.push(sessionID);
    },
    spawn: (cmd: string[], cwd: string) => spawns.push({ cmd, cwd }),
    wbRoot: WB,
    ...overrides,
  };
  return { deps, spawns, injected };
}

test("session.created injects session-start context with the session id", async () => {
  const { deps, spawns, injected } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.created", properties: { sessionID: "sess-123" } } });
  expect(injected).toEqual(["sess-123"]);
  // no idle spawns on created
  expect(spawns).toEqual([]);
});

test("session.created without session id is a no-op (nothing to inject)", async () => {
  const { deps, injected } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.created" } });
  expect(injected).toEqual([]);
});

test("session.idle -> pending apply --quiet + cron check --quiet (no writeback)", async () => {
  const { deps, spawns } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.idle" } });
  const cmds = spawns.map((c) => c.cmd.join(" "));
  expect(cmds).toContain("jspace pending apply --quiet");
  expect(cmds).toContain("jspace cron check --quiet");
  // D3 hard constraint: idle NEVER triggers a write-back / session-end
  expect(cmds.some((c) => /writeback|memory-writeback|session-end/i.test(c))).toBe(false);
  expect(spawns.every((c) => c.cwd === WB)).toBe(true);
});

test("unrelated event types are ignored (no inject, no spawn)", async () => {
  const { deps, spawns, injected } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "chat.message" } });
  await handler({ event: { type: "session.compacted" } });
  expect(spawns).toEqual([]);
  expect(injected).toEqual([]);
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

test("compacting skips context when the runner times out or fails (returns empty)", async () => {
  const handler = createCompactingHandler(async () => "");
  const output = { context: [] as string[] };
  await handler({}, output);
  expect(output.context).toEqual([]);
});
