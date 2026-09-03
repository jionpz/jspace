// cli/commands/context.ts — `jspace context` — emit workbench context for the
// harness session-start / per-turn hooks. Wired into .claude/settings.json /
// .grok/hooks/jspace.json / .cursor/hooks.json as a bare `jspace context ...`
// command (no shell syntax — issue #7 P3.18: `2>/dev/null || true` is bash-only
// and breaks Windows PowerShell). The CLI swallows errors itself: every handler
// degrades to an empty line + exit 0 (failLines) and a non-workbench / disabled
// hook gate emits nothing — a hook must never block the session on any platform.
// Business logic lives in application/context/{gate,collect,payload,envelope};
// stdin hook-prompt reading lives in application/context/hook-input.ts. This
// file only maps args -> use case (no process.exit; the CmdResult exitCode
// protocol drives the process exit code).
import type { CommandSpec, CmdContext } from "../../application/commands/command.ts";
import { collectWorkbenchState } from "../../application/context/collect.ts";
import {
  collectActiveProfiles,
  collectActiveProjects,
  collectRecentKnowledge,
  PROJECT_COLLECT_TIMEOUT_MS,
  type ProfileState,
  type ProjectState,
  type RecentKnowledgeEntry,
} from "../../application/context/project-states.ts";
import { realGbrain } from "../../adapters/gbrain/gbrain.ts";
import { loadHub } from "../../application/workspace/state.ts";
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
  cursorSessionStartEnvelope,
} from "../../application/context/envelope.ts";
import { readHookPrompt } from "../../application/context/hook-input.ts";
import { claimWritebackNudge, touchBriefing } from "../../application/context/briefing.ts";

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
  options: [
    { name: "--plain", takesValue: false, help: "output plain text instead of the hook JSON envelope" },
    {
      name: "--envelope",
      takesValue: true,
      metavar: "claude|cursor",
      help: "hook envelope shape (default claude; cursor = top-level additional_context)",
    },
  ],
  handler: async (ctx: CmdContext, args: Record<string, unknown>) => {
    try {
      const g = gate("session-start", undefined, ctx.root);
      if (!g.emit) return { lines: [] }; // not a workbench / hooks off: silent exit 0
      const state = collectWorkbenchState(g.root);
      // R3: project + profile cards come from gbrain through the async port with
      // a short per-call timeout. The two lists run in parallel on one instance;
      // either failure degrades to [] without blocking the other or the hook.
      let excludeProjectIds: Set<string> | undefined;
      try {
        const hub = loadHub(g.root);
        const archived = hub.projects.filter((p) => p.status === "archived").map((p) => p.id);
        if (archived.length > 0) excludeProjectIds = new Set(archived);
      } catch {
        // hub unreadable — inject without registry filter; gbrain status:archived still applies
      }
      const gbrain = realGbrain(undefined, PROJECT_COLLECT_TIMEOUT_MS);
      const [projects, profiles, recentKnowledge] = await Promise.all([
        collectActiveProjects(gbrain, { excludeProjectIds }).catch((): ProjectState[] => []),
        collectActiveProfiles(gbrain).catch((): ProfileState[] => []),
        collectRecentKnowledge(gbrain).catch((): RecentKnowledgeEntry[] => []),
      ]);
      state.projects = projects;
      state.profiles = profiles;
      state.recentKnowledge = recentKnowledge;
      const text = renderSessionStart(state, g.root);
      // Best-effort briefing timestamp: never blocks the hook if the write fails.
      try {
        touchBriefing(g.root);
      } catch {
        // silent — the hook must never fail because a machine-state write failed
      }
      if (plain(args)) return { lines: [text] };
      return { lines: [args.envelope === "cursor" ? cursorSessionStartEnvelope(text) : sessionStartEnvelope(text)] };
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
      let text = renderTurn(state);
      // Nothing more urgent to say: spend this session's single write-back nudge
      // (B4). The claim is only attempted when the turn would otherwise be
      // silent, so a busy workbench never burns the nudge on a turn that does
      // not show it. A failed claim degrades to the silent turn.
      if (text === "") {
        let nudge = false;
        try {
          nudge = claimWritebackNudge(pre.root);
        } catch {
          // silent — the hook must never fail because a machine-state write failed
        }
        if (nudge) text = renderTurn(state, { writebackNudge: true });
      }
      if (text === "") return { lines: [] }; // nothing actionable: zero output
      return { lines: [plain(args) ? text : turnEnvelope(text)] };
    } catch (e) {
      return failLines(e);
    }
  },
};

/** Grok PreCompact / SessionEnd passive reminder hook: surface the state that
 *  could be lost + remind that write-back stays explicit (never auto-writes
 *  gbrain). Shares the session-start gate (session lifecycle event). */
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
