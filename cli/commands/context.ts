// cli/commands/context.ts — `jspace context` — emit workbench context for the
// harness session-start / per-turn hooks. Wired into .claude/settings.json as
// `jspace context session-start` / `jspace context turn` with `2>/dev/null || true`
// so any failure degrades to exit 0 (a hook must never block the session).
// Business logic lives in application/context/{gate,collect,payload,envelope}.
import type { CommandSpec, CmdContext } from "../../application/commands/command.ts";
import { collectWorkbenchState } from "../../application/context/collect.ts";
import { gate } from "../../application/context/gate.ts";
import { renderSessionStart, renderTurn } from "../../application/context/payload.ts";
import { sessionStartEnvelope, turnEnvelope } from "../../application/context/envelope.ts";

/** Read the hook JSON prompt from stdin (UserPromptSubmit payload carries the
 *  user's prompt under `.prompt`). Never blocks on a terminal: TTY stdin means
 *  the user ran `jspace context turn` by hand — no hook prompt, return undefined.
 *  A non-TTY pipe with no/empty JSON also degrades to undefined (no skip). */
async function readHookPrompt(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  try {
    const raw = await new Response(Bun.stdin).text();
    if (!raw.trim()) return undefined;
    const data = JSON.parse(raw) as { prompt?: unknown };
    return typeof data.prompt === "string" ? data.prompt : undefined;
  } catch {
    return undefined;
  }
}

/** Never propagate: any internal failure degrades to a warning + exit 0. */
function failLines(e: unknown): { lines: string[]; warnings: string[] } {
  return { lines: [], warnings: [`context: ${e instanceof Error ? e.message : String(e)}`] };
}

function plain(args: Record<string, unknown>): boolean {
  return args.plain === true;
}

const sessionStartSpec: CommandSpec = {
  name: "session-start",
  summary: "emit the session-start workbench context (hook JSON, or --plain text)",
  features: { dir: true },
  options: [{ name: "--plain", takesValue: false, help: "output plain text instead of the hook JSON envelope" }],
  handler: (ctx: CmdContext, args: Record<string, unknown>) => {
    try {
      const g = gate("session-start", undefined, ctx.root);
      if (!g.emit) return { lines: [] }; // not a workbench / hooks off: silent exit 0
      const state = collectWorkbenchState(g.root);
      const text = renderSessionStart(state, g.root);
      return { lines: [plain(args) ? text : sessionStartEnvelope(text)] };
    } catch (e) {
      return failLines(e);
    }
  },
};

const turnSpec: CommandSpec = {
  name: "turn",
  summary: "emit the per-turn workbench state (hook JSON, or --plain text); nothing when idle",
  features: { dir: true },
  options: [{ name: "--plain", takesValue: false, help: "output plain text instead of the hook JSON envelope" }],
  handler: async (ctx: CmdContext, args: Record<string, unknown>) => {
    try {
      const prompt = await readHookPrompt();
      const g = gate("turn", prompt, ctx.root);
      if (!g.emit) return { lines: [] }; // no-workbench / skip-keyword / hooks off: silent
      const state = collectWorkbenchState(g.root);
      const text = renderTurn(state);
      if (text === "") return { lines: [] }; // nothing actionable: zero output
      return { lines: [plain(args) ? text : turnEnvelope(text)] };
    } catch (e) {
      return failLines(e);
    }
  },
};

export const contextSpec: CommandSpec = {
  name: "context",
  summary: "emit workbench context for harness session-start / per-turn hooks",
  description:
    "Context injection commands consumed by .claude/settings.json hooks. " +
    "Always exit 0 (a hook must never block the session); a non-workbench directory " +
    "or a disabled hook emits nothing.",
  features: { dir: true },
  children: [sessionStartSpec, turnSpec],
};
