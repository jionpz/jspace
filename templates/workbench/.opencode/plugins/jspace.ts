// .opencode/plugins/jspace.ts — OpenCode → jspace bridge (seed; machine-managed).
//
// Thin emitter only (no business logic): maps OpenCode events to `jspace`
// CLI use cases, so every harness shares one implementation.
//
//   session.created  → inject `jspace context session-start --plain` into the
//                      session as a no-reply user message (client.session.prompt
//                      with noReply: true — OpenCode has no system-prompt
//                      channel, so the context lands as a visible user message,
//                      the closest SessionStart equivalent this platform offers)
//   session.idle     → surface cron failures as a visible no-reply message
//                      (jspace cron check; exit != 0 → inject detail). NO auto
//                      flush of staged writes — idle must not be more aggressive
//                      than Claude/Grok (issue #7 P1.7): write-back AND staged
//                      flush stay user-triggered (D3, no auto write)
//   experimental.session.compacting
//                    → jspace context session-start --plain pushed into the
//                      compaction context (Grok-native memory_flush equivalent;
//                      injects context only, never writes gbrain)
//
// All spawns are guarded (8s timeout + stdin ignored + exit-code check) and
// failures are silent — a hook must never block the session.
import type { Plugin } from "@opencode-ai/plugin";

const SESSION_START_TIMEOUT_MS = 8000;

/** Run `jspace context session-start --plain` with a hard timeout + stdin
 *  ignored + exit-code check. Returns "" when jspace is missing, hangs, or
 *  exits non-zero, so a hook never blocks the session. */
async function runSessionStart(cwd: string): Promise<string> {
  try {
    const proc = Bun.spawn(["jspace", "context", "session-start", "--plain"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      signal: AbortSignal.timeout(SESSION_START_TIMEOUT_MS),
    });
    const code = await proc.exited;
    if (code !== 0) return "";
    return await new Response(proc.stdout).text();
  } catch {
    // jspace missing / timed out / failed: injection is skipped, never fatal.
    return "";
  }
}

/** Run `jspace cron check` (no --quiet: idle only surfaces when there is
 *  something to report) with a hard timeout + stdin ignored. Returns the exit
 *  code + output; the caller decides whether to surface it. */
async function runCronCheck(cwd: string): Promise<{ exit: number; output: string }> {
  try {
    const proc = Bun.spawn(["jspace", "cron", "check"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      signal: AbortSignal.timeout(SESSION_START_TIMEOUT_MS),
    });
    const exit = await proc.exited;
    const output = await new Response(proc.stdout).text();
    return { exit, output };
  } catch {
    // jspace missing / timed out: nothing to report.
    return { exit: 0, output: "" };
  }
}

/** Pure event dispatch (no Bun, no client): given the deps, return the event
 *  handler. Separated so the plugin's branches are unit-testable with mock
 *  inject + mock cron check (no real process, no Bun.spawn in tests). */
export interface EventDeps {
  /** session.created → inject session-start context (awaited; self-capped by the
   *  runner's timeout so it can't stall the event loop indefinitely). */
  injectSessionStart: (sessionID: string) => Promise<void>;
  /** session.idle → surface cron failures as a visible reminder (no auto flush
   *  of staged writes — P1.7: idle must not be more aggressive than Claude/Grok,
   *  staged writes stay user-triggered). */
  checkCron: (sessionID: string) => Promise<void>;
}

export function createEventHandler(deps: EventDeps) {
  return async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }): Promise<void> => {
    if (event.type === "session.created") {
      const sessionID = event.properties?.sessionID;
      if (sessionID) await deps.injectSessionStart(sessionID);
    } else if (event.type === "session.idle") {
      const sessionID = event.properties?.sessionID;
      if (sessionID) await deps.checkCron(sessionID);
    }
  };
}

/** Pure compaction-context injector (no Bun): given a runner that returns the
 *  session-start text, return a hook handler that pushes it into context.
 *  Separated for testability. */
export function createCompactingHandler(runSessionStartText: () => Promise<string>) {
  return async (_input: unknown, output: { context: string[] }): Promise<void> => {
    const text = await runSessionStartText();
    if (text.trim().length > 0) output.context.push(text);
  };
}

export const JSpacePlugin: Plugin = async ({ directory, client }) => {
  const wbRoot = directory;
  return {
    event: createEventHandler({
      injectSessionStart: async (sessionID) => {
        const text = await runSessionStart(wbRoot);
        if (text.trim().length === 0) return; // nothing to inject
        try {
          // noReply: true adds the text as a user message without triggering an
          // AI response — context-only, never a write to gbrain. path is the
          // SDK's `{ id }` session reference shape.
          await client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text }], noReply: true },
          });
        } catch {
          // injection failure: silent — the session continues without the context.
        }
      },
      checkCron: async (sessionID) => {
        // Surface cron failures when there are any (exit != 0) — never on a
        // clean check, so idle doesn't spam. The reminder is a no-reply message:
        // visible, actionable, still just context (no write to gbrain).
        const { exit, output } = await runCronCheck(wbRoot);
        if (exit !== 0 && output.trim().length > 0) {
          try {
            await client.session.prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: output }], noReply: true },
            });
          } catch {
            // injection failure: silent — the session continues.
          }
        }
      },
    }),
    "experimental.session.compacting": createCompactingHandler(() => runSessionStart(wbRoot)),
  };
};
