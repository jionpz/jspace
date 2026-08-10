// adapters/scheduler/scheduler.test.ts — scheduler adapter pure functions +
// cross-workbench tag isolation + reconciliation identity.
// Run: bun test adapters/scheduler/scheduler.test.ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskIdFor, workbenchTag } from "./types.ts";
import { buildPlist } from "./darwin.ts";
import { parseSchedule } from "../../core/shared/schedule.ts";
import { linuxAdapter, crontabBlock, crontabLine, replaceManagedBlock, parseManagedLine, extractTagBlock, CRON_BLOCK_START, CRON_BLOCK_END } from "./linux.ts";
import { darwinAdapter, plistPath, parsePlistName, plistBelongsToTag } from "./darwin.ts";
import { schtasksArgs, isWindowsInstallable, parseOpContent, parseSchtasksXml, win32Adapter } from "./win32.ts";
import { planReconciliation } from "../../application/automation/scheduler.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";

test("workbenchTag is stable + distinct across workbench ids", () => {
  const a = workbenchTag("wb-11111111-aaaa");
  const b = workbenchTag("wb-22222222-bbbb");
  expect(a).toBe(workbenchTag("wb-11111111-aaaa")); // stable
  expect(a).not.toBe(b); // distinct
  expect(a).toMatch(/^[0-9a-z]+$/); // short lowercase tag
});

test("taskIdFor is workbench-scoped", () => {
  const t1 = taskIdFor("abc123", "inbox-tidy");
  const t2 = taskIdFor("xyz789", "inbox-tidy");
  expect(t1).toBe("com.jspace.cron.abc123.inbox-tidy");
  expect(t2).toBe("com.jspace.cron.xyz789.inbox-tidy");
  expect(t1).not.toBe(t2); // same cron id, different workbenches -> distinct
});

test("crontabBlock embeds the workbench tag (cross-workbench safety)", () => {
  const cron: CronDefinition = {
    id: "inbox-tidy",
    schedule: "0 21 * * *",
    harness: "claude",
    prompt: "tidy the inbox",
    enabled: true,
  };
  const block = crontabBlock([cron], "abc123", "/wb/a", "/bin/jspace", "/usr/bin:/bin", "/home/u");
  expect(block).toContain("# com.jspace.cron.abc123.inbox-tidy");
  expect(block).toContain("cron run --dir '/wb/a' --id 'inbox-tidy'");
});

test("replaceManagedBlock preserves user lines and removes block", () => {
  const user = "# my manual cron\n* * * * * echo hi\n";
  const block = `${CRON_BLOCK_START("tagA")}\nX\n${CRON_BLOCK_END("tagA")}\n`;
  const merged = replaceManagedBlock(user + block, `${CRON_BLOCK_START("tagA")}\nY\n${CRON_BLOCK_END("tagA")}\n`, "tagA");
  expect(merged).toContain("# my manual cron");
  expect(merged).toContain("Y");
  expect(merged).not.toContain("X");
  const removed = replaceManagedBlock(merged, "", "tagA");
  expect(removed).toContain("# my manual cron");
  expect(removed).not.toContain("jspace crons");
});

test("schtasksArgs is DAILY/WEEKLY only + task name tagged", () => {
  const cron: CronDefinition = {
    id: "inbox-tidy",
    schedule: "0 21 * * *",
    harness: "claude",
    prompt: "x",
    enabled: true,
  };
  const args = schtasksArgs(cron, "C:\\bin\\jspace.exe", "C:\\wb", "JSpaceCron_abc123_inbox-tidy");
  expect(args).not.toBeNull();
  expect(args).toContain("JSpaceCron_abc123_inbox-tidy");
  expect(args).toContain("DAILY");
  expect(isWindowsInstallable("0 21 * * *")).toBe(true);
  expect(isWindowsInstallable("0 21 * * 1")).toBe(true); // weekly
  expect(isWindowsInstallable("0 21 15 * *")).toBe(false); // dom fixed -> not installable
});

// ---- migrated from cli/cron.test.ts (now single-source on the adapters) ----

