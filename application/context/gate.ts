// application/context/gate.ts — decide whether/when the context hooks emit
// anything at all. Rules (design §5, order matters):
//   1. JSPACE_HOOKS=0           -> silent (global off switch)
//   2. any *_NON_INTERACTIVE=1  -> silent (headless/CI must not inject)
//   3. no workbench marker up the tree -> silent (not a JSpace workbench)
//   4. turn + "no-jspace" in prompt    -> silent (per-turn escape hatch)
//   5. collect state (each item fails quietly)
//   6. broken registry          -> visible alert, never silent (degradation
//      must be seen, not masked — methodology §3 discipline)
import { existsSync } from "node:fs";
import { join } from "node:path";

const MARKER_REL = join(".jspace", "marker.json");

export type GateMode = "session-start" | "turn";

export type GateResult =
  | { emit: false; reason: "hooks-disabled" | "non-interactive" | "no-workbench" | "skip-keyword" }
  | { emit: true; root: string };

/** Global off switch: JSPACE_HOOKS=0 / JSPACE_DISABLE_HOOKS=1. */
export function hooksDisabled(): boolean {
  return process.env.JSPACE_HOOKS === "0" || process.env.JSPACE_DISABLE_HOOKS === "1";
}

/** Headless / non-interactive run (any platform's flag) — no injection. */
const NON_INTERACTIVE_VARS = [
  "CLAUDE_NON_INTERACTIVE",
  "CURSOR_NON_INTERACTIVE",
  "CODEX_NON_INTERACTIVE",
  "GEMINI_NON_INTERACTIVE",
  "QODER_NON_INTERACTIVE",
  "COPILOT_NON_INTERACTIVE",
  "KIRO_NON_INTERACTIVE",
  "TRAE_NON_INTERACTIVE",
  "ZCODE_NON_INTERACTIVE",
  "CODEBUDDY_NON_INTERACTIVE",
] as const;

export function nonInteractive(): boolean {
  return NON_INTERACTIVE_VARS.some((v) => process.env[v] === "1");
}

/** Walk up from `start` to the first directory that is a JSpace workbench
 *  (has `.jspace/marker.json`). Supports launching from a subdirectory (e.g.
 *  `workspace/<domain>/`), matching Trellis' find_trellis_root. */
export function findWorkbenchRoot(start: string): string | null {
  let cur = start;
  for (;;) {
    if (existsSync(join(cur, MARKER_REL))) return cur;
    const parent = join(cur, "..");
    if (parent === cur) return null; // reached the filesystem root
    cur = parent;
  }
}

/** Per-turn escape hatch: "no-jspace" as a standalone word (word-boundary
 *  match; "no-jspacefoo" / "xno-jspace" do NOT count). */
export function promptHasSkipKeyword(prompt: string | undefined): boolean {
  if (!prompt) return false;
  return /(?<![\w-])no-jspace(?![\w-])/i.test(prompt);
}

/** Decide whether this invocation should emit anything. */
export function gate(mode: GateMode, prompt: string | undefined, start: string): GateResult {
  if (hooksDisabled()) return { emit: false, reason: "hooks-disabled" };
  if (nonInteractive()) return { emit: false, reason: "non-interactive" };
  const root = findWorkbenchRoot(start);
  if (root === null) return { emit: false, reason: "no-workbench" };
  if (mode === "turn" && promptHasSkipKeyword(prompt)) return { emit: false, reason: "skip-keyword" };
  return { emit: true, root };
}
