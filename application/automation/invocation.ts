// application/automation/invocation.ts — CronRunInvocation <-> argv codec.
// The single source for how scheduler backends serialize a run request; the CLI
// codec parses that argv back through the real parser (contract test pins the
// round-trip — closes audit F1).
import type { CronRunInvocation } from "../../core/contracts/cron.ts";

/** Serialize an invocation to the `cron run` argv a scheduler should install.
 *  `--id` is the canonical form; positional `id` remains a CLI convenience. */
export function invocationArgv(inv: CronRunInvocation): string[] {
  const a = ["cron", "run", "--id", inv.cronId, "--dir", inv.workbench];
  if (inv.force) a.push("--force");
  if (inv.timeoutSec !== undefined) a.push("--timeout", String(inv.timeoutSec));
  return a;
}
