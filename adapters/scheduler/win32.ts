// adapters/scheduler/win32.ts — schtasks adapter (tag-scoped).
// Task name carries the workbench tag: JSpaceCron_<tag>_<id>. inspect()
// filters by the tag so two workbenches never collide on scheduled tasks.
import { spawnSync } from "node:child_process";
import { fail } from "../../application/errors.ts";
import { parseSchedule } from "../../application/automation/definitions.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { workbenchTag, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp } from "./types.ts";

function taskName(tag: string, id: string): string {
  return `JSpaceCron_${tag}_${id}`;
}

function queryTasks(tag: string): string[] {
  const res = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf-8" });
  const out = res.status === 0 ? (res.stdout ?? "") : "";
  const prefix = `JSpaceCron_${tag}_`;
  return out
    .split(/\r?\n/)
    .map((l) => l.split(",")[0].replace(/^"|"$/g, ""))
    .filter((n) => n.startsWith(prefix));
}

/** Windows-only installable: DAILY (dom=* dow=*) or WEEKLY (dom=*, dow fixed); month=* and dom=*. */
export function isWindowsInstallable(schedule: string): boolean {
  const d = parseSchedule(schedule);
  return d.Month === undefined && d.Day === undefined;
}

/** Build schtasks args for a cron (DAILY/WEEKLY subset). Null when not expressible. */
export function schtasksArgs(cron: CronDefinition, jspaceBin: string, root: string, taskName: string): string[] | null {
  const d = parseSchedule(cron.schedule);
  if (!isWindowsInstallable(cron.schedule)) return null;
  const st = `${String(d.Hour).padStart(2, "0")}:${String(d.Minute).padStart(2, "0")}`;
  const tr = `"${jspaceBin}" cron run --dir "${root}" --id ${cron.id}`;
  const base = ["/create", "/tn", taskName, "/tr", tr, "/st", st, "/f", "/it"];
  if (d.Weekday === undefined) {
    return [...base, "/sc", "DAILY"];
  }
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return [...base, "/sc", "WEEKLY", "/d", days[d.Weekday % 7]]; // 0/7 -> SUN
}

export const win32Adapter: SchedulerAdapter = {
  platform: "win32",

  inspect(tag: string): InstalledTask[] {
    return queryTasks(tag).map((n) => ({
      taskId: n,
      cronId: n.slice(`JSpaceCron_${tag}_`.length),
      schedule: "",
      argv: "",
    }));
  },

  apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[] {
    if (op.action === "delete") {
      const res = spawnSync("schtasks", ["/delete", "/tn", op.taskId, "/f"], { encoding: "utf-8" });
      if (res.status !== 0) fail(`schtasks delete failed for ${op.taskId}: ${(res.stderr ?? "").trim()}`);
      return [`jspace: ok: removed ${op.taskId}`];
    }
    // create/update: op.content is the args array (space-joined) built by caller
    const args = op.content.split(" ");
    const res = spawnSync("schtasks", args, { encoding: "utf-8" });
    if (res.status !== 0) fail(`schtasks create failed for ${op.taskId}: ${(res.stderr ?? "").trim()}`);
    return [`jspace: ok: installed cron ${op.taskId.split("_").pop()} -> ${op.taskId}`];
  },

  uninstallAll(tag: string): string[] {
    const tasks = queryTasks(tag);
    const lines: string[] = [];
    for (const t of tasks) {
      const res = spawnSync("schtasks", ["/delete", "/tn", t, "/f"], { encoding: "utf-8" });
      if (res.status !== 0) fail(`schtasks delete failed for ${t}: ${(res.stderr ?? "").trim()}`);
      lines.push(`jspace: ok: removed ${t}`);
    }
    if (tasks.length === 0) lines.push("jspace: ok: no jspace scheduled tasks to remove");
    return lines;
  },
};

export { workbenchTag };
