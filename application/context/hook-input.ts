// application/context/hook-input.ts — hook prompt reader from stdin.
// The `jspace context turn` hook reads the UserPromptSubmit JSON from stdin.
// A hook must never block a session: a TTY (hand-run) returns immediately with
// no prompt; a non-TTY pipe that never closes (no EOF) is cut off at the
// deadline with timedOut: true (the CLI turns that into a clean exit 0). This
// mirrors Trellis' 0.2s stdin-read guard.
const STDIN_TIMEOUT_MS = 200;

export interface HookPrompt {
  /** The user's prompt under `.prompt` (absent when no/empty/invalid JSON). */
  prompt?: string;
  /** True when the stdin pipe hung past the deadline (never returned). */
  timedOut: boolean;
}

/** Read the hook JSON prompt from stdin. Never blocks: TTY returns immediately;
 *  a non-TTY pipe with no/empty JSON degrades to no prompt; a pipe that never
 *  closes is cut off at STDIN_TIMEOUT_MS with timedOut: true. */
export async function readHookPrompt(): Promise<HookPrompt> {
  if (process.stdin.isTTY) return { timedOut: false };
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      new Response(Bun.stdin).text(),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("stdin timeout"));
        }, STDIN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!raw.trim()) return { timedOut: false };
    const data = JSON.parse(raw) as { prompt?: unknown };
    return { prompt: typeof data.prompt === "string" ? data.prompt : undefined, timedOut: false };
  } catch {
    if (timer) clearTimeout(timer);
    // timedOut stays true when the deadline fired (hung pipe); otherwise the
    // JSON was invalid — no prompt, no skip.
    return { timedOut };
  }
}
