// core/contracts/weekly-period.ts - pure, timezone-aware weekly windows.
// Period identity is the local Monday date; the window is always half-open.

export type WeeklyPeriodStatus = "in_progress" | "complete";

export interface WeeklyPeriod {
  schema_version: 1;
  timezone: string;
  week_start: string;
  week_end_exclusive: string;
  window_start: string;
  window_end_exclusive: string;
  observed_through: string;
  status: WeeklyPeriodStatus;
  is_current_week: boolean;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function resolveTimeZone(input?: string): string {
  const requested = input?.trim();
  const timeZone = requested && requested.length > 0
    ? requested
    : new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatterFor(timeZone).resolvedOptions().timeZone;
}

function partsAt(epochMs: number, timeZone: string): DateParts {
  const fields = new Map(
    formatterFor(timeZone)
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(fields.get("year")),
    month: Number(fields.get("month")),
    day: Number(fields.get("day")),
    hour: Number(fields.get("hour")),
    minute: Number(fields.get("minute")),
    second: Number(fields.get("second")),
  };
}

function parseYmd(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("date must be a real YYYY-MM-DD value");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("date must be a real YYYY-MM-DD value");
  }
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

function ymd(parts: Pick<DateParts, "year" | "month" | "day">): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDays(value: string, days: number): string {
  const parts = parseYmd(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return ymd({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function weekday(value: string): number {
  const parts = parseYmd(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** True when `value` is a real YYYY-MM-DD calendar date that falls on Monday. */
export function isMondayDate(value: string): boolean {
  try {
    return weekday(value) === 1;
  } catch {
    return false;
  }
}

function mondayOf(parts: DateParts): string {
  const date = ymd(parts);
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Convert a local wall-clock midnight to its UTC instant. The small fixed-point
 *  iteration handles current DST offsets without a Temporal dependency. */
function localMidnight(value: string, timeZone: string): number {
  const parts = parseYmd(value);
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let guess = desired;
  for (let i = 0; i < 6; i++) {
    const actual = partsAt(guess, timeZone);
    const actualWall = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const delta = desired - actualWall;
    if (delta === 0) return guess;
    guess += delta;
  }
  throw new RangeError(`cannot resolve local midnight for ${value} in ${timeZone}`);
}

function offsetAt(epochMs: number, timeZone: string): string {
  const parts = partsAt(epochMs, timeZone);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = Math.round((wall - Math.trunc(epochMs / 1000) * 1000) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function zonedIso(epochMs: number, timeZone: string): string {
  const parts = partsAt(epochMs, timeZone);
  return `${ymd(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${offsetAt(epochMs, timeZone)}`;
}

export interface WeeklyPeriodOptions {
  timeZone?: string;
  monday?: string;
}

/** Compute one weekly period. `monday` supports explicit backfill; it must be
 *  a real Monday whose local midnight is not later than `now`. Past weeks use
 *  their exclusive end as observed_through; the current week uses `now`. */
export function weeklyPeriod(now: Date, options: WeeklyPeriodOptions = {}): WeeklyPeriod {
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be a valid instant");
  const timeZone = resolveTimeZone(options.timeZone);
  const nowMs = Math.trunc(now.getTime() / 1000) * 1000;
  const nowParts = partsAt(nowMs, timeZone);
  const currentMonday = mondayOf(nowParts);
  const weekStart = options.monday ?? currentMonday;
  if (weekday(weekStart) !== 1) throw new RangeError("monday must be a Monday date");

  const startMs = localMidnight(weekStart, timeZone);
  const endDate = addDays(weekStart, 7);
  const endMs = localMidnight(endDate, timeZone);
  if (startMs > nowMs) throw new RangeError("target week has not started");

  const complete = nowMs >= endMs;
  const observedMs = complete ? endMs : nowMs;
  return {
    schema_version: 1,
    timezone: timeZone,
    week_start: weekStart,
    week_end_exclusive: endDate,
    window_start: zonedIso(startMs, timeZone),
    window_end_exclusive: zonedIso(endMs, timeZone),
    observed_through: zonedIso(observedMs, timeZone),
    status: complete ? "complete" : "in_progress",
    is_current_week: weekStart === currentMonday,
  };
}
