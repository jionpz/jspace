// adapters/scheduler/scheduler.test.ts — scheduler adapter pure functions +
// cross-workbench tag isolation (AC1) + reconciliation identity.
// Run: bun test adapters/scheduler/scheduler.test.ts
import { expect, test } from "bun:test";
import { taskIdFor, workbenchTag } from "./types.ts";
import { crontabBlock, replaceManagedBlock, parseManagedLine } from "./linux.ts";
import { schtasksArgs, isWindowsInstallable, parseOpContent, parseSchtasksXml } from "./win32.ts";
import { plistPath, parsePlistName } from "./darwin.ts";
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
  const block = "# jspace crons (managed) DO NOT EDIT\nX\n# end jspace\n";
  const merged = replaceManagedBlock(user + block, "# jspace crons (managed) DO NOT EDIT\nY\n# end jspace\n");
  expect(merged).toContain("# my manual cron");
  expect(merged).toContain("Y");
  expect(merged).not.toContain("X");
  const removed = replaceManagedBlock(merged, "");
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
  const block = "# jspace crons (managed) DO NOT EDIT\n0 21 * * *  cmd\n# end jspace\n";
  expect(replaceManagedBlock("", block)).toBe(block);
});

test("replaceManagedBlock: replaces old block, keeps user lines", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n# jspace crons (managed) DO NOT EDIT\n0 21 * * *  old\n# end jspace\n0 7 * * *  /usr/bin/other\n";
  const block = "# jspace crons (managed) DO NOT EDIT\n0 22 * * *  new\n# end jspace\n";
  const out = replaceManagedBlock(existing, block);
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 22 * * *  new");
  expect(out).not.toContain("0 21 * * *  old");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
});

test("replaceManagedBlock: no existing block -> appended", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n";
  const block = "# jspace crons (managed) DO NOT EDIT\n0 21 * * *  new\n# end jspace\n";
  const out = replaceManagedBlock(existing, block);
  expect(out.startsWith("0 6 * * *  /usr/bin/backup"));
  expect(out).toContain(block.trim());
});

test("replaceManagedBlock: empty block removes the jspace block", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n# jspace crons (managed) DO NOT EDIT\n0 21 * * *  old\n# end jspace\n0 7 * * *  /usr/bin/other\n";
  const out = replaceManagedBlock(existing, "");
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
  expect(out).not.toContain("jspace crons");
  expect(out).not.toContain("0 21 * * *  old");
});

test("replaceManagedBlock: malformed markers throw", () => {
  const block = "# jspace crons (managed) DO NOT EDIT\nx\n# end jspace\n";
  expect(() => replaceManagedBlock("# jspace crons (managed) DO NOT EDIT\nx\n", block)).toThrow();
  expect(() => replaceManagedBlock("# end jspace\n", block)).toThrow();
  expect(() => replaceManagedBlock("# jspace crons (managed) DO NOT EDIT\nx\n# end jspace\n# jspace crons (managed) DO NOT EDIT\ny\n# end jspace\n", block)).toThrow();
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
