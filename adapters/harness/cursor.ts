// adapters/harness/cursor.ts — Cursor harness adapter (retained as a session
// harness). Cursor is IDE-only: no headless CLI, so it can never be a cron
// harness. Its session-start hook (sessionStart, additional_context injection)
// is a session channel only; nothing else is wired here.
import { join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { HarnessAdapter } from "./types.ts";
import { getCapability } from "./registry.ts";

const capability = getCapability("cursor");

export const cursorAdapter: HarnessAdapter = {
  name: "cursor",
  capability,
  headlessArgv(_prompt, _platform, _bin): string[] {
    fail("cursor has no headless CLI (IDE session harness); cron cannot run headlessly with cursor");
  },
  hookFilePath(workbench) {
    return join(workbench, ".cursor", "hooks.json");
  },
};
