// cli/commands/context.ts — `jspace context` — emit workbench context for the
// harness session-start / per-turn hooks. Wired into .claude/settings.json as
// `jspace context session-start` / `jspace context turn` with `2>/dev/null || true`
// so any failure degrades to exit 0 (a hook must never block the session).
// Business logic lives in application/context/{gate,collect,payload,envelope};
// stdin hook-prompt reading lives in application/context/hook-input.ts. This
// file only maps args -> use case (no process.exit; the CmdResult exitCode
// protocol drives the process exit code).
import type { CommandSpec, CmdContext } from "../../application/commands/command.ts";
import { collectWorkbenchState } from "../../application/context/collect.ts";
import { gate, gatePre, promptHasSkipKeyword } from "../../application/context/gate.ts";
import {
  renderSessionStart,
  renderTurn,
  renderPreCompact,
  renderSessionEnd,
} from "../../application/context/payload.ts";
import {
  sessionStartEnvelope,
  turnEnvelope,
  preCompactEnvelope,
  sessionEndEnvelope,
} from "../../application/context/envelope.ts";
import { readHookPrompt } from "../../application/context/hook-input.ts";

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
      // Pre-gate first (no stdin read): hooks off / headless / not a workbench
      // short-circuit before we touch stdin, so a hung pipe can't block them.
      const pre = gatePre("turn", ctx.root);
      if (!pre.emit) return { lines: [] };
      const { prompt, timedOut } = await readHookPrompt();
      // a hung stdin pipe must never block a session: exit 0, no output
      if (timedOut) return { exitCode: 0, lines: [] };
      if (promptHasSkipKeyword(prompt)) return { lines: [] }; // no-jspace: this turn only
      const state = collectWorkbenchState(pre.root);
      const text = renderTurn(state);
      if (text === "") return { lines: [] }; // nothing actionable: zero output
      return { lines: [plain(args) ? text : turnEnvelope(text)] };
    } catch (e) {
      return failLines(e);
    }
  },
};

/** Grok PreCompact / SessionEnd passive reminder hook: surface the state that
 *  could be lost + remind that write-back stays explicit (D2/方案 a — never
 *  auto-writes gbrain). Shares the session-start gate (session lifecycle event). */
function sessionReminderSpec(
  name: string,
  summary: string,
  render: (state: ReturnType<typeof collectWorkbenchState>, root: string) => string,
  envelope: (context: string) => string,
): CommandSpec {
  return {
    name,
    summary,
    features: { dir: true },
    options: [{ name: "--plain", takesValue: false, help: "output plain text instead of the hook JSON envelope" }],
    handler: (ctx: CmdContext, args: Record<string, unknown>) => {
      try {
        const g = gate("session-start", undefined, ctx.root);
        if (!g.emit) return { lines: [] }; // not a workbench / hooks off: silent exit 0
        const state = collectWorkbenchState(g.root);
        const text = render(state, g.root);
        return { lines: [plain(args) ? text : envelope(text)] };
      } catch (e) {
        return failLines(e);
      }
    },
  };
}

const preCompactSpec = sessionReminderSpec(
  "pre-compact",
  "emit the pre-compaction passive reminder (state + explicit write-back nudge; never auto-writes gbrain)",
  renderPreCompact,
  preCompactEnvelope,
);

const sessionEndSpec = sessionReminderSpec(
  "session-end",
  "emit the session-end settlement reminder (state + explicit write-back nudge; never auto-writes gbrain)",
  renderSessionEnd,
  sessionEndEnvelope,
);

export const contextSpec: CommandSpec = {
  name: "context",
  summary: "emit workbench context for harness session-start / per-turn hooks",
  description:
    "Context injection commands consumed by .claude/settings.json hooks. " +
    "Always exit 0 (a hook must never block the session); a non-workbench directory " +
    "or a disabled hook emits nothing.",
  features: { dir: true },
  children: [sessionStartSpec, turnSpec, preCompactSpec, sessionEndSpec],
};
