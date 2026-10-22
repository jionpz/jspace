// adapters/scheduler/scheduler.test.ts — scheduler adapter pure functions +
// cross-workbench tag isolation + reconciliation identity.
// Run: bun test adapters/scheduler/scheduler.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskIdFor, workbenchTag, SCHEDULER_SPAWN_TIMEOUT_MS } from "./types.ts";
import { makeSchedulerSpawn, type SchedulerSpawn, type SchedulerSpawnImpl, type SchedulerSpawnImplOpts } from "./spawn.ts";
import { isWindowsInstallable } from "../../core/shared/schedule.ts";
import { linuxAdapter, makeLinuxAdapter, crontabBlock, crontabLine, crontabUnavailable, replaceManagedBlock, parseManagedLine, extractTagBlock, pidNamespaceIsolated, envPathFromLine, CRON_BLOCK_START, CRON_BLOCK_END } from "./linux.ts";
import { darwinAdapter, inspectDarwin, plistPath, parsePlistName, plistBelongsToTag, scheduleFromIntervalDict, argvFromPlistStdout, envPathFromPlistStdout } from "./darwin.ts";
import { schtasksArgs, parseOpContent, parseSchtasksXml, win32Adapter, csvTaskName, cronIdFromTaskName, queryTasksFromOutput } from "./win32.ts";
import { planReconciliation } from "../../application/automation/scheduler.ts";
import { buildDesired } from "../../application/automation/scheduler-service.ts";
import { invocationArgv } from "../../application/automation/invocation.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import type { InstalledTask } from "./types.ts";

// ---- P1-3: external scheduler commands always carry a timeout (red line) ----
// No bare spawnSync in the scheduler layer: every crontab/schtasks/plutil/
// launchctl call routes through schedulerSpawn, which forces utf-8 + the shared
// timeout. Inject a fake spawn to observe the options without a real command.

test("schedulerSpawn forces utf-8 + the shared timeout on every call", () => {
  const calls: { cmd: string; args: string[]; opts: SchedulerSpawnImplOpts }[] = [];
  const fakeSpawn: SchedulerSpawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0, stdout: "", stderr: "", pid: 1, signal: null, output: [] } as never;
  };
  const run = makeSchedulerSpawn(fakeSpawn);

  run("crontab", ["-l"]);
  run("schtasks", ["/query", "/tn", "x"]);
  run("plutil", ["-lint", "/x.plist"]);

  expect(calls.length).toBe(3);
  for (const c of calls) {
    expect(c.opts.timeout).toBe(SCHEDULER_SPAWN_TIMEOUT_MS); // the red line
    expect(c.opts.encoding).toBe("utf-8");
  }
  // stdin input is opt-in (only crontab `-` needs it); others get no `input`
  const withInput: SchedulerSpawnImplOpts[] = [];
  const runInput = makeSchedulerSpawn(((_cmd, _args, opts) => {
    withInput.push(opts);
    return { status: 0, stdout: "", stderr: "", pid: 1, signal: null, output: [] } as never;
  }) as SchedulerSpawnImpl);
  runInput("crontab", ["-"], { input: "block" });
  expect(withInput[0].input).toBe("block");
  expect(withInput[0].timeout).toBe(SCHEDULER_SPAWN_TIMEOUT_MS);
});

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
  expect(daily!.join(" ")).toContain('cron run --dir "C:\\wb" --id "inbox-tidy"');

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

test("schtasksArgs rejects quote/newline in root/bin/id (cmd injection)", () => {
  const cron: CronDefinition = { id: "inbox-tidy", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };
  expect(() => schtasksArgs(cron, "C:\\bin\\jspace.exe", 'C:\\wb" && calc && "', "JSpaceCron_tag_inbox-tidy")).toThrow(/newline|CR|NUL|quote/);
  expect(() => schtasksArgs(cron, 'C:\\bin\\"jspace.exe', "C:\\wb", "JSpaceCron_tag_inbox-tidy")).toThrow(/newline|CR|NUL|quote/);
  expect(() => schtasksArgs({ ...cron, id: 'tidy"&calc' }, "C:\\bin\\jspace.exe", "C:\\wb", "JSpaceCron_tag_x")).toThrow(/newline|CR|NUL|quote/);
  expect(() => schtasksArgs(cron, "C:\\bin\\jspace.exe", "C:\\wb\nC:\\evil", "JSpaceCron_tag_inbox-tidy")).toThrow(/newline|CR|NUL|quote/);
});

test("schtasksArgs rejects /tr longer than 260 characters", () => {
  const cron: CronDefinition = { id: "inbox-tidy", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };
  const longRoot = "C:\\" + "x".repeat(300);
  expect(() => schtasksArgs(cron, "C:\\bin\\jspace.exe", longRoot, "JSpaceCron_tag_inbox-tidy")).toThrow(/exceeds 260/);
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
    // argv[0] is the binary the scheduler execs — part of the reconciliation
    // key so a drifted path is repaired by install (2026-10-13).
    argv: "/bin/jspace cron run --id inbox-tidy --dir /wb/a",
    // the line's own PATH is recovered too — a widened closure must reach
    // entries installed before it (2026-10-16).
    envPath: "/usr/bin:/bin",
  });
  // other workbench's tag -> null (cross-workbench isolation)
  expect(parseManagedLine(line, "xyz789")).toBeNull();
  // reverse arg order (--id then --dir) still parses
  const reverse = `0 9 * * 0  cd '/wb/b' && PATH='/bin' HOME='/h' '/bin/jspace' cron run --id 'weekly' --dir '/wb/b' >> '/wb/b/log' 2>&1  # com.jspace.cron.zzz.weekly`;
  expect(parseManagedLine(reverse, "zzz")).toMatchObject({ cronId: "weekly", schedule: "0 9 * * 0", argv: "/bin/jspace cron run --id weekly --dir /wb/b" });
  // garbage -> null
  expect(parseManagedLine("not a cron line", "abc123")).toBeNull();
});

