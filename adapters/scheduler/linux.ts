// adapters/scheduler/linux.ts — crontab adapter (managed block, tag-scoped).
// Task identity: com.jspace.cron.<tag>.<id> appears inside the managed-block
// comment lines; inspect() only matches this workbench root (env.resolvePath)
// so another workbench's crons are never touched.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "../../application/errors.ts";
import { parseSchedule } from "../../application/automation/definitions.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { taskIdFor, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerOp } from "./types.ts";

export const CRON_BLOCK_START = "# jspace crons (managed) DO NOT EDIT";
export const CRON_BLOCK_END = "# end jspace";

function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Managed crontab block; every path is POSIX single-quoted, `%` escaped. */
export function crontabBlock(
  crons: CronDefinition[],
  tag: string,
  root: string,
  jspaceBin: string,
  path: string,
  home: string,
): string {
  const lines = crons
    .filter((c) => c.enabled)
    .map((c) => {
      const d = parseSchedule(c.schedule);
      const dom = d.Day ?? "*";
      const mon = d.Month ?? "*";
      const dow = d.Weekday ?? "*";
      const log = join(root, ".jspace", "logs", "cron", `crontab-${c.id}.log`);
      const line =
        `${d.Minute} ${d.Hour} ${dom} ${mon} ${dow}  ` +
        `cd ${shq(root)} && PATH=${shq(path)} HOME=${shq(home)} ${shq(jspaceBin)} cron run --dir ${shq(root)} --id ${shq(c.id)} ` +
        `>> ${shq(log)} 2>&1  # ${taskIdFor(tag, c.id)}`;
      if (line.length > 1000) fail(`crontab line for ${c.id} exceeds 1000 characters`);
      return line.replace(/%/g, "\\%");
    });
  return `${CRON_BLOCK_START}\n${lines.join("\n")}\n${CRON_BLOCK_END}\n`;
}

/** Replace the managed block in an existing crontab, preserving user lines. */
export function replaceManagedBlock(existing: string, block: string): string {
  const lines = existing.split("\n");
  const starts = lines.map((l, i) => (l.trim() === CRON_BLOCK_START ? i : -1)).filter((i) => i !== -1);
  const ends = lines.map((l, i) => (l.trim() === CRON_BLOCK_END ? i : -1)).filter((i) => i !== -1);
  if (starts.length > 1 || ends.length > 1) fail("crontab has multiple jspace blocks; clean manually");
  if (starts.length === 1 && ends.length === 0) fail("crontab has unterminated jspace block");
  if (starts.length === 0 && ends.length === 1) fail("crontab has a stray jspace end marker");
  if (starts.length === 1 && ends.length === 1 && ends[0] < starts[0]) fail("crontab jspace markers out of order");
  const removing = block.trim() === "";
  if (starts.length === 0) {
    if (removing) return existing; // nothing to remove
    const base = existing.replace(/\s+$/, "");
    return base ? `${base}\n${block}` : block;
  }
  const before = lines.slice(0, starts[0]);
  const after = lines.slice(ends[0] + 1);
  const blockLines = removing ? [] : block.replace(/\n$/, "").split("\n");
  let result = [...before, ...blockLines, ...after].join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}

function readCrontab(): string {
  const res = spawnSync("crontab", ["-l"], { encoding: "utf-8" });
  if (res.status === 0) return (res.stdout ?? "").replace(/\s+$/, "") + "\n";
  if (res.status === 1) return ""; // no crontab
  fail(`crontab -l failed (status ${res.status}): ${(res.stderr ?? "").trim()}`);
  return "";
}

function writeCrontab(content: string): void {
  const r = spawnSync("crontab", ["-"], { input: content, encoding: "utf-8" });
  if (r.status !== 0) fail(`crontab write failed: ${(r.stderr ?? "").trim()}`);
}

export const linuxAdapter: SchedulerAdapter = {
  platform: "linux",

  inspect(tag: string): InstalledTask[] {
    const out: InstalledTask[] = [];
    const existing = readCrontab();
    // managed-block lines carry the workbench tag suffix: com.jspace.cron.<tag>.<id>
    for (const m of existing.matchAll(/cron run --dir '([^']*)' --id '([^']+)'.*?# (com\.jspace\.cron\.[^ ]+)/g)) {
      const [, , id, taskId] = m;
      const parsedTag = taskId.split(".")[2];
      if (parsedTag !== tag) continue; // another workbench's crons — never touch
      out.push({ taskId, cronId: id, schedule: "", argv: "" });
    }
    return out;
  },

  apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[] {
    const existing = readCrontab();
    if (op.action === "delete") {
      // rebuild block without this cron: parse existing, drop the taskId line
      const kept = existing
        .split("\n")
        .filter((l) => !l.includes(`# ${op.taskId}`))
        .join("\n");
      const merged = replaceManagedBlock(kept, "");
      writeCrontab(merged);
      return [`jspace: ok: removed ${op.taskId}`];
    }
    // create/update: rebuild full block from desired set — but apply() gets one
    // op at a time; the reconciliation layer passes the whole new block via
    // content. Simpler: linux apply writes the content as the new block.
    const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(backup, existing, "utf-8");
    const merged = replaceManagedBlock(existing, op.content);
    writeCrontab(merged);
    return [`jspace: ok: installed cron block (${op.taskId})`];
  },

  uninstallAll(_tag: string, root: string, env: SchedulerEnv): string[] {
    const existing = readCrontab();
    const merged = replaceManagedBlock(existing, "");
    const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(backup, existing, "utf-8");
    if (merged.trim() === "") {
      const r = spawnSync("crontab", ["-r"], { encoding: "utf-8" });
      if (r.status !== 0 && r.status !== 1) fail(`crontab -r failed: ${(r.stderr ?? "").trim()}`);
      return ["jspace: ok: removed jspace crons (empty crontab removed)"];
    }
    writeCrontab(merged);
    return ["jspace: ok: removed jspace crons from crontab"];
  },

  health(env: SchedulerEnv): { crontab: boolean; service: boolean } {
    const c = spawnSync("sh", ["-c", "command -v crontab"], { encoding: "utf-8" });
    const s = spawnSync("sh", ["-c", "pgrep -x crond >/dev/null 2>&1 || pgrep -x cron >/dev/null 2>&1"], { encoding: "utf-8" });
    return { crontab: (c.stdout ?? "").trim() !== "", service: s.status === 0 };
  },
};
