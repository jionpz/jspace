// core/contracts/workbench.test.ts — pure decode tests for the portable marker v1
// contract. The legacy `source` field (dev-repo absolute path) must be rejected.
// Run: bun test core/contracts/workbench.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeMarker, type WorkbenchMarkerV1 } from "./workbench.ts";

function validMarker(): WorkbenchMarkerV1 {
  return {
    schema_version: 1,
    product: "JSpace",
    workbench_id: "a1b2c3d4-5678-9abc-def0-123456789abc",
    template_version: "1.0.3",
    created_at: "2026-08-03",
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeMarker(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(codesOf(result)).toContain(code);
}

test("valid marker decodes ok and round-trips", () => {
  const marker = validMarker();
  const result = decodeMarker(JSON.parse(JSON.stringify(marker)));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual(marker);
});

test("schema_version must be 1", () => {
  expectIssue({ ...validMarker(), schema_version: 2 }, "marker.version.unsupported");
});

test("product must be JSpace", () => {
  expectIssue({ ...validMarker(), product: "Other" }, "marker.product.invalid");
});

test("workbench_id must match the id pattern", () => {
  expectIssue({ ...validMarker(), workbench_id: "Has Spaces" }, "marker.workbench_id.invalid");
  expectIssue({ ...validMarker(), workbench_id: "" }, "marker.workbench_id.invalid");
});

test("template_version and created_at are required; created_at is a date", () => {
  expectIssue({ schema_version: 1, product: "JSpace", workbench_id: "abc", created_at: "2026-08-03" }, "marker.template_version.invalid");
  expectIssue({ ...validMarker(), created_at: "2026-8-3" }, "marker.created_at.invalid");
  expectIssue({ ...validMarker(), created_at: "yesterday" }, "marker.created_at.invalid");
  expectIssue({ ...validMarker(), created_at: "" }, "marker.created_at.invalid");
});

test("legacy source field is rejected as unknown (no dev-repo path leakage)", () => {
  const result = decodeMarker({ ...validMarker(), source: "/Users/dev/jspace" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(codesOf(result)).toContain("marker.unknown-field");
  }
});

test("non-object root is rejected", () => {
  expectIssue(null, "marker.root.type");
  expectIssue([], "marker.root.type");
});
