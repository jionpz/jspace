// cli/cron.test.ts — pure-function unit tests for the cross-platform cron
// backends (crontab lines, block replacement, schtasks args, binary resolution).
// Run: bun test cli/cron.test.ts
import { expect, test } from "bun:test";
import {
  crontabBlock,
  replaceManagedBlock,
  schtasksArgs,
  isWindowsInstallable,
  jspaceBinary,
  parseSchedule,
} from "./cron.ts";

function cron(id: string, schedule: string, prompt = "test"): Parameters<typeof crontabBlock>[0][number] {
  return { id, schedule, harness: "claude", prompt, enabled: true };
}

test("parseSchedule accepts single values and star", () => {
  expect(parseSchedule("0 21 * * *")).toEqual({ Minute: 0, Hour: 21 });
  expect(parseSchedule("0 21 * * 0")).toEqual({ Minute: 0, Hour: 21, Weekday: 0 });
  expect(parseSchedule("30 8 1 6 *")).toEqual({ Minute: 30, Hour: 8, Day: 1, Month: 6 });
});

test("parseSchedule rejects lists/ranges/steps and DOM+DOW both set", () => {
  expect(() => parseSchedule("*/5 * * * *")).toThrow();
  expect(() => parseSchedule("0 8-9 * * *")).toThrow();
  expect(() => parseSchedule("0 0 1 * 1")).toThrow();
  expect(() => parseSchedule("0 21 * * 8")).toThrow();
});

test("crontabBlock quotes every path and escapes percent", () => {
  const root = "/home/u/my work";
  const block = crontabBlock([cron("inbox-tidy", "0 21 * * *")], root, "/opt/jspace/bin/jspace", "/usr/bin:/bin", "/home/u");
  expect(block).toContain("cd '/home/u/my work'");
  expect(block).toContain("PATH='/usr/bin:/bin'");
  expect(block).toContain("HOME='/home/u'");
  expect(block).toContain("'/opt/jspace/bin/jspace' cron run --dir '/home/u/my work' --id 'inbox-tidy'");
  expect(block.startsWith("# jspace crons (managed) DO NOT EDIT"));
  expect(block.trimEnd().endsWith("# end jspace"));
  // percent in a path is escaped (cronie treats % as newline)
  const pct = crontabBlock([cron("pct", "0 21 * * *")], "/tmp/100%folder", "/bin/jspace", "/bin", "/home");
  expect(pct).toContain("\\%");
});

test("crontabBlock rejects lines over 1000 chars", () => {
  const longRoot = "/x".repeat(1000);
  expect(() => crontabBlock([cron("long", "0 21 * * *")], longRoot, "/bin/jspace", "/bin", "/home")).toThrow();
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
  const daily = schtasksArgs(cron("inbox-tidy", "0 21 * * *"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_inbox");
  expect(daily).toContain("/sc"); expect(daily).toContain("DAILY"); expect(daily).toContain("/st"); expect(daily).toContain("21:00");
  expect(daily).toContain("/tn"); expect(daily).toContain("JSpaceCron_wb_inbox");
  expect(daily!.join(" ")).toContain('cron run --dir "C:\\wb" --id inbox-tidy');

  const weekly = schtasksArgs(cron("weekly", "0 21 * * 0"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_weekly");
  expect(weekly).toContain("WEEKLY"); expect(weekly).toContain("/d"); expect(weekly).toContain("SUN");
  // dow=7 also maps to SUN
  const sun7 = schtasksArgs(cron("sun7", "0 21 * * 7"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_sun7");
  expect(sun7).toContain("SUN");
});

test("schtasksArgs: unsupported schedules -> null", () => {
  expect(schtasksArgs(cron("monthly", "0 0 1 * *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
  expect(schtasksArgs(cron("dom", "0 0 1 6 *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
});

test("isWindowsInstallable", () => {
  expect(isWindowsInstallable("0 21 * * *")).toBe(true);
  expect(isWindowsInstallable("0 21 * * 0")).toBe(true);
  expect(isWindowsInstallable("0 0 1 * *")).toBe(false);
  expect(isWindowsInstallable("0 0 1 6 *")).toBe(false);
});

test("jspaceBinary win32 probes .exe", () => {
  const b = jspaceBinary("win32");
  expect(b.endsWith("bin/jspace") || b.endsWith("bin/jspace.exe")).toBe(true);
  expect(jspaceBinary("darwin").endsWith("bin/jspace")).toBe(true);
  expect(jspaceBinary("linux").endsWith("bin/jspace")).toBe(true);
});
