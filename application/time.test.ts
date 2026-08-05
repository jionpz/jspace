import { expect, test } from "bun:test";
import { localDate, localStamp } from "./time.ts";

test("localDate formats YYYY-MM-DD (local, not UTC)", () => {
  expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("localStamp formats YYYY-MM-DDTHHMMSS and shares the day prefix", () => {
  const s = localStamp();
  expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}\d{2}\d{2}$/);
  expect(s.startsWith(`${localDate()}T`)).toBe(true);
});
