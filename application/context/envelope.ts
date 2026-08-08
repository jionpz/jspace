// application/context/envelope.ts — wrap rendered context in the host hook
// JSON envelope. Claude Code (and most hosts) inject via
// `hookSpecificOutput.additionalContext`. The platform branch is here so future
// harness wiring (Cursor top-level `additional_context`, Gemini `BeforeAgent`
// event name, Kiro raw text, ZCode single-output) lands in one place without
// touching the CLI handlers. Only Claude Code is wired this round.
export type HookPlatform = "claude";

/** Wrap the session-start payload in the Claude Code SessionStart envelope. */
export function sessionStartEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  });
}

/** Wrap the per-turn payload in the Claude Code UserPromptSubmit envelope. */
export function turnEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
  });
}
