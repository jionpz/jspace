// adapters/harness/index.ts — adapter registry (capability key -> adapter).
// One adapter per capabilities.yaml entry; the adapter owns behavior (headless
// argv assembly, hook file paths, skill projections) on top of the declared
// capability.
import { fail } from "../../core/shared/errors.ts";
import type { HarnessAdapter } from "./types.ts";
import { claudeAdapter } from "./claude.ts";
import { grokAdapter } from "./grok.ts";
import { opencodeAdapter } from "./opencode.ts";
import { piAdapter } from "./pi.ts";
import { cursorAdapter } from "./cursor.ts";
import { codexAdapter } from "./codex.ts";

const ADAPTERS: Record<string, HarnessAdapter> = {
  claude: claudeAdapter,
  grok: grokAdapter,
  opencode: opencodeAdapter,
  pi: piAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
};

/** Look up an adapter by capability key; fails loudly on an unknown harness. */
export function getAdapter(name: string): HarnessAdapter {
  const a = ADAPTERS[name];
  if (!a) fail(`unsupported harness: ${name}`);
  return a;
}

export { claudeAdapter, grokAdapter, opencodeAdapter, piAdapter, cursorAdapter, codexAdapter };
