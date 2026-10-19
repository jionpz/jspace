import { expect, test } from "bun:test";
import { checkStatus, countFindings, type CheckFinding } from "./check.ts";

const error: CheckFinding = { code: "x", severity: "error", message: "x" };
const unknown: CheckFinding = { code: "u", severity: "unknown", message: "u" };

test("checkStatus keeps ok, attention and partial distinct", () => {
  expect(checkStatus([], true)).toBe("ok");
  expect(checkStatus([error], true)).toBe("attention");
  expect(checkStatus([], false)).toBe("partial");
  expect(checkStatus([unknown], true)).toBe("partial");
});

test("countFindings counts every severity", () => {
  expect(countFindings([error, unknown, { ...unknown, code: "u2" }])).toEqual({
    error: 1,
    warning: 0,
    unknown: 2,
  });
});
