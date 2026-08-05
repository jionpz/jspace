// cli/cron.test.ts — pure-function unit tests for the cross-platform cron
// backends (schedule parsing, binary resolution). The cron status/failures
// surface lives in application/automation/status.test.ts.
// Run: bun test cli/cron.test.ts
import { expect, test } from "bun:test";
import { jspaceBinary } from "./cron.ts";
import { parseSchedule } from "../application/automation/definitions.ts";

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

test("jspaceBinary win32 probes .exe", () => {
  const b = jspaceBinary("win32");
  expect(b.endsWith("bin/jspace") || b.endsWith("bin/jspace.exe")).toBe(true);
  expect(jspaceBinary("darwin").endsWith("bin/jspace")).toBe(true);
  expect(jspaceBinary("linux").endsWith("bin/jspace")).toBe(true);
});