test("parseSchtasksXml: DAILY + WEEKLY + spaces root + unparseable", () => {
  // Real schtasks shape: it splits the `/tr` run string at the first space and
  // stores the program in <Command>, the remainder in <Arguments> — /tr is NOT
  // stored verbatim. Every fixture below mirrors that (the older fixtures handed
  // <Arguments> the whole /tr, which is exactly what let the 2026-10-16
  // Windows-only reconciliation red pass unit tests).
  const daily = `<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Actions><Exec><Command>C:\\bin\\jspace.exe</Command><Arguments>cron run --dir &quot;C:\\Users\\John Doe\\wb&quot; --id &quot;inbox-tidy&quot;</Arguments></Exec></Actions></Task>`;
  // argv[0] is the binary the scheduler execs — part of the reconciliation key.
  expect(parseSchtasksXml(daily)).toEqual({ schedule: "0 21 * * *", argv: "C:\\bin\\jspace.exe cron run --id inbox-tidy --dir C:\\Users\\John Doe\\wb" });
  // <Command> may echo the writer's quotes (the writer quotes the binary so a
  // path with spaces survives schtasks' first-space split): one layer is
  // stripped either way, so both forms read back identically and neither
  // re-updates forever.
  const quotedCmd = daily.replace("<Command>C:\\bin\\jspace.exe</Command>", "<Command>&quot;C:\\bin\\jspace.exe&quot;</Command>");
  expect(parseSchtasksXml(quotedCmd)).toEqual(parseSchtasksXml(daily));
  // pre-quote-guard task: no <Command> -> unprefixed (mismatches desired -> update, the safe direction)
  const weekly = `<Task xmlns="x"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T09:30:00</StartBoundary><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Sunday/></DaysOfWeek></ScheduleByWeek></CalendarTrigger></Triggers><Actions><Exec><Arguments>cron run --dir "C:\\wb" --id weekly</Arguments></Exec></Actions></Task>`;
  expect(parseSchtasksXml(weekly)).toEqual({ schedule: "30 9 * * 0", argv: "cron run --id weekly --dir C:\\wb" });
  // quoted --id (current writer) round-trips to the same unquoted inspect argv
  const quotedId = `<Task xmlns="x"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Actions><Exec><Command>C:\\bin\\jspace.exe</Command><Arguments>cron run --dir "C:\\wb" --id "inbox-tidy"</Arguments></Exec></Actions></Task>`;
  expect(parseSchtasksXml(quotedId)).toEqual({ schedule: "0 21 * * *", argv: "C:\\bin\\jspace.exe cron run --id inbox-tidy --dir C:\\wb" });
  expect(parseSchtasksXml("<Task/>")).toBeNull();
  expect(parseSchtasksXml(`<Task><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary><ScheduleByDay/></CalendarTrigger></Triggers><Actions><Exec><Arguments>no --dir here</Arguments></Exec></Actions></Task>`)).toBeNull();
});

