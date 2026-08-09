// adapters/scheduler/darwin.ts — macOS launchd adapter (tag-scoped).
// Installed-task identity carries the workbench tag: com.jspace.cron.<tag>.<id>
// in the plist Label + file name. inspect() filters by the tag so two
// workbenches never see (or delete) each other's agents. The plist body is
// built here (adapter-internal content compilation; the application layer only
// calls buildContent).
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "../../core/shared/errors.ts";
import { parseSchedule, type ScheduleDict } from "../../core/shared/schedule.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { taskIdFor, posixIdentity, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp, type SchedulerIdentity } from "./types.ts";

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

export function plistPath(tag: string, id: string, home: string): string {
  return join(home, "Library", "LaunchAgents", `${taskIdFor(tag, id)}.plist`);
}

function listPlists(home: string): string[] {
  const dir = join(home, "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("com.jspace.cron.") && n.endsWith(".plist"));
}

/** Parse a plist file name into (taskId, tag, cronId); null when unparseable. */
export function parsePlistName(name: string): { taskId: string; tag: string; cronId: string } | null {
  const m = name.match(/^(com\.jspace\.cron\.)([^.]+)\.([^.]+)\.plist$/);
  if (!m) return null;
  return { taskId: m[1] + m[2] + "." + m[3], tag: m[2], cronId: m[3] };
}

/** Pure: is this plist file name an installed task of the given workbench tag?
 *  Cross-workbench safety: a mismatched (or legacy untagged) plist is never ours. */
export function plistBelongsToTag(name: string, tag: string): boolean {
  const parsed = parsePlistName(name);
  return parsed !== null && parsed.tag === tag;
}

/** Extract the StartCalendarInterval dict keys as a canonical schedule string
 *  (matches the cron.json `0 3 * * *` shape when mapped back). We only need
 *  enough to detect drift vs cron.json, not a full round-trip. */
function plistSchedule(name: string, home: string): string {
  const p = join(home, "Library", "LaunchAgents", name);
  if (!existsSync(p)) return "";
  const res = spawnSync("plutil", ["-extract", "StartCalendarInterval", "json", "-o", "-", p], { encoding: "utf-8" });
  if (res.status !== 0) return "";
  try {
    const d = JSON.parse(res.stdout ?? "{}") as Record<string, number>;
    const min = d.Minute ?? "*";
    const hour = d.Hour ?? "*";
    const dom = d.Day ?? "*";
    const mon = d.Month ?? "*";
    const dow = d.Weekday ?? "*";
    return `${min} ${hour} ${dom} ${mon} ${dow}`;
  } catch {
    return "";
  }
}

/** Extract the WorkingDirectory from an installed plist (the workbench root the
 *  cron runs against; matches buildDesired's argv intent). */
function plistArgv(name: string, home: string): string {
  const p = join(home, "Library", "LaunchAgents", name);
  if (!existsSync(p)) return "";
  // plutil -extract WorkingDirectory json fails on bare strings; use -p and grep
  const res = spawnSync("plutil", ["-p", p], { encoding: "utf-8" });
  if (res.status !== 0) return "";
  const m = (res.stdout ?? "").match(/"WorkingDirectory" => "([^"]+)"/);
  const wd = m?.[1] ?? "";
  const parts = name.replace(/\.plist$/, "").split(".");
  const id = parts[parts.length - 1] ?? "";
  // same shape as buildDesired.argv so planReconciliation no-ops on identical state
  return `cron run --id ${id} --dir ${wd}`;
}

/** Install one op (per-cron plist semantics). Private helper — the public write
 *  port is applyBatch (darwin applies ops one at a time, no whole-block reshape). */
function applyOne(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[] {
  const cronId = op.taskId.split(".").pop() ?? op.taskId;
  const p = plistPath(tag, cronId, env.home);
  if (op.action === "create" || op.action === "update") {
    mkdirSync(join(root, ".jspace", "logs", "cron"), { recursive: true });
    if (existsSync(p)) unlinkSync(p); // idempotent: replace
    writeFileSync(p, op.content, "utf-8"); // content = full plist body (caller-built)
    const lint = spawnSync("plutil", ["-lint", p], { encoding: "utf-8" });
    if (lint.status !== 0) fail(`plutil lint failed for ${p}: ${(lint.stderr ?? "").trim()}`);
    spawnSync("launchctl", ["unload", p]); // unload may fail (not loaded) — tolerate
    const load = spawnSync("launchctl", ["load", p], { encoding: "utf-8" });
    if (load.status !== 0) fail(`launchctl load failed for ${p}: ${(load.stderr ?? "").trim()}`);
    return [`jspace: ok: installed cron ${cronId} -> ${p.split("/").pop()}`];
  }
  // delete
  spawnSync("launchctl", ["unload", p]); // tolerate not-loaded
  if (existsSync(p)) unlinkSync(p);
  return [`jspace: ok: removed ${op.taskId}.plist`];
}

export const darwinAdapter: SchedulerAdapter = {
  platform: "darwin",

  identity(tag: string, cronId: string): SchedulerIdentity {
    return posixIdentity(tag, cronId);
  },

  buildContent(cron: CronDefinition, tag: string, root: string, env: SchedulerEnv): string {
    return buildPlist(cron.id, tag, parseSchedule(cron.schedule), root, env.jspaceBinary, env.home, env.path);
  },

  inspect(tag: string, env: SchedulerEnv): InstalledTask[] {
    const out: InstalledTask[] = [];
    for (const name of listPlists(env.home)) {
      if (!plistBelongsToTag(name, tag)) continue; // other workbench / legacy untagged — never touch
      const parsed = parsePlistName(name)!;
      out.push({
        taskId: parsed.taskId,
        cronId: parsed.cronId,
        schedule: plistSchedule(name, env.home),
        argv: plistArgv(name, env.home),
      });
    }
    return out;
  },

  // darwin installs per-cron plists — one op at a time, no whole-block reshape.
  applyBatch(ops: SchedulerOp[], _enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv): string[] {
    return ops.flatMap((o) => applyOne(o, tag, root, env));
  },

  uninstallAll(tag: string, _root: string, env: SchedulerEnv): string[] {
    const lines: string[] = [];
    for (const name of listPlists(env.home)) {
      if (!plistBelongsToTag(name, tag)) continue;
      const p = join(env.home, "Library", "LaunchAgents", name);
      spawnSync("launchctl", ["unload", p]); // tolerate not-loaded
      if (existsSync(p)) unlinkSync(p);
      lines.push(`jspace: ok: removed ${name}`);
    }
    return lines;
  },
};
