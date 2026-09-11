// cli/commands/gbrain.ts — `jspace gbrain wire` — thin backward-compat alias for
// `jspace harness wire --harness claude`. All wiring semantics (existing-server
// merge, backup fail-closed, idempotency, dry-run) live in the single unified
// path in cli/commands/harness.ts — this command owns no writer/backup logic of
// its own, so the alias can never drift from the canonical path.
import type { CommandSpec, CmdContext, CmdResult } from "../../application/commands/command.ts";
import type { HarnessWireDeps } from "../../application/harness/wire.ts";
import { runHarnessWire } from "./harness.ts";

/** `gbrain wire` handler — exported for tests with injected deps (write
 *  failures must surface as errors + exit 1, never a silent exit 0 — issue #8 #9). */
export function wireHandler(ctx: CmdContext, deps?: HarnessWireDeps): CmdResult {
  return runHarnessWire(ctx, "claude", { deps, label: "gbrain wire" });
}

export const gbrainSpec: CommandSpec = {
  name: "gbrain",
  summary: "wire gbrain skill routing (GBRAIN_SKILLS_DIR → workbench .jspace/skills)",
  description:
    "Alias for `jspace harness wire --harness claude`: gbrain's skill resolver only auto-detects a root " +
    "`skills/` dir; wire it to the workbench's official skills by injecting GBRAIN_SKILLS_DIR=<wb>/.jspace/skills " +
    "into the gbrain MCP server env in ~/.claude.json.",
  features: { dir: true },
  children: [
    {
      name: "wire",
      summary: "inject GBRAIN_SKILLS_DIR=<wb>/.jspace/skills into the gbrain MCP server env (alias: harness wire --harness claude)",
      features: { dir: true, dryRun: true },
      handler: (ctx) => wireHandler(ctx),
    },
  ],
};
