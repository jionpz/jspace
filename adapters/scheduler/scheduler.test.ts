// adapters/scheduler/scheduler.test.ts — scheduler adapter pure functions +
// cross-workbench tag isolation (AC1) + reconciliation identity.
// Run: bun test adapters/scheduler/scheduler.test.ts
import { expect, test } from "bun:test";
import { taskIdFor, workbenchTag } from "./types.ts";
import { crontabBlock, replaceManagedBlock } from "./linux.ts";
import { schtasksArgs, isWindowsInstallable } from "./win32.ts";
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
