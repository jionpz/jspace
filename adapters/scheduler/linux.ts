// adapters/scheduler/linux.ts — crontab adapter (managed block, tag-scoped).
// Task identity: com.jspace.cron.<tag>.<id> appears inside the managed-block
// comment lines; inspect() only matches lines whose task identity carries THIS
// workbench tag (parseManagedLine), so another workbench's crons are never
// touched. Crontab is machine-global and tag-filtered per line — no root/path
// matching is needed (an old build claimed env.resolvePath did that; it never did).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail } from "../../core/shared/errors.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { taskIdFor, posixIdentity, type InstalledTask, type SchedulerAdapter, type SchedulerEnv, type SchedulerIdentity, type SchedulerOp } from "./types.ts";

/** Tag-scoped managed-block markers: two workbenches never share one block. */
export const CRON_BLOCK_START = (tag: string): string => `# jspace crons ${tag} (managed) DO NOT EDIT`;
export const CRON_BLOCK_END = (tag: string): string => `# end jspace ${tag}`;
/** Pre-tag markers from unreleased builds — never silently claimed; fail loud. */
const LEGACY_BLOCK_START = "# jspace crons (managed) DO NOT EDIT";
const LEGACY_BLOCK_END = "# end jspace";

function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Managed crontab block for one workbench; every path is POSIX single-quoted, `%` escaped. */
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
  return `${CRON_BLOCK_START(tag)}\n${lines.join("\n")}\n${CRON_BLOCK_END(tag)}\n`;
}

/** Replace only THIS workbench's managed block in an existing crontab, preserving
 *  user lines and every other workbench's block. Fail loud on a legacy untagged
 *  block (never claimed), or on duplicate/stray/unterminated/out-of-order
 *  markers for this tag. */
export function replaceManagedBlock(existing: string, block: string, tag: string): string {
  const lines = existing.split("\n");
  const startMark = CRON_BLOCK_START(tag);
  const endMark = CRON_BLOCK_END(tag);
  const starts = lines.map((l, i) => (l.trim() === startMark ? i : -1)).filter((i) => i !== -1);
  const ends = lines.map((l, i) => (l.trim() === endMark ? i : -1)).filter((i) => i !== -1);
  if (lines.some((l) => l.trim() === LEGACY_BLOCK_START) || lines.some((l) => l.trim() === LEGACY_BLOCK_END)) {
    fail("crontab has a legacy untagged jspace block; remove it manually before reinstalling (old \"# jspace crons (managed)\" markers)");
  }
  if (starts.length > 1) fail(`crontab has multiple jspace blocks for workbench ${tag}; clean manually`);
  if (ends.length > 1) fail(`crontab has multiple jspace end markers for workbench ${tag}; clean manually`);
  if (starts.length === 1 && ends.length === 0) fail(`crontab has an unterminated jspace block for workbench ${tag}`);
  if (starts.length === 0 && ends.length === 1) fail(`crontab has a stray jspace end marker for workbench ${tag}`);
  if (starts.length === 1 && ends.length === 1 && ends[0] < starts[0]) fail(`crontab jspace markers out of order for workbench ${tag}`);
  const removing = block.trim() === "";
  if (starts.length === 0) {
    if (removing) return existing; // nothing to remove for this tag
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

/** Return THIS workbench's managed block (markers included), or "" when absent. */
export function extractTagBlock(existing: string, tag: string): string {
  const lines = existing.split("\n");
  const s = lines.findIndex((l) => l.trim() === CRON_BLOCK_START(tag));
  if (s === -1) return "";
  const e = lines.findIndex((l, i) => i > s && l.trim() === CRON_BLOCK_END(tag));
  if (e === -1) return "";
  return lines.slice(s, e + 1).join("\n");
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

/** Parse one managed-block crontab line into an InstalledTask, or null when it
 *  belongs to another workbench (tag mismatch) or is unparseable. Extracts the
 *  real schedule (first 5 fields) and reconstructs argv in buildDesired's
 *  canonical form (`cron run --id <id> --dir <root>`) so planReconciliation
 *  can no-op on identical state. Tag is parsed correctly from
 *  `com.jspace.cron.<tag>.<id>` (index 3, not 2 — segment 2 is the literal
 *  "cron"; the old split(".")[2] never matched and killed change detection). */
export function parseManagedLine(line: string, tag: string): InstalledTask | null {
  const m = line.match(
    /^(\S+ \S+ \S+ \S+ \S+)  cd '([^']*)' .*? cron run (?:--dir '([^']*)' --id '([^']+)'|--id '([^']+)' --dir '([^']*)').*? # (com\.jspace\.cron\.\S+)$/,
  );
  if (!m) return null;
  const id = m[4] ?? m[5];
  const dir = m[3] ?? m[6];
  const taskId = m[7];
  const parsedTag = taskId.replace(/^com\.jspace\.cron\./, "").split(".")[0];
  if (parsedTag !== tag) return null; // another workbench's crons — never touch
  return { taskId, cronId: id, schedule: m[1], argv: `cron run --id ${id} --dir ${dir}` };
}

export const linuxAdapter: SchedulerAdapter = {
  platform: "linux",

  identity(tag: string, cronId: string): SchedulerIdentity {
    return posixIdentity(tag, cronId);
  },

  inspect(tag: string): InstalledTask[] {
    const out: InstalledTask[] = [];
    const existing = readCrontab();
    for (const line of existing.split("\n")) {
      const parsed = parseManagedLine(line, tag);
      if (parsed) out.push(parsed);
    }
    return out;
  },

  apply(op: SchedulerOp, tag: string, root: string, _env: SchedulerEnv): string[] {
    const existing = readCrontab();
    if (op.action === "delete") {
      // remove just this cron's line from the current workbench block, keeping
      // sibling crons of the same tag and all other workbenches' blocks.
      const current = extractTagBlock(existing, tag);
      const keep = current
        .split("\n")
        .filter((l) => !l.includes(`# ${op.taskId}`) && l.trim() !== "" && l.trim() !== CRON_BLOCK_START(tag) && l.trim() !== CRON_BLOCK_END(tag));
      const rest = keep.length === 0 ? "" : `${CRON_BLOCK_START(tag)}\n${keep.join("\n")}\n${CRON_BLOCK_END(tag)}\n`;
      writeCrontab(replaceManagedBlock(existing, rest, tag));
      return [`jspace: ok: removed ${op.taskId}`];
    }
    // create/update: rebuild full block from desired set — but apply() gets one
    // op at a time; the reconciliation layer passes the whole new block via
    // content. Simpler: linux apply writes the content as the new block.
    const backup = join(root, ".jspace", "logs", "cron", "crontab.backup");
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(backup, existing, "utf-8");
    const merged = replaceManagedBlock(existing, op.content, tag);
    writeCrontab(merged);
    return [`jspace: ok: installed cron block (${op.taskId})`];
  },

  uninstallAll(tag: string, root: string, _env: SchedulerEnv): string[] {
    const existing = readCrontab();
    const merged = replaceManagedBlock(existing, "", tag);
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

  health(_env: SchedulerEnv): { crontab: boolean; service: boolean } {
    const c = spawnSync("sh", ["-c", "command -v crontab"], { encoding: "utf-8" });
    const s = spawnSync("sh", ["-c", "pgrep -x crond >/dev/null 2>&1 || pgrep -x cron >/dev/null 2>&1"], { encoding: "utf-8" });
    return { crontab: (c.stdout ?? "").trim() !== "", service: s.status === 0 };
  },
};
