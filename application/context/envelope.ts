// application/context/envelope.ts — wrap rendered context in the host hook
// JSON envelope. Claude Code (and most hosts) inject via
// `hookSpecificOutput.additionalContext`. The platform branch is here so future
// harness wiring (Cursor top-level `additional_context`, Gemini `BeforeAgent`
// event name, Kiro raw text, ZCode single-output) lands in one place without
// touching the CLI handlers. Claude + Grok (same hook event set) are wired this
// round; Grok consumes the same Claude-shaped envelope (compat.claude).
export type HookPlatform = "claude" | "grok";

/** Wrap the session-start payload in the Claude/Grok SessionStart envelope. */
export function sessionStartEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  });
}

/** Wrap the per-turn payload in the Claude/Grok UserPromptSubmit envelope. */
export function turnEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
  });
}

/** Wrap the pre-compact passive reminder in the Grok PreCompact envelope. */
export function preCompactEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: context },
  });
}

/** Wrap the session-end settlement reminder in the Grok SessionEnd envelope. */
export function sessionEndEnvelope(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionEnd", additionalContext: context },
  });
}
