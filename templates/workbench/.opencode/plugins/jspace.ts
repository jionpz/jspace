// .opencode/plugins/jspace.ts — OpenCode → jspace bridge (seed; machine-managed).
//
// Thin emitter only (no business logic): maps OpenCode events to `jspace`
// CLI use cases, so every harness shares one implementation.
//
//   session.created  → jspace context session-start  (session-start injection)
//   session.idle     → pending apply --quiet + cron check --quiet
//                      (flush the user's staged queue + cron failure surface;
//                       NO memory-writeback — idle fires every turn and an auto
//                       write would write garbage; write-back stays explicit)
//   experimental.session.compacting
//                    → jspace context session-start --plain pushed into the
//                      compaction context (Grok-native memory_flush equivalent;
//                      injects context only, never writes gbrain)
//
// All spawns are fire-and-forget with cwd = the workbench (PluginInput.directory)
// and failures are silent — a hook must never block the session.
import type { Plugin } from "@opencode-ai/plugin";

const spawn = (cmd: string[], cwd: string): void => {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "ignore" });
    // fire-and-forget: never await — idle fires every turn and a blocking spawn
    // would stall the event loop. exit code is deliberately ignored (hook noise).
    void proc.exited;
  } catch {
    // jspace missing / workbench gone: silent — a hook must never block.
  }
};

/** Pure event dispatch (no Bun): given a spawn fn + the workbench root, return
 *  the event handler. Separated so the plugin's branches are unit-testable with
 *  a mock spawn (no real process, no Bun.spawn in tests). */
export function createEventHandler(spawnFn: (cmd: string[], cwd: string) => void, wbRoot: string) {
  return async ({ event }: { event: { type: string } }): Promise<void> => {
    if (event.type === "session.created") {
      spawnFn(["jspace", "context", "session-start"], wbRoot);
    } else if (event.type === "session.idle") {
      // pending apply flushes the user's *explicitly staged* writes — an
      // intent-from-user flush, never an auto write-back. It is idempotent and
      // a cheap no-op when nothing is staged (the envelope repo resolves the
      // filehub internally — the plugin stays a thin emitter, no registry
      // lookup here). cron check surfaces failures (exit 1 when anything needs
      // attention). Both --quiet: suppress stdout in the session.
      spawnFn(["jspace", "pending", "apply", "--quiet"], wbRoot);
      spawnFn(["jspace", "cron", "check", "--quiet"], wbRoot);
    }
  };
}

/** Pure compaction-context injector (no Bun): given a runner that returns the
 *  session-start text, return a hook handler that pushes it into context.
 *  Separated for testability. */
export function createCompactingHandler(runSessionStart: () => Promise<string>) {
  return async (_input: unknown, output: { context: string[] }): Promise<void> => {
    const text = await runSessionStart();
    if (text.trim().length > 0) output.context.push(text);
  };
}

export const JSpacePlugin: Plugin = async ({ directory }) => {
  const wbRoot = directory;
  return {
    event: createEventHandler(spawn, wbRoot),
    "experimental.session.compacting": createCompactingHandler(async () => {
      // Inject the current workbench state into the compaction prompt so the
      // compressed context "knows" the workbench. Only context; never a write.
      try {
        const proc = Bun.spawn(["jspace", "context", "session-start", "--plain"], {
          cwd: wbRoot,
          stdout: "pipe",
          stderr: "ignore",
        });
        return await new Response(proc.stdout).text();
      } catch {
        // jspace unavailable: compaction proceeds without the injected context.
        return "";
      }
    }),
  };
};
