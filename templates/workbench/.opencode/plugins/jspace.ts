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
//   session.idle     → pending apply --quiet + cron check --quiet
//                      (flush the user's staged queue + cron failure surface;
//                       NO memory-writeback — idle fires every turn and an auto
//                       write would write garbage; write-back stays explicit)
//   experimental.session.compacting
//                    → jspace context session-start --plain pushed into the
//                      compaction context (Grok-native memory_flush equivalent;
//                      injects context only, never writes gbrain)
//
// All spawns are guarded (8s timeout + stdin ignored + exit-code check) and
// failures are silent — a hook must never block the session.
import type { Plugin } from "@opencode-ai/plugin";

const SESSION_START_TIMEOUT_MS = 8000;

/** Fire-and-forget spawn with cwd = the workbench. Never awaited (idle fires
 *  every turn and a blocking spawn would stall the event loop); exit code is
 *  deliberately ignored (hook noise). */
const spawn = (cmd: string[], cwd: string): void => {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "ignore" });
    void proc.exited;
  } catch {
    // jspace missing / workbench gone: silent — a hook must never block.
  }
};

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

/** Pure event dispatch (no Bun, no client): given the deps, return the event
 *  handler. Separated so the plugin's branches are unit-testable with a mock
 *  inject + mock spawn (no real process, no Bun.spawn in tests). */
export interface EventDeps {
  /** session.created → inject session-start context (awaited; self-capped by the
   *  runner's timeout so it can't stall the event loop indefinitely). */
  injectSessionStart: (sessionID: string) => Promise<void>;
  /** session.idle → fire-and-forget spawns (never awaited). */
  spawn: (cmd: string[], cwd: string) => void;
  /** Workbench root (PluginInput.directory) used for idle spawns. */
  wbRoot: string;
}

export function createEventHandler(deps: EventDeps) {
  return async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }): Promise<void> => {
    if (event.type === "session.created") {
      const sessionID = event.properties?.sessionID;
      if (sessionID) await deps.injectSessionStart(sessionID);
    } else if (event.type === "session.idle") {
      // pending apply flushes the user's *explicitly staged* writes — an
      // intent-from-user flush, never an auto write-back. It is idempotent and
      // a cheap no-op when nothing is staged (the envelope repo resolves the
      // filehub internally — the plugin stays a thin emitter, no registry
      // lookup here). cron check surfaces failures (exit 1 when anything needs
      // attention). Both --quiet: suppress stdout in the session.
      deps.spawn(["jspace", "pending", "apply", "--quiet"], deps.wbRoot);
      deps.spawn(["jspace", "cron", "check", "--quiet"], deps.wbRoot);
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
      spawn,
      wbRoot,
    }),
    "experimental.session.compacting": createCompactingHandler(() => runSessionStart(wbRoot)),
  };
};
