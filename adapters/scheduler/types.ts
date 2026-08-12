// adapters/scheduler/types.ts — platform scheduler adapter contract.
// The automation layer (application/automation) is the only cron installer:
// dry-run and real install both go through planReconciliation + adapter
// inspect/apply. Task identity is workbench-scoped: com.jspace.cron.<tag>.<id>
// (darwin plist Label, linux managed-block lines, win32 schtasks task names),
// so two workbenches never collide on the same platform scheduler.
import type { CronDefinition } from "../../core/contracts/cron.ts";

export type PlatformName = "darwin" | "linux" | "win32";

/** External scheduler commands (crontab/schtasks/plutil/launchctl) must never
 *  block the CLI without a cap — same red line as gbrain's process spawn
 *  (GBRAIN_TIMEOUT_MS). A hung platform tool degrades to fail-loud (linux) or
 *  empty-result (win32/darwin) instead of hanging the session. */
export const SCHEDULER_SPAWN_TIMEOUT_MS = 10_000;

export interface InstalledTask {
  /** platform identity, already workbench-tagged (com.jspace.cron.<tag>.<id>) */
  taskId: string;
  cronId: string;
  schedule: string;
  argv: string;
}

/** Desired task for one cron (what the scheduler service wants installed). */
export interface DesiredTask {
  /** platform identity including the workbench tag (e.g. com.jspace.cron.<tag>.<id>) */
  taskId: string;
  cronId: string;
  schedule: string;
  /** installed command line; used for change detection */
  argv: string;
  /** adapter-specific install content (plist / crontab block / schtasks args) */
  content: string;
}

export type SchedulerOp =
  | { action: "create"; taskId: string; content: string }
  | { action: "update"; taskId: string; content: string }
  | { action: "delete"; taskId: string };

/** Runtime deps injected by the CLI layer (which owns path/binary resolution). */
export interface SchedulerEnv {
  jspaceBinary: string;
  home: string;
  path: string;
}

/** Canonical identity for one cron. Single source of truth for the platform
 *  handle: desired, inspect and apply must all use `taskId` from the SAME
 *  adapter identity (the CLI must never build task names itself). */
export interface SchedulerIdentity {
  /** stable logical identity (workbenchTag + cronId), platform-independent */
  logicalId: string;
  /** platform inspect/apply handle (plist Label / schtasks task name) */
  taskId: string;
}

/** Scheduler health tri-state. `ok` = confirmed working, the negative states
 *  mean confirmed broken, `unverifiable` = detection failed in a way that may
 *  be environmental (PID namespace / UID isolation) rather than a real fault —
 *  doctor maps unverifiable to info, not warning (issue #10). */
export type SchedulerHealth = "ok" | "stopped" | "missing" | "unverifiable";

/** Linux cron health surface. service: ok / stopped (confirmed daemon state) /
 *  unverifiable. crontab: ok / missing (confirmed absent) / unverifiable. */
export interface LinuxCronHealth {
  crontab: Exclude<SchedulerHealth, "stopped">;
  service: Exclude<SchedulerHealth, "missing">;
}

export interface SchedulerAdapter {
  readonly platform: PlatformName;
  /** canonical platform identity for a cron (single source — never assembled
   *  outside the adapter). */
  identity(tag: string, cronId: string): SchedulerIdentity;
  /** Compile the platform install content for one cron (plist body / managed
   *  crontab line / schtasks args). Content building is adapter-internal; the
   *  application layer never switches on platform to produce it. */
  buildContent(cron: CronDefinition, tag: string, root: string, env: SchedulerEnv): string;
  /** tasks installed for this workbench tag (never other tags — cross-workbench safety). */
  inspect(tag: string, env: SchedulerEnv): InstalledTask[];
  /** Apply a batch of reconciliation ops. Default semantic: one op at a time
   *  (darwin/win32). A platform whose install is whole-file (linux crontab is
   *  whole-file) re-derives its content from the FULL enabled set and applies
   *  once — a delete-only op set must not wipe still-enabled crons, and an
   *  empty enabled set removes the whole managed block. The whole-block shape
   *  is an adapter-internal detail; callers always see per-cron ops. */
  applyBatch(ops: SchedulerOp[], enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv): string[];
  /** remove every task for this tag (cron uninstall). */
  uninstallAll(tag: string, root: string, env: SchedulerEnv): string[];
  /** platform health for doctor (linux: crontab present + daemon running).
   *  Returns tri-state so a sandbox / namespace-isolated environment that
   *  cannot verify the host scheduler reports `unverifiable` instead of a
   *  false "stopped/missing" (issue #10). */
  health?(env: SchedulerEnv): LinuxCronHealth;
}

/** Stable short workbench tag derived from marker workbench_id. Single source:
 *  both dry-run planning and adapters use this (never hash the path). */
export function workbenchTag(workbenchId: string): string {
  let h = 0;
  for (let i = 0; i < workbenchId.length; i++) h = (h * 31 + workbenchId.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Build the platform identity for a cron. */
export function taskIdFor(tag: string, id: string): string {
  return `com.jspace.cron.${tag}.${id}`;
}

/** POSIX identity: logicalId and platform taskId are the same dotted name
 *  (plist Label / linux managed-block comment). */
export function posixIdentity(tag: string, cronId: string): SchedulerIdentity {
  return { logicalId: taskIdFor(tag, cronId), taskId: taskIdFor(tag, cronId) };
}
