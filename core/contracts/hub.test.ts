// core/contracts/hub.test.ts — hub contract tests — schema_version 1 (the HubV4
// type name is a legacy identifier kept for code history; the schema field is schema_version: 1).
// Covers valid round-trip, unknown fields, strict boolean primary, duplicate
// ids, bad references, path traversal and multi-error reporting.
// Run: bun test core/contracts/hub.test.ts
import { expect, test } from "bun:test";
import type { DecodeResult } from "./diagnostics.ts";
import { decodeHub, type HubV4 } from "./hub.ts";

function validHub(): HubV4 {
  return {
    schema_version: 1,
    domains: [
      { id: "files", path: "workspace/files", tags: ["assets"] },
      { id: "general", path: "workspace/general" },
    ],
    resources: [
      {
        id: "filehub",
        type: "filehub",
        domain: "files",
        tags: ["assets"],
        notes: "文件管理中心",
        entrypoints: [{ id: "primary", kind: "path", binding: "filehub-primary", primary: true }],
      },
      {
        id: "docs",
        type: "url",
        domain: "general",
        entrypoints: [{ id: "site", kind: "url", value: "https://example.com" }],
      },
    ],
    projects: [{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }],
  };
}

function codesOf(result: DecodeResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectOk(input: unknown): HubV4 {
  const result = decodeHub(input);
  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  if (result.ok) return result.value;
  throw new Error("unreachable");
}

function expectIssue(input: unknown, code: string): void {
  const result = decodeHub(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(codesOf(result)).toContain(code);
  }
}

// ---- success + round-trip ----

test("valid v4 hub decodes ok and round-trips through JSON", () => {
  const hub = validHub();
  const value = expectOk(JSON.parse(JSON.stringify(hub)));
  expect(value).toEqual(hub);
});

test("empty domains/resources/projects arrays are valid", () => {
  const hub = { schema_version: 1, domains: [], resources: [], projects: [] };
  const value = expectOk(hub);
  expect(value.domains).toEqual([]);
  expect(value.projects).toEqual([]);
});

test("issue #8 #10: at most one filehub resource is allowed", () => {
  const two = {
    ...validHub(),
    resources: [
      ...validHub().resources,
      { id: "fh2", type: "filehub", domain: "files", entrypoints: [{ id: "p", kind: "path", binding: "fh2-p", primary: true }] },
    ],
  };
  expectIssue(two, "hub.resource.filehub.unique");
});

test("primary field accepts true/false/missing; resource needs exactly one true", () => {
  // false and missing are valid field *values* when a true primary exists
  expectOk({
    schema_version: 1,
    domains: [{ id: "d", path: "workspace/d" }],
    resources: [
      {
        id: "r",
        type: "x",
        domain: "d",
        entrypoints: [
          { id: "a", kind: "path", binding: "r-a", primary: true },
          { id: "b", kind: "path", binding: "r-b", primary: false },
        ],
      },
      {
        id: "s",
        type: "y",
        domain: "d",
        entrypoints: [
          { id: "c", kind: "path", binding: "s-c", primary: true },
          { id: "d", kind: "path", binding: "s-d" },
        ],
      },
    ],
    projects: [],
  });
});

// ---- version ----

test("schema_version other than 1 is rejected as unsupported", () => {
  const result = decodeHub({ ...validHub(), schema_version: 3 });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const v = result.issues.find((i) => i.code === "hub.version.unsupported");
    expect(v?.message).toContain("must be one of 1");
  }
});

test("legacy version:\"4\" (pre-unification) is rejected (P2-2 dropped the legacy axis)", () => {
  // pure legacy shape: no schema_version at all — the string `version` field is
  // no longer a recognized axis, so it decodes as damaged (unknown-field +
  // version.unsupported), never as a silent schema_version 1.
  const legacy = { version: "4", domains: [], resources: [], projects: [] } as unknown;
  const result = decodeHub(legacy);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("hub.version.unsupported");
    expect(codes).toContain("hub.unknown-field");
  }
});

test("missing schema_version or unknown legacy version is rejected", () => {
  const { schema_version: _omit, ...rest } = validHub();
  expectIssue(rest, "hub.version.unsupported");
  // pure legacy shapes with a non-"4" version (no schema_version) are damaged
  expectIssue({ version: "3", domains: [], resources: [], projects: [] }, "hub.version.unsupported");
  expectIssue({ version: null, domains: [], resources: [], projects: [] }, "hub.version.unsupported");
});

test("non-object root is rejected", () => {
  expectIssue([], "hub.root.type");
  expectIssue("4", "hub.root.type");
  expectIssue(null, "hub.root.type");
});

// ---- unknown fields ----

test("unknown top-level and nested fields are rejected", () => {
  expectIssue({ ...validHub(), extra: 1 }, "hub.unknown-field");
  expectIssue(
    { ...validHub(), domains: [{ id: "d", path: "workspace/d", wat: true }] },
    "hub.domain.unknown-field",
  );
  expectIssue(
    { ...validHub(), resources: [{ ...validHub().resources[0], bogus: 1 }] },
    "hub.resource.unknown-field",
  );
  expectIssue(
    {
      ...validHub(),
      resources: [{ ...validHub().resources[0], entrypoints: [{ id: "a", kind: "path", binding: "x", who: 1 }] }],
    },
    "hub.entrypoint.unknown-field",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "projects/p", status: "active", note: "x" }] },
    "hub.project.unknown-field",
  );
});

// ---- domains ----

