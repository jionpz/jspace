// application/automation/failure.test.ts — pure failure-reason classifier.
// Run: bun test application/automation/failure.test.ts
import { expect, test } from "bun:test";
import { classifyFailure, type FailureInput } from "./failure.ts";

function input(over: Partial<FailureInput> = {}): FailureInput {
  return { exit: 0, timedOut: false, stalled: false, batchStale: false, output: "done\n", ...over };
}

test("ok run has no reason", () => {
  expect(classifyFailure(input())).toBeUndefined();
});

test("stalled wins over timeout and exit code", () => {
  expect(classifyFailure(input({ stalled: true, timedOut: true, exit: 124 }))).toBe("stalled");
});

test("timeout is the terminal cause when the budget fired", () => {
  expect(classifyFailure(input({ timedOut: true, exit: 124, output: "" }))).toBe("timeout");
});

test("empty output on a zero exit is empty_output", () => {
  expect(classifyFailure(input({ output: "" }))).toBe("empty_output");
});

test("unverifiable inbox batch is batch_stale", () => {
  expect(classifyFailure(input({ batchStale: true }))).toBe("batch_stale");
});

test("spawn error is distinguished from a harness failure", () => {
  expect(classifyFailure(input({ exit: 1, output: "jspace: spawn error: ENOENT\n" }))).toBe("spawn_error");
});

test("auth failure", () => {
  expect(classifyFailure(input({ exit: 1, output: "Not logged in · Please run /login\n" }))).toBe("auth");
});

test("auth wins over a co-occurring API error", () => {
  expect(classifyFailure(input({ exit: 1, output: "Not logged in\nAPI Error: Request timed out\n" }))).toBe("auth");
});

test("a filesystem permission denial is not credentials/auth", () => {
  expect(classifyFailure(input({ exit: 1, output: "EPERM: permission denied, open '/tmp/x'\n" }))).toBe("exit_nonzero");
});

test("API stall / upstream failure", () => {
  expect(classifyFailure(input({ exit: 1, output: "API Error: Request timed out after 1071s\n" }))).toBe("api_stall");
  expect(classifyFailure(input({ exit: 1, output: "read ECONNRESET\n" }))).toBe("api_stall");
});

test("explicit model errors are model, but the non-fatal claude-code warning is not", () => {
  expect(classifyFailure(input({ exit: 1, output: "model not found: acme/missing\n" }))).toBe("model");
  // This warning appears in successful runs too (query_source: sdk and
  // generate_session_title); it must not become the root cause.
  const noise = '[claude-code:unrecognized_model] {"model":"acme/turbo","query_source":"sdk"}\n';
  expect(classifyFailure(input({ exit: 1, output: noise }))).toBe("exit_nonzero");
});

test("unmatched non-zero exit falls back to exit_nonzero", () => {
  expect(classifyFailure(input({ exit: 1, output: "something broke\n" }))).toBe("exit_nonzero");
});
