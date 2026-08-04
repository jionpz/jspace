// adapters/scheduler/darwin.ts — macOS launchd adapter (tag-scoped).
// Installed-task identity carries the workbench tag: com.jspace.cron.<tag>.<id>
// in the plist Label + file name. inspect() filters by the tag so two
// workbenches never see (or delete) each other's agents.
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "../../application/errors.ts";
import { taskIdFor, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp } from "./types.ts";

export function plistPath(tag: string, id: string): string {
  return join(process.env.HOME ?? "", "Library", "LaunchAgents", `${taskIdFor(tag, id)}.plist`);
}

function listPlists(): string[] {
  const dir = join(process.env.HOME ?? "", "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("com.jspace.cron.") && n.endsWith(".plist"));
}

/** Parse a plist file name into (taskId, tag, cronId); null when unparseable. */
function parsePlistName(name: string): { taskId: string; tag: string; cronId: string } | null {
  const m = name.match(/^(com\.jspace\.cron\.)([^.]+)\.([^.]+)\.plist$/);
  if (!m) return null;
  return { taskId: m[1] + m[2] + "." + m[3], tag: m[2], cronId: m[3] };
}

/** Extract the StartCalendarInterval dict keys as a canonical schedule string
 *  (matches the cron.json `0 3 * * *` shape when mapped back). We only need
 *  enough to detect drift vs cron.json, not a full round-trip. */
function plistSchedule(name: string): string {
  const p = join(process.env.HOME ?? "", "Library", "LaunchAgents", name);
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
function plistArgv(name: string): string {
  const p = join(process.env.HOME ?? "", "Library", "LaunchAgents", name);
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

export const darwinAdapter: SchedulerAdapter = {
  platform: "darwin",

  inspect(tag: string): InstalledTask[] {
    const out: InstalledTask[] = [];
    for (const name of listPlists()) {
      const parsed = parsePlistName(name);
      if (!parsed) continue; // not ours (malformed — leave alone)
      if (parsed.tag !== tag) continue; // another workbench's agent — never touch
      out.push({
        taskId: parsed.taskId,
        cronId: parsed.cronId,
        schedule: plistSchedule(name),
        argv: plistArgv(name),
      });
    }
    return out;
  },

  apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[] {
    const cronId = op.taskId.split(".").pop() ?? op.taskId;
    const p = plistPath(tag, cronId);
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
  },

  uninstallAll(tag: string): string[] {
    const lines: string[] = [];
    for (const name of listPlists()) {
      const parsed = parsePlistName(name);
      if (!parsed || parsed.tag !== tag) continue;
      const p = join(process.env.HOME ?? "", "Library", "LaunchAgents", name);
      spawnSync("launchctl", ["unload", p]); // tolerate not-loaded
      if (existsSync(p)) unlinkSync(p);
      lines.push(`jspace: ok: removed ${name}`);
    }
    return lines;
  },
};