test("domain id pattern, duplicates and path portability are validated", () => {
  expectIssue({ ...validHub(), domains: [{ id: "Bad_ID", path: "workspace/d" }] }, "hub.domain.id.invalid");
  expectIssue(
    { ...validHub(), domains: [...validHub().domains, { id: "files", path: "workspace/other" }] },
    "hub.domain.id.duplicate",
  );
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "/abs" }] }, "hub.domain.path.invalid");
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "workspace/../escape" }] }, "hub.domain.path.invalid");
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "workspace\\files" }] }, "hub.domain.path.invalid");
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "" }] }, "hub.domain.path.invalid");
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "workspace/d", tags: [""] }] }, "hub.domain.tags.invalid");
  expectIssue({ ...validHub(), domains: [{ id: "d", path: "workspace/d", tags: "x" }] }, "hub.domain.tags.invalid");
});

// ---- resources / entrypoints ----

test("resource id pattern, duplicates and domain reference are validated", () => {
  expectIssue({ ...validHub(), resources: [{ id: "Bad", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "x-a", primary: true }] }] }, "hub.resource.id.invalid");
  expectIssue(
    { ...validHub(), resources: [...validHub().resources, { ...validHub().resources[0] }] },
    "hub.resource.id.duplicate",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "missing", entrypoints: [{ id: "a", kind: "url", value: "https://x" }] }] },
    "hub.resource.domain.ref",
  );
  expectIssue({ ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [] }] }, "hub.resource.entrypoints.empty");
  expectIssue({ ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: "nope" }] }, "hub.resource.entrypoints.type");
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", tags: [1] }] },
    "hub.resource.tags.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", notes: 5, entrypoints: [{ id: "a", kind: "url", value: "https://x" }] }] },
    "hub.resource.notes.invalid",
  );
});

test("entrypoint id and binding key use the id pattern; ids unique within resource", () => {
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "Bad", kind: "url", value: "https://x" }] }] },
    "hub.entrypoint.id.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "url", value: "https://x" }, { id: "a", kind: "url", value: "https://y" }] }] },
    "hub.entrypoint.id.duplicate",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "Bad key", primary: true }] }] },
    "hub.entrypoint.path.binding.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", primary: true }] }] },
    "hub.entrypoint.path.binding.invalid",
  );
});

test("path entrypoints carry binding, not value; url entrypoints the reverse", () => {
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", value: "/abs", primary: true }] }] },
    "hub.entrypoint.path.value.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "url", binding: "x" }] }] },
    "hub.entrypoint.url.binding.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "url", value: "https://x", primary: true }] }] },
    "hub.entrypoint.url.primary.invalid",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "url" }] }] },
    "hub.entrypoint.url.value.invalid",
  );
});

test("primary is strict boolean: 0/1/null are rejected", () => {
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "r-a", primary: 1 }] }] },
    "hub.entrypoint.path.primary.type",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "r-a", primary: 0 }] }] },
    "hub.entrypoint.path.primary.type",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "r-a", primary: null }] }] },
    "hub.entrypoint.path.primary.type",
  );
});

test("path resources require exactly one primary", () => {
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "r-a", primary: true }, { id: "b", kind: "path", binding: "r-b", primary: true }] }] },
    "hub.resource.path.primary.count",
  );
  expectIssue(
    { ...validHub(), resources: [{ id: "r", type: "x", domain: "files", entrypoints: [{ id: "a", kind: "path", binding: "r-a" }] }] },
    "hub.resource.path.primary.count",
  );
});

test("non-path resources need no primary", () => {
  expectOk({
    schema_version: 1,
    domains: [{ id: "d", path: "workspace/d" }],
    resources: [
      { id: "r", type: "url", domain: "d", entrypoints: [{ id: "a", kind: "url", value: "https://x" }] },
      { id: "s", type: "url", domain: "d", entrypoints: [{ id: "b", kind: "url", value: "https://y" }, { id: "c", kind: "url", value: "https://z" }] },
    ],
    projects: [],
  });
});

// ---- projects ----

test("project id, domain reference, asset path and status are validated", () => {
  expectIssue(
    { ...validHub(), projects: [...validHub().projects, { id: "acme", domain: "files", asset_rel_path: "projects/x", status: "active" }] },
    "hub.project.id.duplicate",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "missing", asset_rel_path: "projects/p", status: "active" }] },
    "hub.project.domain.ref",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "etc/passwd", status: "active" }] },
    "hub.project.asset_rel_path.invalid",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "projects/../x", status: "active" }] },
    "hub.project.asset_rel_path.invalid",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "projects\\p", status: "active" }] },
    "hub.project.asset_rel_path.invalid",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "projects", status: "active" }] },
    "hub.project.asset_rel_path.invalid",
  );
  expectIssue(
    { ...validHub(), projects: [{ id: "p", domain: "files", asset_rel_path: "projects/p", status: "paused" }] },
    "hub.project.status.invalid",
  );
});

// ---- multi-error reporting ----

test("independent issues are all reported in one decode", () => {
  const bad = {
    schema_version: 1,
    domains: [
      { id: "Bad id", path: "/abs", extra: 1 },
      { id: "files", path: "workspace/files" },
    ],
    resources: [
      { id: "r", type: "x", domain: "missing-domain", entrypoints: [{ id: "a", kind: "path", binding: "r-a", primary: 1 }] },
    ],
    projects: [{ id: "p", domain: "missing-domain", asset_rel_path: "etc/passwd", status: "x" }],
  };
  const result = decodeHub(bad);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const codes = codesOf(result);
    for (const expected of [
      "hub.domain.id.invalid",
      "hub.domain.path.invalid",
      "hub.domain.unknown-field",
      "hub.resource.domain.ref",
      "hub.entrypoint.path.primary.type",
      "hub.project.domain.ref",
      "hub.project.asset_rel_path.invalid",
      "hub.project.status.invalid",
    ]) {
      expect(codes).toContain(expected);
    }
  }
});
