import { expect, test } from "bun:test";
import { weeklyPeriod } from "./weekly-period.ts";

test("uses the local Monday and half-open window at a week boundary", () => {
  const sunday = weeklyPeriod(new Date("2026-10-25T15:59:59Z"), {
    timeZone: "Asia/Shanghai",
  });
  expect(sunday).toMatchObject({
    week_start: "2026-10-19",
    week_end_exclusive: "2026-10-26",
    observed_through: "2026-10-25T23:59:59+08:00",
    status: "in_progress",
    is_current_week: true,
  });

  const monday = weeklyPeriod(new Date("2026-10-25T16:00:00Z"), {
    timeZone: "Asia/Shanghai",
  });
  expect(monday).toMatchObject({
    week_start: "2026-10-26",
    week_end_exclusive: "2026-11-02",
    observed_through: "2026-10-26T00:00:00+08:00",
    status: "in_progress",
  });
});

test("crosses month and year without changing period identity", () => {
  const report = weeklyPeriod(new Date("2027-01-01T12:00:00Z"), {
    timeZone: "Asia/Shanghai",
  });
  expect(report).toMatchObject({
    week_start: "2026-12-28",
    week_end_exclusive: "2027-01-04",
    window_start: "2026-12-28T00:00:00+08:00",
    window_end_exclusive: "2027-01-04T00:00:00+08:00",
  });
});

test("uses the exclusive end for a completed backfill week", () => {
  const report = weeklyPeriod(new Date("2026-10-19T10:00:00Z"), {
    timeZone: "Asia/Shanghai",
    monday: "2026-10-05",
  });
  expect(report).toMatchObject({
    week_start: "2026-10-05",
    week_end_exclusive: "2026-10-12",
    observed_through: "2026-10-12T00:00:00+08:00",
    status: "complete",
    is_current_week: false,
  });
});

test("keeps each DST boundary offset in the local half-open window", () => {
  const report = weeklyPeriod(new Date("2026-03-04T12:00:00Z"), {
    timeZone: "America/New_York",
  });
  expect(report).toMatchObject({
    week_start: "2026-03-02",
    week_end_exclusive: "2026-03-09",
    window_start: "2026-03-02T00:00:00-05:00",
    window_end_exclusive: "2026-03-09T00:00:00-04:00",
    observed_through: "2026-03-04T07:00:00-05:00",
  });
});

test("rejects Tuesday targets and future weeks", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  expect(() => weeklyPeriod(now, { timeZone: "Asia/Shanghai", monday: "2026-10-20" })).toThrow(
    "monday must be a Monday",
  );
  expect(() => weeklyPeriod(now, { timeZone: "Asia/Shanghai", monday: "2026-10-26" })).toThrow(
    "target week has not started",
  );
});
