// core/contracts/local.test.ts — pure decode tests for the machine-local state v1
// contract. Missing local (absent file) is a repository concern; this decoder
// only distinguishes valid from invalid payloads.
// Run: bun test core/contracts/local.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeLocal, type LocalStateV1 } from "./local.ts";

function validLocal(): LocalStateV1 {
  return {
    version: 1,
    installation_id: "7f9c6b0a-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
    bindings: {
      "filehub-primary": "/Users/u/filehub",
      "docs-site": "/Users/u/site",
    },
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectOk(input: unknown): void {
  const result = decodeLocal(input);
  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeLocal(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid local state decodes ok and round-trips", () => {
  const local = validLocal();
  const result = decodeLocal(JSON.parse(JSON.stringify(local)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(local);
});

test("empty bindings are valid", () => {
  expectOk({ version: 1, installation_id: "abc-123", bindings: {} });
});

test("version must be 1", () => {
  expectIssue({ ...validLocal(), version: 2 }, "local.version.unsupported");
  expectIssue({ ...validLocal(), version: "1" }, "local.version.unsupported");
});

test("installation_id must be present and match the id pattern", () => {
  expectIssue({ version: 1, bindings: {} }, "local.installation_id.invalid");
  expectIssue({ ...validLocal(), installation_id: "Has Spaces" }, "local.installation_id.invalid");
});

test("bindings must be an object with id-pattern keys and absolute values", () => {
  expectIssue({ ...validLocal(), bindings: [] }, "local.bindings.type");
  expectIssue({ ...validLocal(), bindings: { "Bad Key": "/tmp/x" } }, "local.binding.key.invalid");
  expectIssue({ ...validLocal(), bindings: { rel: "relative/path" } }, "local.binding.value.invalid");
  expectIssue({ ...validLocal(), bindings: { empty: "" } }, "local.binding.value.invalid");
});

test("unknown fields are rejected", () => {
  expectIssue({ ...validLocal(), provider: "cc-switch" }, "local.unknown-field");
});

test("independent issues are all reported at once", () => {
  const bad = { version: 2, installation_id: "Bad", bindings: { "Bad Key": "rel" }, extra: true };
  const result = decodeLocal(bad);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const codes = codesOf(result);
    for (const expected of ["local.version.unsupported", "local.installation_id.invalid", "local.binding.key.invalid", "local.binding.value.invalid", "local.unknown-field"]) {
      expect(codes).toContain(expected);
    }
  }
});