test("darwin inspect requires launchd-loaded state, not just a plist file", () => {
  const home = mkdtempSync(join(tmpdir(), "jspace-darwin-inspect-"));
  try {
    const launchAgents = join(home, "Library", "LaunchAgents");
    mkdirSync(launchAgents, { recursive: true });
    writeFileSync(join(launchAgents, "com.jspace.cron.tagA.inbox.plist"), "stale");
    const env = { jspaceBinary: "/bin/jspace", home, path: "/bin" };
    expect(inspectDarwin("tagA", env, () => false)).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("darwin plistPath + parsePlistName use injected home + tagged identity", () => {
  expect(plistPath("abc123", "inbox-tidy", "/Users/u")).toBe(join("/Users/u", "Library/LaunchAgents/com.jspace.cron.abc123.inbox-tidy.plist"));
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

test("P0: win32 queryTasks CSV parse tolerates the schtasks leading-backslash task path — real runner sample (B3 smoke regression)", () => {
  const tag = "1aawhej"; // real GH runner workbench tag from the failing run
  const out = [
    '"\\HostedComputeAgent","N/A","Running"',
    '"\\JSpaceCron_1aawhej_smoke-test","8/26/2026 9:00:00 PM","Ready"',
    '"\\MicrosoftEdgeUpdateTaskMachineCore{8277B197-04F3-432A-BEDF-7A5D833ACEE1}","N/A","Disabled"',
  ].join("\r\n") + "\r\n";
  // a `\`-prefixed task must survive the tag filter — before the fix the
  // startsWith(prefix) match dropped every row and doctor reds not_installed
  const rows = queryTasksFromOutput(out, tag);
  expect(rows).toEqual(["JSpaceCron_1aawhej_smoke-test"]);
  // normalized handle == identity()/`/create /tn` handle, so reconciliation
  // sees installed==desired and a re-install is a no-op (never re-create)
  expect(csvTaskName(rows[0])).toBe("JSpaceCron_1aawhej_smoke-test");
  expect(cronIdFromTaskName(rows[0], tag)).toBe("smoke-test");
  // the raw `\`-prefixed task-path form parses to the same id
  expect(cronIdFromTaskName("\\JSpaceCron_1aawhej_smoke-test", tag)).toBe("smoke-test");
  // other-tag + no-backslash rows are filtered out, never misattributed
  expect(queryTasksFromOutput('"JSpaceCron_other_smoke-test","N/A","Ready"\r\n', tag)).toEqual([]);
});

test("P0: darwin reconciliation converges — plist identity == inspect parse", () => {
  const tag = "tagA";
  const cron = mkCron("inbox", "0 21 * * *");
  const id = darwinAdapter.identity(tag, cron.id); // posix dotted
  const root = "/wb";
  const content = darwinAdapter.buildContent(cron, tag, root, { jspaceBinary: "/bin/jspace", home: "/Users/u", path: "/bin" });
  const desired = [{ taskId: id.taskId, cronId: cron.id, schedule: cron.schedule, argv: "cron run --id inbox --dir /wb", content }];
  // Round-trip through the REAL inspect parse functions with canned `plutil`
  // output (macOS `plutil -p` / `-extract json` format), so a build/parse drift
  // reds instead of the reconciliation no-opping on hand-crafted literals.
  const name = `${id.taskId}.plist`;
  const installed = [{
    taskId: parsePlistName(name)!.taskId,
    cronId: "inbox",
    schedule: scheduleFromIntervalDict(JSON.parse('{"Minute":0,"Hour":21}')),
    argv: argvFromPlistStdout(`"WorkingDirectory" => "${root}"\n`, name),
  }];
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

// ---- FR-4: the installed binary is part of the reconciliation key ----
// Each adapter's write path embeds env.jspaceBinary — the binary the scheduler
// will actually exec — and each read path must recover it. Without that, a task
// left pointing at a stale build compares equal forever and no install repairs
// it (observed 2026-10-13: inbox-tidy's plist exec'd a months-old dev binary).
// Per platform: write -> read is a no-op (a second install does nothing); a
// stale installed binary -> update; and the update's own content reads back as
// desired, so the update converges instead of re-updating on every install.

const FR4_TAG = "tagA";
const FR4_CRON = mkCron("inbox", "0 21 * * *");
const FR4_ROOT = "/wb";
const FR4_BIN = "/opt/jspace/bin/jspace";
const FR4_DESIRED_ARGV = invocationArgv({ cronId: FR4_CRON.id, workbench: FR4_ROOT }, FR4_BIN).join(" ");

/** Read back a written plist the way inspect() does: plutil -p stdout ->
 *  argvFromPlistStdout. Only the fields that parser reads are rendered, and the
 *  binary is taken from the built plist itself, so a write-side drift (buildPlist
 *  stops emitting ProgramArguments[0]) reds instead of being papered over. */
function darwinReadBack(name: string, plistBody: string): InstalledTask {
  const bin = plistBody.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/);
  expect(bin).not.toBeNull();
  const stdout = `"ProgramArguments" => [\n    0 => "${bin![1]}"\n    1 => "cron"\n]\n"WorkingDirectory" => "${FR4_ROOT}"\n`;
  return { taskId: parsePlistName(name)!.taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: argvFromPlistStdout(stdout, name) };
}

/** Read back a plist dump the way inspect() does for the env dimension:
 *  the same `plutil -p` stdout, parsed for both argv and PATH so a test can
 *  never pair an argv from one dump with a PATH from another. */
function darwinEnvReadBack(name: string, stdout: string): InstalledTask {
  return {
    taskId: parsePlistName(name)!.taskId,
    cronId: FR4_CRON.id,
    schedule: FR4_CRON.schedule,
    argv: argvFromPlistStdout(stdout, name),
    envPath: envPathFromPlistStdout(stdout),
  };
}

/** Read back a written win32 task the way inspect() does: op content (JSON argv
 *  array) -> the /tr command -> schtasks' XML -> parseSchtasksXml.
 *
 *  schtasks does NOT store /tr verbatim: it splits the run string at the first
 *  space, routing the program to <Command> and the remainder to <Arguments>.
 *  Modeling that split is the whole point of this helper — a fixture that hands
 *  <Arguments> the entire /tr (as this one used to) cannot fail the way a real
 *  runner does, which is how the 2026-10-16 Windows-only red shipped green. */
function win32ReadBack(content: string): InstalledTask {
  const args = JSON.parse(content) as string[];
  const tr = args[args.indexOf("/tr") + 1];
  // first UNQUOTED space — the writer quotes the binary so a path with spaces
  // (the case this quoting exists for) is not split mid-path
  let split = -1;
  let inQuotes = false;
  for (let i = 0; i < tr.length; i++) {
    if (tr[i] === '"') inQuotes = !inQuotes;
    else if (tr[i] === " " && !inQuotes) { split = i; break; }
  }
  const program = tr.slice(0, split);
  const rest = tr.slice(split + 1);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const xml =
    `<Task xmlns="x"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary>` +
    `<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>` +
    `<Actions><Exec><Command>${esc(program)}</Command><Arguments>${esc(rest)}</Arguments></Exec></Actions></Task>`;
  const parsed = parseSchtasksXml(xml)!;
  return { taskId: win32Adapter.identity(FR4_TAG, FR4_CRON.id).taskId, cronId: FR4_CRON.id, schedule: parsed.schedule, argv: parsed.argv };
}

test("FR-4 darwin: plist binary round-trips; stale binary -> update that converges", () => {
  const id = darwinAdapter.identity(FR4_TAG, FR4_CRON.id);
  const name = `${id.taskId}.plist`;
  const content = darwinAdapter.buildContent(FR4_CRON, FR4_TAG, FR4_ROOT, { jspaceBinary: FR4_BIN, home: "/Users/u", path: "/bin" });
  const desired = [{ taskId: id.taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: FR4_DESIRED_ARGV, content }];
  // the desired argv really does carry the binary — otherwise a read path that
  // stopped extracting it would still "match" and this test would prove nothing
  expect(FR4_DESIRED_ARGV.startsWith(`${FR4_BIN} cron run`)).toBe(true);
  expect(darwinReadBack(name, content).argv).toBe(FR4_DESIRED_ARGV);
  expect(planReconciliation(desired, [darwinReadBack(name, content)])).toEqual([]); // write -> read -> no-op
  const staleStdout = `"ProgramArguments" => [\n    0 => "/Users/u/old/dev/jspace"\n]\n"WorkingDirectory" => "${FR4_ROOT}"\n`;
  const stale = [{ taskId: id.taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: argvFromPlistStdout(staleStdout, name) }];
  const ops = planReconciliation(desired, stale);
  expect(ops).toEqual([{ action: "update", taskId: id.taskId, content }]);
  const applied = (ops[0] as { content: string }).content;
  expect(planReconciliation(desired, [darwinReadBack(name, applied)])).toEqual([]); // applied update converges
});

test("FR-4 linux: crontab binary round-trips; stale binary -> update that converges", () => {
  const taskId = taskIdFor(FR4_TAG, FR4_CRON.id);
  const line = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, FR4_BIN, "/bin", "/home/u");
  const desired = [{ taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: FR4_DESIRED_ARGV, content: line }];
  expect(FR4_DESIRED_ARGV.startsWith(`${FR4_BIN} cron run`)).toBe(true);
  expect(parseManagedLine(line, FR4_TAG)!.argv).toBe(FR4_DESIRED_ARGV);
  expect(planReconciliation(desired, [parseManagedLine(line, FR4_TAG)!])).toEqual([]); // write -> read -> no-op
  const staleLine = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, "/Users/u/old/dev/jspace", "/bin", "/home/u");
  const ops = planReconciliation(desired, [parseManagedLine(staleLine, FR4_TAG)!]);
  expect(ops).toEqual([{ action: "update", taskId, content: line }]);
  const applied = (ops[0] as { content: string }).content;
  expect(planReconciliation(desired, [parseManagedLine(applied, FR4_TAG)!])).toEqual([]); // applied update converges
});

test("FR-4 darwin: plist PATH round-trips; a stale PATH -> update that converges", () => {
  // Same shape as the binary check above, for the OTHER key the entry carries:
  // a widened PATH closure must reach entries installed before it, or the fix
  // never lands on an existing install (2026-10-16: 4 of 5 local plists still
  // carried the pre-#50 PATH and `cron install` reported "up to date").
  const id = darwinAdapter.identity(FR4_TAG, FR4_CRON.id);
  const name = `${id.taskId}.plist`;
  const OLD_PATH = "/usr/local/bin:/usr/bin:/bin";
  const NEW_PATH = "/opt/homebrew/bin:/Users/u/.bun/bin:/usr/local/bin:/usr/bin:/bin";
  const content = darwinAdapter.buildContent(FR4_CRON, FR4_TAG, FR4_ROOT, { jspaceBinary: FR4_BIN, home: "/Users/u", path: NEW_PATH });
  const dump = `"EnvironmentVariables" => {\n    "HOME" => "/Users/u"\n    "PATH" => "${NEW_PATH}"\n  }\n"ProgramArguments" => [\n    0 => "${FR4_BIN}"\n]\n"WorkingDirectory" => "${FR4_ROOT}"\n`;
  const desired = [{ taskId: id.taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: FR4_DESIRED_ARGV, envPath: NEW_PATH, content }];
  expect(envPathFromPlistStdout(dump)).toBe(NEW_PATH);
  expect(planReconciliation(desired, [darwinEnvReadBack(name, dump)])).toEqual([]); // write -> read -> no-op
  // an entry carrying the older, unclosed PATH is repaired (not left comparing equal)
  const staleDump = dump.replace(NEW_PATH, OLD_PATH);
  const ops = planReconciliation(desired, [darwinEnvReadBack(name, staleDump)]);
  expect(ops).toEqual([{ action: "update", taskId: id.taskId, content }]);
  const applied = (ops[0] as { content: string }).content;
  expect(planReconciliation(desired, [darwinEnvReadBack(name, dump)])).toEqual([]); // applied update converges
  expect(applied).toBe(content);

  // a dump with no EnvironmentVariables at all reads as "" -> drift -> update
  expect(envPathFromPlistStdout(`"ProgramArguments" => [\n    0 => "${FR4_BIN}"\n]\n`)).toBe("");
  // a PATH key OUTSIDE the env dict is not picked up (scoped match)
  expect(envPathFromPlistStdout(`"PATH" => "/somewhere/else"\n"EnvironmentVariables" => {\n}\n`)).toBe("");
});

// ---- envPath: linux crontab line read-back ----

test("envPathFromLine: reads the line's own PATH= assignment, POSIX-unquoted", () => {
  const line = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, FR4_BIN, "/opt/homebrew/bin:/Users/u/.bun/bin:/bin", "/home/u");
  expect(envPathFromLine(line)).toBe("/opt/homebrew/bin:/Users/u/.bun/bin:/bin");
  expect(parseManagedLine(line, FR4_TAG)!.envPath).toBe("/opt/homebrew/bin:/Users/u/.bun/bin:/bin");
  // a line whose PATH carries a quote still round-trips (same '\'' rule as every
  // other value in the line)
  const quoted = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, FR4_BIN, "/we'ird/bin:/bin", "/home/u");
  expect(parseManagedLine(quoted, FR4_TAG)!.envPath).toBe("/we'ird/bin:/bin");
  // a managed line with no PATH assignment reads as "" (drift -> update)
  const noPath = `0 21 * * *  cd '/wb' && '/bin/jspace' cron run --dir '/wb' --id 'inbox' >> '/wb/log' 2>&1  # ${taskIdFor(FR4_TAG, "inbox")}`;
  expect(parseManagedLine(noPath, FR4_TAG)!.envPath).toBe("");
});

test("FR-4 linux: crontab PATH round-trips; a stale PATH -> update that converges", () => {
  const taskId = taskIdFor(FR4_TAG, FR4_CRON.id);
  const OLD_PATH = "/usr/local/bin:/usr/bin:/bin";
  const NEW_PATH = "/opt/homebrew/bin:/Users/u/.bun/bin:/usr/local/bin:/usr/bin:/bin";
  const line = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, FR4_BIN, NEW_PATH, "/home/u");
  const desired = [{ taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: FR4_DESIRED_ARGV, envPath: NEW_PATH, content: line }];
  expect(planReconciliation(desired, [parseManagedLine(line, FR4_TAG)!])).toEqual([]); // write -> read -> no-op
  const stale = crontabLine(FR4_CRON, FR4_TAG, FR4_ROOT, FR4_BIN, OLD_PATH, "/home/u");
  const ops = planReconciliation(desired, [parseManagedLine(stale, FR4_TAG)!]);
  expect(ops).toEqual([{ action: "update", taskId, content: line }]);
  expect(planReconciliation(desired, [parseManagedLine(line, FR4_TAG)!])).toEqual([]); // applied update converges
});

test("FR-4 win32: an entry with no envPath never drifts (schtasks stores no PATH)", () => {
  // win32 ignores env.path, so inspect() cannot recover one; the comparison must
  // skip the dimension rather than read the absence as drift and update forever.
  const taskId = win32Adapter.identity(FR4_TAG, FR4_CRON.id).taskId;
  const winRoot = "C:\\wb";
  const env32 = { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" };
  const content = win32Adapter.buildContent(FR4_CRON, FR4_TAG, winRoot, env32);
  const desired = [{ taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: invocationArgv({ cronId: FR4_CRON.id, workbench: winRoot }, env32.jspaceBinary).join(" "), content }];
  const readBack = win32ReadBack(content);
  expect(readBack.envPath).toBeUndefined();
  expect(planReconciliation(desired, [readBack])).toEqual([]);
});

test("FR-4 win32: task binary round-trips; stale binary -> update that converges", () => {
  const taskId = win32Adapter.identity(FR4_TAG, FR4_CRON.id).taskId;
  const winRoot = "C:\\wb";
  const env32 = { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" };
  const content = win32Adapter.buildContent(FR4_CRON, FR4_TAG, winRoot, env32);
  const desired = [{ taskId, cronId: FR4_CRON.id, schedule: FR4_CRON.schedule, argv: invocationArgv({ cronId: FR4_CRON.id, workbench: winRoot }, env32.jspaceBinary).join(" "), content }];
  expect(desired[0].argv).toBe(`${env32.jspaceBinary} cron run --id ${FR4_CRON.id} --dir ${winRoot}`);
  expect(win32ReadBack(content).argv).toBe(desired[0].argv);
  expect(planReconciliation(desired, [win32ReadBack(content)])).toEqual([]); // write -> read -> no-op
  const staleContent = win32Adapter.buildContent(FR4_CRON, FR4_TAG, winRoot, { ...env32, jspaceBinary: "C:\\old\\dev\\jspace.exe" });
  const ops = planReconciliation(desired, [win32ReadBack(staleContent)]);
  expect(ops).toEqual([{ action: "update", taskId, content }]);
  const applied = (ops[0] as { content: string }).content;
  expect(planReconciliation(desired, [win32ReadBack(applied)])).toEqual([]); // applied update converges
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
    expect(parsed!.argv).toBe(`/bin/jspace cron run --id inbox --dir ${root}`); // unquoted back -> matches desired
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
  const adapter = makeLinuxAdapter({
    io: {
      readCrontab: () => crontab,
      writeCrontab: (c) => { written = c; },
    },
  });
  try {
    adapter.applyBatch([], [], tagA, root, LINUX_ENV);
  } finally {
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
    const adapter = makeLinuxAdapter({
      io: {
        readCrontab: () => crontab,
        writeCrontab: (c) => { written = c; },
      },
    });
    adapter.applyBatch([], enabled, tagA, root, LINUX_ENV);
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

// ---- linux cron health tri-state (issue #10) --------------------------------
// Inject the spawn + proc-status seams so every branch runs without a real
// crontab/daemon or a real sandbox. Same saved/restored seam pattern as io.

function fakeHealthSpawn(p: { pgrep: number; crontabBin: string; crontabL: number }) {
  return ((cmd: string, args: string[]): ReturnType<SchedulerSpawn> => {
    if (cmd === "sh" && args[1]?.includes("pgrep")) {
      return { status: p.pgrep, stdout: "", stderr: "", pid: 1, signal: null, output: [] } as never;
    }
    if (cmd === "sh" && args[1]?.includes("command -v crontab")) {
      return { status: p.crontabBin === "" ? 1 : 0, stdout: p.crontabBin, stderr: "", pid: 1, signal: null, output: [] } as never;
    }
    if (cmd === "crontab" && args[0] === "-l") {
      return { status: p.crontabL, stdout: "", stderr: "no crontab for uid", pid: 1, signal: null, output: [] } as never;
    }
    throw new Error(`unexpected spawn: ${cmd} ${JSON.stringify(args)}`);
  }) as SchedulerSpawn;
}

const PROC_NOT_ISOLATED = "Name:\tfoo\nNSpid:\t205\n";
const PROC_ISOLATED = "Name:\tfoo\nNSpid:\t42 205\n"; // nested namespace: two values

function runHealth(p: { pgrep: number; crontabBin: string; crontabL: number }, procStatus: string) {
  const adapter = makeLinuxAdapter({
    spawn: fakeHealthSpawn(p),
    readProcStatus: () => procStatus,
  });
  return adapter.health!({ jspaceBinary: "/bin/jspace", home: "/home/u", path: "/bin" });
}

// A machine without the cron package used to fail `cron install` with
// "crontab -l failed (status undefined)" — fail-fast, but naming neither the
// fault nor the fix. The spawn-never-ran case is now its own message.
test("crontabUnavailable separates 'command never ran' from a crontab error", () => {
  const enoent = crontabUnavailable({ status: null, error: new Error("spawn crontab ENOENT") });
  expect(enoent).toContain("crontab command not available");
  expect(enoent).toContain("apt-get install cron");

  const noStatus = crontabUnavailable({ status: null, stderr: "" });
  expect(noStatus).toContain("could not be executed");
  expect(noStatus).toContain("apt-get install cron");

  expect(crontabUnavailable({ status: null, signal: "SIGTERM" })).toContain("SIGTERM");

  // crontab ran and answered: not this fault (0 = readable, 1 = no crontab,
  // other = a real crontab error the existing message already reports)
  expect(crontabUnavailable({ status: 0 })).toBeNull();
  expect(crontabUnavailable({ status: 1 })).toBeNull();
  expect(crontabUnavailable({ status: 2, stderr: "boom" })).toBeNull();
});

test("pidNamespaceIsolated parses NSpid values", () => {
  expect(pidNamespaceIsolated(PROC_NOT_ISOLATED)).toBe(false); // single value
  expect(pidNamespaceIsolated(PROC_ISOLATED)).toBe(true); // nested namespace
  expect(pidNamespaceIsolated("Name:\tfoo\n")).toBe(false); // no NSpid field
  expect(pidNamespaceIsolated("")).toBe(false); // empty proc
});

test("health: pgrep hit -> service ok", () => {
  const h = runHealth({ pgrep: 0, crontabBin: "/usr/bin/crontab", crontabL: 0 }, PROC_NOT_ISOLATED);
  expect(h.service).toBe("ok");
  expect(h.crontab).toBe("ok");
});

test("health: pgrep miss on a verifiable host -> service stopped", () => {
  const h = runHealth({ pgrep: 1, crontabBin: "/usr/bin/crontab", crontabL: 1 }, PROC_NOT_ISOLATED);
  expect(h.service).toBe("stopped"); // confirmed not running
  expect(h.crontab).toBe("missing"); // confirmed no crontab for this uid
});

test("health: pgrep miss inside a nested PID namespace -> service unverifiable", () => {
  // bwrap --unshare-pid hides the host daemon; "no process" is not proof of
  // "stopped" (issue #10).
  const h = runHealth({ pgrep: 1, crontabBin: "/usr/bin/crontab", crontabL: 1 }, PROC_ISOLATED);
  expect(h.service).toBe("unverifiable");
  expect(h.crontab).toBe("unverifiable"); // host spool invisible too
});

test("health: crontab -l status 1 on an isolated host -> crontab unverifiable", () => {
  const h = runHealth({ pgrep: 1, crontabBin: "/usr/bin/crontab", crontabL: 1 }, PROC_ISOLATED);
  expect(h.crontab).toBe("unverifiable");
});

test("health: crontab -l other status -> crontab unverifiable (not proof of absence)", () => {
  const h = runHealth({ pgrep: 1, crontabBin: "/usr/bin/crontab", crontabL: 2 }, PROC_NOT_ISOLATED);
  expect(h.crontab).toBe("unverifiable");
});

test("health: no crontab binary -> crontab missing-cmd (confirmed cannot install)", () => {
  const h = runHealth({ pgrep: 1, crontabBin: "", crontabL: 1 }, PROC_NOT_ISOLATED);
  expect(h.crontab).toBe("missing-cmd"); // confirmed fault, distinct from "missing"
});

// ---- scheduling-semantics contract (GOAL#5 ② Linux catch-up / ③ Windows logon) ----
// These two product boundaries are documented in docs/PLATFORMS.md as "not a
// bug": Linux crontab skips a missed slot, and a Windows task only fires while
// the user is logged on. Both hold only as long as the emitted argv stays
// exactly what the OS default means, so the argv itself is the contract — a
// future "convenience" flag would silently change the documented semantics.

test("win32 create argv always carries /it and never a logged-out escalation switch", () => {
  const mk = (id: string, schedule: string): CronDefinition => ({ id, schedule, harness: "claude", prompt: "x", enabled: true });
  // /ru (run-as, e.g. SYSTEM) and /rp (stored password) are the two switches
  // that make schtasks run while nobody is logged on; /it is what pins the task
  // to the interactive token of the logged-on user.
  const loggedOutSwitches = ["/ru", "/rp"];
  const cases = [mk("inbox-tidy", "0 21 * * *"), mk("weekly", "0 21 * * 0")];
  for (const cron of cases) {
    const args = schtasksArgs(cron, "C:\\bin\\jspace.exe", "C:\\wb", `JSpaceCron_tag_${cron.id}`);
    expect(args).not.toBeNull();
    expect(args).toContain("/it");
    for (const sw of loggedOutSwitches) expect(args).not.toContain(sw);
  }
  // Same assertion through the real write path (buildContent is what applyBatch
  // spawns), so a bypass of schtasksArgs cannot drop /it unnoticed.
  const content = win32Adapter.buildContent(cases[0], "tag", "C:\\wb", { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" });
  const argv = JSON.parse(content) as string[];
  expect(argv).toContain("/it");
  for (const sw of loggedOutSwitches) expect(argv).not.toContain(sw);
});

test("linux install writes plain 5-field crontab entries — no anacron/@reboot catch-up wrapper", () => {
  const mk = (id: string, schedule: string): CronDefinition => ({ id, schedule, harness: "claude", prompt: "x", enabled: true });
  const block = crontabBlock([mk("inbox-tidy", "0 21 * * *"), mk("weekly", "30 22 * * 0")], "tag", "/wb", "/bin/jspace", "/usr/bin:/bin", "/home/u");
  const lines = block.trim().split("\n");
  expect(lines[0]).toBe(CRON_BLOCK_START("tag"));
  expect(lines[lines.length - 1]).toBe(CRON_BLOCK_END("tag"));
  const entries = lines.slice(1, -1);
  expect(entries).toHaveLength(2);
  for (const e of entries) {
    // exactly the 5 calendar fields, then the run command: no @reboot/@daily
    // special schedule, no anacron/run-parts indirection, no missed-run scan.
    expect(e).toMatch(/^\d+ \d+ \* \* (\*|\d)  cd '\/wb' && /);
    expect(e).toContain("cron run --dir '/wb' --id ");
  }
  expect(block).not.toContain("@");
  expect(block.toLowerCase()).not.toContain("anacron");
  expect(block.toLowerCase()).not.toContain("run-parts");
});

// ---- timeoutSec: the per-cron budget is part of the reconciliation key ----
// A budget is baked into the installed entry at install time and never
// recomputed at trigger time, so editing cron.json is the ONLY way to change a
// scheduled run's budget — and that only works if the value is in the
// comparison key. Without it `cron install` reports "up to date" forever while
// the entry keeps killing the run at the old budget (the PATH #50 and argv[0]
// failure mode, third time; observed on server-status: 1915s and 2042s kills
// against a 1800s default that cron.json could not change).

const TO_CRON = (timeoutSec?: number): CronDefinition => ({
  id: "inbox",
  schedule: "0 21 * * *",
  harness: "claude",
  prompt: "x",
  enabled: true,
  ...(timeoutSec === undefined ? {} : { timeoutSec }),
});

/** Render a built plist as `plutil -p` does for the two fields inspect() reads,
 *  so a buildPlist / argvFromPlistStdout drift reds here instead of being
 *  papered over by a hand-written dump. */
function plistDump(plistBody: string, root: string): string {
  const block = plistBody.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  expect(block).not.toBeNull();
  const strs = [...block![1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  return `"ProgramArguments" => [\n${strs.map((s, i) => `    ${i} => "${s}"`).join("\n")}\n]\n"WorkingDirectory" => "${root}"\n`;
}

/** Read back a written win32 task the way inspect() does, for an arbitrary cron:
 *  op content (JSON argv array) -> /tr -> schtasks' first-space split -> XML. */
function win32TaskFrom(tag: string, cron: CronDefinition, content: string): InstalledTask {
  const args = JSON.parse(content) as string[];
  const tr = args[args.indexOf("/tr") + 1];
  let split = -1;
  let inQuotes = false;
  for (let i = 0; i < tr.length; i++) {
    if (tr[i] === '"') inQuotes = !inQuotes;
    else if (tr[i] === " " && !inQuotes) { split = i; break; }
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const xml =
    `<Task xmlns="x"><Triggers><CalendarTrigger><StartBoundary>2026-08-05T21:00:00</StartBoundary>` +
    `<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>` +
    `<Actions><Exec><Command>${esc(tr.slice(0, split))}</Command><Arguments>${esc(tr.slice(split + 1))}</Arguments></Exec></Actions></Task>`;
  const parsed = parseSchtasksXml(xml)!;
  return { taskId: win32Adapter.identity(tag, cron.id).taskId, cronId: cron.id, schedule: parsed.schedule, argv: parsed.argv };
}

test("timeoutSec darwin: budget rides ProgramArguments, round-trips, and a change -> update", () => {
  const tag = "tagA";
  const root = "/wb";
  const env = { jspaceBinary: FR4_BIN, home: "/Users/u", path: "/bin" };
  const id = darwinAdapter.identity(tag, "inbox");
  const name = `${id.taskId}.plist`;
  const readBack = (cron: CronDefinition) =>
    ({ taskId: id.taskId, cronId: cron.id, schedule: cron.schedule, argv: argvFromPlistStdout(plistDump(darwinAdapter.buildContent(cron, tag, root, env), root), name) });

  const budgeted = buildDesired([TO_CRON(3600)], tag, root, env, darwinAdapter);
  // the value really is in the installed argv, not just in cron.json
  expect(budgeted[0].argv).toBe(`${FR4_BIN} cron run --id inbox --dir /wb --timeout 3600`);
  expect(darwinAdapter.buildContent(TO_CRON(3600), tag, root, env)).toContain("<string>--timeout</string>");
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]); // write -> read -> no-op

  // THE acceptance criterion: editing the budget produces an update, not "up to date"
  const ops = planReconciliation(budgeted, [readBack(TO_CRON(undefined))]);
  expect(ops).toEqual([{ action: "update", taskId: id.taskId, content: darwinAdapter.buildContent(TO_CRON(3600), tag, root, env) }]);
  // ...and the applied update converges instead of re-updating on every install
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]);

  // absent budget == pre-field bytes: no --timeout, and an old entry still no-ops
  const plain = buildDesired([TO_CRON(undefined)], tag, root, env, darwinAdapter);
  expect(plain[0].argv).toBe(`${FR4_BIN} cron run --id inbox --dir /wb`);
  expect(darwinAdapter.buildContent(TO_CRON(undefined), tag, root, env)).not.toContain("--timeout");
  expect(planReconciliation(plain, [readBack(TO_CRON(undefined))])).toEqual([]);
});

test("timeoutSec linux: budget rides the crontab line, round-trips, and a change -> update", () => {
  const tag = "tagA";
  const root = "/wb";
  const env = { jspaceBinary: FR4_BIN, home: "/home/u", path: "/bin" };
  const taskId = taskIdFor(tag, "inbox");
  const readBack = (cron: CronDefinition) => parseManagedLine(crontabLine(cron, tag, root, FR4_BIN, "/bin", "/home/u"), tag)!;

  const budgeted = buildDesired([TO_CRON(3600)], tag, root, env, linuxAdapter);
  expect(budgeted[0].argv).toBe(`${FR4_BIN} cron run --id inbox --dir /wb --timeout 3600`);
  expect(crontabLine(TO_CRON(3600), tag, root, FR4_BIN, "/bin", "/home/u")).toContain("--timeout 3600");
  expect(readBack(TO_CRON(3600)).argv).toBe(budgeted[0].argv);
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]);

  expect(planReconciliation(budgeted, [readBack(TO_CRON(undefined))])).toEqual([{ action: "update", taskId, content: crontabLine(TO_CRON(3600), tag, root, FR4_BIN, "/bin", "/home/u") }]);
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]);

  const plain = buildDesired([TO_CRON(undefined)], tag, root, env, linuxAdapter);
  expect(plain[0].argv).toBe(`${FR4_BIN} cron run --id inbox --dir /wb`);
  expect(planReconciliation(plain, [readBack(TO_CRON(undefined))])).toEqual([]);
});

test("timeoutSec win32: budget rides /tr, round-trips, and a change -> update", () => {
  const tag = "tagA";
  const root = "C:\\wb";
  const env = { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "" };
  const readBack = (cron: CronDefinition) => win32TaskFrom(tag, cron, win32Adapter.buildContent(cron, tag, root, env));

  const budgeted = buildDesired([TO_CRON(3600)], tag, root, env, win32Adapter);
  expect(budgeted[0].argv).toBe("C:\\bin\\jspace.exe cron run --id inbox --dir C:\\wb --timeout 3600");
  expect(readBack(TO_CRON(3600)).argv).toBe(budgeted[0].argv);
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]);

  expect(planReconciliation(budgeted, [readBack(TO_CRON(undefined))])).toEqual([{ action: "update", taskId: budgeted[0].taskId, content: win32Adapter.buildContent(TO_CRON(3600), tag, root, env) }]);
  expect(planReconciliation(budgeted, [readBack(TO_CRON(3600))])).toEqual([]);

  const plain = buildDesired([TO_CRON(undefined)], tag, root, env, win32Adapter);
  expect(plain[0].argv).toBe("C:\\bin\\jspace.exe cron run --id inbox --dir C:\\wb");
  expect(planReconciliation(plain, [readBack(TO_CRON(undefined))])).toEqual([]);
});
