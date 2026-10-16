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

/** Wrap the session-end settlement reminder for the SessionEnd hook.
 *
 *  NOT `hookSpecificOutput.hookEventName: "SessionEnd"` — Claude Code's hook
 *  output validator rejects that value (its enum is PreToolUse |
 *  UserPromptSubmit | UserPromptExpansion | SessionStart | Setup |
 *  PreModelSwitch | …; SessionEnd is absent), so every session ended with a
 *  `Hook JSON output validation failed` line on stderr. Verified with a
 *  controlled probe: the old shape always errors, `{}` and `{"systemMessage"}`
 *  are both accepted.
 *
 *  `systemMessage` keeps the reminder text. It still does not reach the session
 *  — Claude discards SessionEnd output (docs/session-end-hooks.md) — so this
 *  changes nothing the user sees; it only stops the false "wiring is broken"
 *  signal. grok consumes the Claude-shaped envelope (compat.claude) and
 *  `systemMessage` is a top-level field of that contract, but grok is NOT
 *  installed here and this shape is UNVERIFIED for it. */
export function sessionEndEnvelope(context: string): string {
  return JSON.stringify({ systemMessage: context });
}

/** Cursor sessionStart envelope — Cursor expects TOP-LEVEL `additional_context`
 *  (not Claude/Grok's hookSpecificOutput shape; verified against cursor.com
 *  hooks docs). Injected into the conversation's initial system context. */
export function cursorSessionStartEnvelope(context: string): string {
  return JSON.stringify({ additional_context: context });
}