test("crontabBlock quotes every path and escapes percent", () => {
  const c: CronDefinition = { id: "inbox-tidy", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };
  const block = crontabBlock([c], "tag", "/home/u/my work", "/opt/jspace/bin/jspace", "/usr/bin:/bin", "/home/u");
  expect(block).toContain("cd '/home/u/my work'");
  const pct = crontabBlock([{ ...c, id: "pct" }], "tag", "/tmp/100%folder", "/bin/jspace", "/bin", "/home");
  expect(pct).toContain("\\%");
});

test("crontabBlock rejects lines over 1000 chars", () => {
  const c: CronDefinition = { id: "long", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };
  const longRoot = "/x".repeat(1200);
  expect(() => crontabBlock([c], "tag", longRoot, "/bin/jspace", "/bin", "/home")).toThrow();
});

test("replaceManagedBlock: empty input -> block", () => {
  const block = `${CRON_BLOCK_START("tagA")}\n0 21 * * *  cmd\n${CRON_BLOCK_END("tagA")}\n`;
  expect(replaceManagedBlock("", block, "tagA")).toBe(block);
});

test("replaceManagedBlock: replaces old block, keeps user lines", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n" + `${CRON_BLOCK_START("tagA")}\n0 21 * * *  old\n${CRON_BLOCK_END("tagA")}\n` + "0 7 * * *  /usr/bin/other\n";
  const block = `${CRON_BLOCK_START("tagA")}\n0 22 * * *  new\n${CRON_BLOCK_END("tagA")}\n`;
  const out = replaceManagedBlock(existing, block, "tagA");
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 22 * * *  new");
  expect(out).not.toContain("0 21 * * *  old");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
});

test("replaceManagedBlock: no existing block -> appended", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n";
  const block = `${CRON_BLOCK_START("tagA")}\n0 21 * * *  new\n${CRON_BLOCK_END("tagA")}\n`;
  const out = replaceManagedBlock(existing, block, "tagA");
  expect(out.startsWith("0 6 * * *  /usr/bin/backup"));
  expect(out).toContain(block.trim());
});

test("replaceManagedBlock: empty block removes the jspace block", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n" + `${CRON_BLOCK_START("tagA")}\n0 21 * * *  old\n${CRON_BLOCK_END("tagA")}\n` + "0 7 * * *  /usr/bin/other\n";
  const out = replaceManagedBlock(existing, "", "tagA");
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
  expect(out).not.toContain("jspace crons");
  expect(out).not.toContain("0 21 * * *  old");
});

test("replaceManagedBlock: malformed + legacy markers throw loud", () => {
  const B = (t: string, body = "x") => `${CRON_BLOCK_START(t)}\n${body}\n${CRON_BLOCK_END(t)}\n`;
  expect(() => replaceManagedBlock(`${CRON_BLOCK_START("tagA")}\nx\n`, B("tagA"), "tagA")).toThrow(); // unterminated
  expect(() => replaceManagedBlock(`${CRON_BLOCK_END("tagA")}\n`, B("tagA"), "tagA")).toThrow(); // stray end
  expect(() => replaceManagedBlock(B("tagA") + B("tagA"), B("tagA"), "tagA")).toThrow(); // duplicate tag block
  expect(() => replaceManagedBlock(B("tagA") + `${CRON_BLOCK_END("tagA")}\n`, B("tagA"), "tagA")).toThrow(); // out of order
  expect(() => replaceManagedBlock("# jspace crons (managed) DO NOT EDIT\nx\n# end jspace\n", B("tagA"), "tagA")).toThrow(/legacy/);
});

test("replaceManagedBlock: other workbench's block preserved, not claimed", () => {
  const B = (t: string) => `${CRON_BLOCK_START(t)}\nx\n${CRON_BLOCK_END(t)}\n`;
  const mixed = B("tagB") + B("tagA");
  expect(replaceManagedBlock(mixed, "", "tagA")).toBe(B("tagB")); // only tagA removed
  expect(replaceManagedBlock(mixed, B("tagA2"), "tagA")).toContain(B("tagB")); // tagA updated, tagB untouched
});

