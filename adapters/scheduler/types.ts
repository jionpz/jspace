// adapters/scheduler/types.ts — platform scheduler adapter contract.
// The automation layer (application/automation) is the only cron installer:
// dry-run and real install both go through planReconciliation + adapter
// inspect/apply. Task identity is workbench-scoped: com.jspace.cron.<tag>.<id>
// (darwin plist Label, linux managed-block lines, win32 schtasks task names),
// so two workbenches never collide on the same platform scheduler.
import { join } from "node:path";
import type { ScheduleDict } from "../../application/automation/definitions.ts";

export type PlatformName = "darwin" | "linux" | "win32";

export interface InstalledTask {
  /** platform identity, already workbench-tagged (com.jspace.cron.<tag>.<id>) */
  taskId: string;
  cronId: string;
  schedule: string;
  argv: string;
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
  /** platform-like root resolver for linux installed-cron matching */
  resolvePath: (p: string) => string;
}

export interface SchedulerAdapter {
  readonly platform: PlatformName;
  /** tasks installed for this workbench tag (never other tags — cross-workbench safety). */
  inspect(tag: string, env: SchedulerEnv): InstalledTask[];
  /** apply one op; returns a human line for the report. */
  apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[];
  /** remove every task for this tag (cron uninstall). */
  uninstallAll(tag: string, root: string, env: SchedulerEnv): string[];
  /** platform health for doctor (linux: crontab present + daemon running). */
  health?(env: SchedulerEnv): { crontab: boolean; service: boolean };
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

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** launchd plist body; Label carries the workbench tag (cross-workbench safety). */
export function buildPlist(id: string, tag: string, schedule: ScheduleDict, root: string, jspaceBin: string, home: string, path: string): string {
  const launchdDir = join(root, ".jspace", "logs", "cron");
  const keys = ["Minute", "Hour", "Day", "Month", "Weekday"] as const;
  const dict = keys.filter((k) => schedule[k] !== undefined)
    .map((k) => `    <key>${k}</key>\n    <integer>${schedule[k]}</integer>`)
    .join("\n");
  const taskId = taskIdFor(tag, id);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${taskId}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(jspaceBin)}</string>
    <string>cron</string>
    <string>run</string>
    <string>--id</string>
    <string>${xmlEscape(id)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${dict}
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(path)}</string>
    <key>HOME</key><string>${xmlEscape(home)}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xmlEscape(root)}</string>
  <key>StandardOutPath</key><string>${xmlEscape(join(launchdDir, `launchd-${id}.log`))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(join(launchdDir, `launchd-${id}.log`))}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}
