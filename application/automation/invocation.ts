// application/automation/invocation.ts — CronRunInvocation <-> argv codec.
// The single source for how scheduler backends serialize a run request; the CLI
// codec parses that argv back through the real parser (contract test pins the
// round-trip — closes the batch-identity audit).
import type { CronRunInvocation } from "../../core/contracts/cron.ts";

/** Serialize an invocation to the `cron run` argv a scheduler should install.
 *  `--id` is the canonical form; positional `id` remains a CLI convenience.
 *
 *  `bin` (when given) becomes argv[0]. It is part of the reconciliation key on
 *  purpose: the installed task's binary path is what the scheduler will
 *  actually exec, so a drift (e.g. a plist left pointing at a stale dev build)
 *  must produce an `update` instead of comparing equal forever. The read-back
 *  sides reconstruct the same prefixed form. */
export function invocationArgv(inv: CronRunInvocation, bin?: string): string[] {
  const a = ["cron", "run", "--id", inv.cronId, "--dir", inv.workbench];
  if (inv.force) a.push("--force");
  if (inv.timeoutSec !== undefined) a.push("--timeout", String(inv.timeoutSec));
  return bin !== undefined ? [bin, ...a] : a;
}
