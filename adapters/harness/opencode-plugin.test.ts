// adapters/harness/opencode-plugin.test.ts — OpenCode plugin event dispatch
// (pure handlers from the template, inject/cron mocked). Pins the D3 + P1.7
// (issue #7) contract: session.idle surfaces cron failures as a visible
// reminder and NEVER auto-flushes staged writes (idle must not be more
// aggressive than Claude/Grok) and never write-backs; session.created injects
// the session-start context via the client prompt (noReply).
// Run: bun test adapters/harness/opencode-plugin.test.ts
import { expect, test } from "bun:test";
import { createEventHandler, createCompactingHandler } from "../../templates/workbench/.opencode/plugins/jspace.ts";

function makeDeps(overrides: Partial<Parameters<typeof createEventHandler>[0]> = {}) {
  const injected: string[] = [];
  const cronChecked: string[] = [];
  const deps = {
    injectSessionStart: async (sessionID: string) => {
      injected.push(sessionID);
    },
    checkCron: async (sessionID: string) => {
      cronChecked.push(sessionID);
    },
    ...overrides,
  };
  return { deps, injected, cronChecked };
}

test("session.created injects session-start context with the session id", async () => {
  const { deps, injected, cronChecked } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.created", properties: { sessionID: "sess-123" } } });
  expect(injected).toEqual(["sess-123"]);
  // created must not trigger a cron check
  expect(cronChecked).toEqual([]);
});

test("session.created without session id is a no-op (nothing to inject)", async () => {
  const { deps, injected } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.created" } });
  expect(injected).toEqual([]);
});

test("session.idle surfaces cron failures for the session (no auto flush, no writeback)", async () => {
  const { deps, injected, cronChecked } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.idle", properties: { sessionID: "sess-456" } } });
  expect(cronChecked).toEqual(["sess-456"]);
  // P1.7: idle must NOT flush staged writes (no pending apply) and never write-back
  expect(injected).toEqual([]);
});

test("session.idle without session id is a no-op (nothing to surface)", async () => {
  const { deps, cronChecked } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "session.idle" } });
  expect(cronChecked).toEqual([]);
});

test("unrelated event types are ignored (no inject, no cron check)", async () => {
  const { deps, injected, cronChecked } = makeDeps();
  const handler = createEventHandler(deps);
  await handler({ event: { type: "chat.message" } });
  await handler({ event: { type: "session.compacted" } });
  expect(injected).toEqual([]);
  expect(cronChecked).toEqual([]);
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