test("extractTagBlock returns this workbench's block or empty", () => {
  const blockA = `${CRON_BLOCK_START("tagA")}\na\n${CRON_BLOCK_END("tagA")}\n`;
  const blockB = `${CRON_BLOCK_START("tagB")}\nb\n${CRON_BLOCK_END("tagB")}\n`;
  expect(extractTagBlock(blockA + blockB, "tagA")).toBe(blockA.trim());
  expect(extractTagBlock(blockA + blockB, "tagB")).toBe(blockB.trim());
  expect(extractTagBlock(blockA, "tagC")).toBe("");
});

test("schtasksArgs: DAILY and WEEKLY mapping", () => {
  const mk = (id: string, schedule: string): CronDefinition => ({ id, schedule, harness: "claude", prompt: "test", enabled: true });
  const daily = schtasksArgs(mk("inbox-tidy", "0 21 * * *"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_inbox");
  expect(daily).toContain("/sc"); expect(daily).toContain("DAILY"); expect(daily).toContain("/st"); expect(daily).toContain("21:00");
  expect(daily).toContain("/tn"); expect(daily).toContain("JSpaceCron_wb_inbox");
  expect(daily!.join(" ")).toContain('cron run --dir "C:\\wb" --id inbox-tidy');

  const weekly = schtasksArgs(mk("weekly", "0 21 * * 0"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_weekly");
  expect(weekly).toContain("WEEKLY"); expect(weekly).toContain("/d"); expect(weekly).toContain("SUN");
  const sun7 = schtasksArgs(mk("sun7", "0 21 * * 7"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_sun7");
  expect(sun7).toContain("SUN"); // dow=7 also maps to SUN
});

test("schtasksArgs: unsupported schedules -> null", () => {
  const mk = (id: string, schedule: string): CronDefinition => ({ id, schedule, harness: "claude", prompt: "test", enabled: true });
  expect(schtasksArgs(mk("monthly", "0 0 1 * *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
  expect(schtasksArgs(mk("dom", "0 0 1 6 *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
});

test("isWindowsInstallable", () => {
  expect(isWindowsInstallable("0 21 * * *")).toBe(true);
  expect(isWindowsInstallable("0 21 * * 0")).toBe(true);
  expect(isWindowsInstallable("0 0 1 * *")).toBe(false);
  expect(isWindowsInstallable("0 0 1 6 *")).toBe(false);
});

// ---- cron-convergence regression tests ----

test("parseOpContent: JSON argv round-trip survives spaces/quotes (win32 /tr fix)", () => {
  const args = [
    "/create", "/tn", "JSpaceCron_abc_inbox",
    "/tr", `"C:\\bin\\jspace.exe" cron run --dir "C:\\Users\\John Doe\\wb" --id inbox-tidy`,
    "/st", "21:00", "/f", "/it", "/sc", "DAILY",
  ];
  expect(parseOpContent(JSON.stringify(args))).toEqual(args);
  expect(() => parseOpContent("/create /tn x")).toThrow(); // not JSON
});

test("parseManagedLine: extracts schedule/argv + correct tag (was split(\".\")[2])", () => {
  const line = `0 21 * * *  cd '/wb/a' && PATH='/usr/bin:/bin' HOME='/home/u' '/bin/jspace' cron run --dir '/wb/a' --id 'inbox-tidy' >> '/wb/a/.jspace/logs/cron/crontab-inbox-tidy.log' 2>&1  # com.jspace.cron.abc123.inbox-tidy`;
  const parsed = parseManagedLine(line, "abc123");
  expect(parsed).toEqual({
    taskId: "com.jspace.cron.abc123.inbox-tidy",
    cronId: "inbox-tidy",
    schedule: "0 21 * * *",
    argv: "cron run --id inbox-tidy --dir /wb/a",
  });
  // other workbench's tag -> null (cross-workbench isolation)
  expect(parseManagedLine(line, "xyz789")).toBeNull();
  // reverse arg order (--id then --dir) still parses
  const reverse = `0 9 * * 0  cd '/wb/b' && PATH='/bin' HOME='/h' '/bin/jspace' cron run --id 'weekly' --dir '/wb/b' >> '/wb/b/log' 2>&1  # com.jspace.cron.zzz.weekly`;
  expect(parseManagedLine(reverse, "zzz")).toMatchObject({ cronId: "weekly", schedule: "0 9 * * 0", argv: "cron run --id weekly --dir /wb/b" });
  // garbage -> null
  expect(parseManagedLine("not a cron line", "abc123")).toBeNull();
});

test("parseSchtasksXml: DAILY + WEEKLY + spaces root + unparseable", () => {
  const daily = `<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Actions><Exec><Command>C:\\bin\\jspace.exe</Command><Arguments>&quot;C:\\bin\\jspace.exe&quot; cron run --dir &quot;C:\\Users\\John Doe\\wb&quot; --id inbox-tidy</Arguments></Exec></Actions></Task>`;
  expect(parseSchtasksXml(daily)).toEqual({ schedule: "0 21 * * *", argv: "cron run --id inbox-tidy --dir C:\\Users\\John Doe\\wb" });
  const weekly = `<Task xmlns="x"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T09:30:00</StartBoundary><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Sunday/></DaysOfWeek></ScheduleByWeek></CalendarTrigger></Triggers><Actions><Exec><Arguments>cron run --dir "C:\\wb" --id weekly</Arguments></Exec></Actions></Task>`;
  expect(parseSchtasksXml(weekly)).toEqual({ schedule: "30 9 * * 0", argv: "cron run --id weekly --dir C:\\wb" });
  expect(parseSchtasksXml("<Task/>")).toBeNull();
  expect(parseSchtasksXml(`<Task><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary><ScheduleByDay/></CalendarTrigger></Triggers><Actions><Exec><Arguments>no --dir here</Arguments></Exec></Actions></Task>`)).toBeNull();
});

test("darwin plistPath + parsePlistName use injected home + tagged identity", () => {
  expect(plistPath("abc123", "inbox-tidy", "/Users/u")).toBe("/Users/u/Library/LaunchAgents/com.jspace.cron.abc123.inbox-tidy.plist");
  expect(parsePlistName("com.jspace.cron.abc123.inbox-tidy.plist")).toEqual({ taskId: "com.jspace.cron.abc123.inbox-tidy", tag: "abc123", cronId: "inbox-tidy" });
  expect(parsePlistName("com.jspace.cron.inbox-tidy.plist")).toBeNull(); // legacy untagged — not ours
  expect(parsePlistName("random.txt")).toBeNull();
});

test("plistBelongsToTag: same tag yes, other tag no, legacy untagged no (cross-workbench safety)", () => {
  expect(plistBelongsToTag("com.jspace.cron.abc123.inbox-tidy.plist", "abc123")).toBe(true);
  expect(plistBelongsToTag("com.jspace.cron.xyz789.inbox-tidy.plist", "abc123")).toBe(false);
  expect(plistBelongsToTag("com.jspace.cron.inbox-tidy.plist", "abc123")).toBe(false); // legacy untagged
  expect(plistBelongsToTag("random.txt", "abc123")).toBe(false);
});

// ---- P0: two workbenches on one crontab (tag-scoped block ownership) ----
// A second workbench's install/update/uninstall must never touch the first
// workbench's block or the user's own crontab lines.

const mkCron = (id: string, schedule: string): CronDefinition => ({ id, schedule, harness: "claude", prompt: "x", enabled: true });
const USER_CRONTAB = "# manual cron\n* * * * * /usr/bin/tick\n";

test("P0: two workbench installs coexist — B install/update preserves A's block", () => {
  const afterA = replaceManagedBlock(USER_CRONTAB, crontabBlock([mkCron("task-a", "0 1 * * *")], "tagA", "/wb/a", "/bin/jspace", "/bin", "/home/u"), "tagA");
  const afterB = replaceManagedBlock(afterA, crontabBlock([mkCron("task-b", "0 2 * * *")], "tagB", "/wb/b", "/bin/jspace", "/bin", "/home/u"), "tagB");
  expect(afterB).toContain("cron run --dir '/wb/b'"); // B installed
  expect(afterB).toContain("cron run --dir '/wb/a'"); // A's line survives
  expect(afterB).toContain("/usr/bin/tick"); // user line survives
  // A later updates its schedule; B's block stays untouched
  const afterA2 = replaceManagedBlock(afterB, crontabBlock([mkCron("task-a", "0 3 * * *")], "tagA", "/wb/a", "/bin/jspace", "/bin", "/home/u"), "tagA");
  expect(afterA2).toContain("0 3 * * *"); // A updated
  expect(afterA2).toContain("cron run --dir '/wb/b'"); // B untouched
});

test("P0: B uninstall preserves A's block", () => {
  const afterA = replaceManagedBlock(USER_CRONTAB, crontabBlock([mkCron("task-a", "0 1 * * *")], "tagA", "/wb/a", "/bin/jspace", "/bin", "/home/u"), "tagA");
  const afterB = replaceManagedBlock(afterA, crontabBlock([mkCron("task-b", "0 2 * * *")], "tagB", "/wb/b", "/bin/jspace", "/bin", "/home/u"), "tagB");
  const removed = replaceManagedBlock(afterB, "", "tagB"); // B uninstalls
  expect(removed).toContain("cron run --dir '/wb/a'"); // A's crons survive
  expect(removed).not.toContain("cron run --dir '/wb/b'");
  expect(removed).toContain("/usr/bin/tick");
});

// ---- P0: canonical identity + reconciliation convergence ----
// Desired and Installed taskId must come from the SAME adapter identity, so
// planReconciliation converges (create -> no-op -> update -> delete) instead of
// emitting a create followed by a delete for one real task.

test("P0: identity single source — POSIX dotted for darwin/linux, schtasks handle for win32", () => {
  expect(darwinAdapter.identity("tagA", "inbox").taskId).toBe("com.jspace.cron.tagA.inbox");
  expect(linuxAdapter.identity("tagA", "inbox").taskId).toBe("com.jspace.cron.tagA.inbox");
  const win = win32Adapter.identity("tagA", "inbox");
  expect(win.logicalId).toBe("com.jspace.cron.tagA.inbox"); // stable cross-platform logical id
  expect(win.taskId).toBe("JSpaceCron_tagA_inbox"); // real schtasks task-name handle
});

test("P0: win32 reconciliation converges — desired identity == inspect handle (no create+delete)", () => {
  const tag = "tagA";
  const cron = mkCron("inbox", "0 21 * * *");
  const taskId = win32Adapter.identity(tag, cron.id).taskId;
  // Content must come from the real adapter path (was: hand-crafted schtasksArgs
  // that bypassed buildContent and masked the /tn task-name mismatch — issue #8 #1).
  const content = win32Adapter.buildContent(cron, tag, "C:\\wb", { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" });
  // buildContent must emit the SAME task-name handle identity()/inspect() use —
  // a mismatch means inspect() never finds the created task (always re-create,
  // uninstall orphans it).
  const argv = JSON.parse(content) as string[];
  expect(argv[argv.indexOf("/tn") + 1]).toBe(taskId);
  const desired = [{ taskId, cronId: cron.id, schedule: cron.schedule, argv: "cron run --id inbox --dir C:\\wb", content }];
  const installed = [{ taskId: "JSpaceCron_tagA_inbox", cronId: "inbox", schedule: "0 21 * * *", argv: "cron run --id inbox --dir C:\\wb" }];
  expect(planReconciliation(desired, installed)).toEqual([]); // identical -> no-op, NOT create+delete
  const changed = [{ ...desired[0], schedule: "0 22 * * *" }];
  expect(planReconciliation(changed, installed)).toEqual([{ action: "update", taskId, content }]); // changed -> update
  expect(planReconciliation([], installed)).toEqual([{ action: "delete", taskId }]); // removed -> delete
  expect(planReconciliation(desired, [])).toEqual([{ action: "create", taskId, content }]); // new -> create
});

test("P0: win32 buildContent /tn is the inspect/uninstall task-name handle (DAILY + WEEKLY)", () => {
  const tag = "tagA";
  const env = { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" };
  for (const [id, schedule] of [["inbox", "0 21 * * *"], ["weekly", "0 9 * * 7"]] as const) {
    const cron = mkCron(id, schedule);
    const argv = JSON.parse(win32Adapter.buildContent(cron, tag, "C:\\wb", env)) as string[];
    const tn = argv[argv.indexOf("/tn") + 1];
    expect(tn).toBe(win32Adapter.identity(tag, id).taskId); // single source of the task-name handle
    expect(tn).toMatch(/^JSpaceCron_tagA_/); // queryTasks()/inspect()/uninstallAll() prefix
  }
});

test("P0: darwin reconciliation converges — plist identity == inspect parse", () => {
  const tag = "tagA";
  const cron = mkCron("inbox", "0 21 * * *");
  const id = darwinAdapter.identity(tag, cron.id); // posix dotted
  const content = buildPlist(cron.id, tag, parseSchedule(cron.schedule), "/wb", "/bin/jspace", "/Users/u", "/bin");
  const desired = [{ taskId: id.taskId, cronId: cron.id, schedule: cron.schedule, argv: "cron run --id inbox --dir /wb", content }];
  // what inspect() would parse back from the installed plist file name
  const installed = [{ taskId: parsePlistName(`${id.taskId}.plist`)!.taskId, cronId: "inbox", schedule: "0 21 * * *", argv: "cron run --id inbox --dir /wb" }];
  expect(planReconciliation(desired, installed)).toEqual([]); // identical -> no-op
  const changed = [{ ...desired[0], schedule: "0 9 * * *" }];
  expect(planReconciliation(changed, installed)).toEqual([{ action: "update", taskId: id.taskId, content }]); // changed -> update
  expect(planReconciliation([], installed)).toEqual([{ action: "delete", taskId: id.taskId }]); // removed -> delete
});

test("P0: linux full convergence — two workbenches converge independently", () => {
  const blockFor = (cron: CronDefinition, tag: string, root: string) => crontabBlock([cron], tag, root, "/bin/jspace", "/bin", "/home/u");
  const install = (existing: string, cron: CronDefinition, tag: string, root: string) => replaceManagedBlock(existing, blockFor(cron, tag, root), tag);
  let crontab = install(USER_CRONTAB, mkCron("a", "0 1 * * *"), "tagA", "/wb/a");
  expect(crontab).toContain("cron run --dir '/wb/a'");
  expect(install(crontab, mkCron("a", "0 1 * * *"), "tagA", "/wb/a")).toBe(crontab); // re-install identical -> no-op
  crontab = install(crontab, mkCron("b", "0 2 * * *"), "tagB", "/wb/b");
  expect(crontab).toContain("cron run --dir '/wb/a'");
  expect(crontab).toContain("cron run --dir '/wb/b'"); // both coexist
  crontab = install(crontab, mkCron("a", "0 9 * * *"), "tagA", "/wb/a"); // A updates schedule
  expect(crontab).toContain("0 9 * * *");
  expect(crontab).toContain("cron run --dir '/wb/b'"); // B untouched
  crontab = replaceManagedBlock(crontab, "", "tagB"); // B uninstalls
  expect(crontab).not.toContain("cron run --dir '/wb/b'");
  expect(crontab).toContain("cron run --dir '/wb/a'"); // A survives
});

// ---- P2-1: linux whole-block semantics live in the adapter (applyBatch) ----

test("linux buildContent returns a real per-cron crontab line, not a placeholder", () => {
  const cron = mkCron("inbox", "0 21 * * *");
  const content = linuxAdapter.buildContent(cron, "abc123", "/wb/a", { jspaceBinary: "/bin/jspace", home: "/home/u", path: "/bin" });
  expect(content).toContain("cron run --dir '/wb/a' --id 'inbox'");
  expect(content).toContain("# com.jspace.cron.abc123.inbox");
});

test("crontabLine rejects newline/CR/NUL in values (newline injection, issue #8 #12)", () => {
  const cron = mkCron("inbox", "0 21 * * *");
  expect(() => crontabLine(cron, "tagA", "/wb\n/etc/passwd", "/bin/jspace", "/bin", "/home/u")).toThrow(/newline|CR|NUL/);
  expect(() => crontabLine(cron, "tagA", "/wb", "/bin/jspace", "/bin", "/home/u\nx")).toThrow(/newline|CR|NUL/);
});

test("crontabLine -> parseManagedLine round-trips roots with ' % and spaces (issue #8 #12)", () => {
  for (const root of ["/wb/acme's", "/wb/100%", "/wb/with space"]) {
    const cron = mkCron("inbox", "0 21 * * *");
    const line = crontabLine(cron, "tagA", root, "/bin/jspace", "/bin", "/home/u");
    const parsed = parseManagedLine(line, "tagA");
    expect(parsed).not.toBeNull();
    expect(parsed!.cronId).toBe("inbox");
    expect(parsed!.argv).toBe(`cron run --id inbox --dir ${root}`); // unquoted back -> matches desired
  }
});

// ---- P2-1: linux applyBatch whole-block semantics (direct, injected IO) ----
// applyBatch is the only safe crontab write path (crontab is whole-file). These
// tests inject the CrontabIO seam so the real crontab is never touched; the
// backup file lands in a throwaway tmp root.

const LINUX_ENV = { jspaceBinary: "/bin/jspace", home: "/home/u", path: "/bin" };

test("linux applyBatch: empty enabled removes this workbench's whole block, preserves others", () => {
  const tagA = "tagA";
  const crontab =
    USER_CRONTAB.trim() + "\n" +
    crontabBlock([mkCron("a1", "0 1 * * *"), mkCron("a2", "0 2 * * *")], tagA, "/wb/a", "/bin/jspace", "/bin", "/home/u") +
    crontabBlock([mkCron("b1", "0 3 * * *")], "tagB", "/wb/b", "/bin/jspace", "/bin", "/home/u");
  const root = mkdtempSync(join(tmpdir(), "jspace-lin-ab-"));
  let written = "";
  const savedIO = linuxAdapter.io;
  linuxAdapter.io = {
    readCrontab: () => crontab,
    writeCrontab: (c) => { written = c; },
  };
  try {
    linuxAdapter.applyBatch([], [], tagA, root, LINUX_ENV);
  } finally {
    linuxAdapter.io = savedIO;
    rmSync(root, { recursive: true, force: true });
  }
  expect(written).not.toContain(CRON_BLOCK_START(tagA));
  expect(written).not.toContain("com.jspace.cron.tagA");
  expect(written).toContain(CRON_BLOCK_END("tagB")); // other workbench's block intact
  expect(written).toContain("/usr/bin/tick"); // user line intact
});

test("linux applyBatch: non-empty enabled rebuilds the whole block from the enabled set, idempotent", () => {
  const tagA = "tagA";
  const crontab = USER_CRONTAB + crontabBlock([mkCron("a1", "0 1 * * *")], tagA, "/wb/a", "/bin/jspace", "/bin", "/home/u");
  const enabled = [mkCron("a1", "0 1 * * *"), mkCron("a2", "0 2 * * *")];
  // one tmp root for both runs so the embedded root path in each crontab line
  // is stable — otherwise a fresh root per run breaks the idempotence check.
  const root = mkdtempSync(join(tmpdir(), "jspace-lin-ab-"));
  const run = (): string => {
    let written = "";
    const savedIO = linuxAdapter.io;
    linuxAdapter.io = {
      readCrontab: () => crontab,
      writeCrontab: (c) => { written = c; },
    };
    try {
      linuxAdapter.applyBatch([], enabled, tagA, root, LINUX_ENV);
    } finally {
      linuxAdapter.io = savedIO;
    }
    return written;
  };
  try {
    const once = run();
    expect(once).toContain(CRON_BLOCK_START(tagA));
    expect(once).toContain(CRON_BLOCK_END(tagA));
    expect(once).toContain("com.jspace.cron.tagA.a1");
    expect(once).toContain("com.jspace.cron.tagA.a2");
    expect(once).toContain("/usr/bin/tick"); // user line preserved
    expect(run()).toBe(once); // idempotent: same root, identical input -> identical output
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
