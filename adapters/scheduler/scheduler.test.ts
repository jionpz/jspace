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
