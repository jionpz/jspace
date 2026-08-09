// application/ingest/project.test.ts — project id resolution (Child E, R2).
// Run: bun test application/ingest/project.test.ts
import { expect, test } from "bun:test";
import type { HubV4 } from "../../core/contracts/hub.ts";
import { deriveProjectId, resolveProjectId } from "./project.ts";

function hubWith(projects: HubV4["projects"]): HubV4 {
  return { schema_version: 1 as const, domains: [], resources: [], projects };
}

test("registered project id is used as-is", () => {
  const hub = hubWith([{ id: "foo", domain: "files", asset_rel_path: "projects/foo", status: "active" }]);
  expect(resolveProjectId(hub, "foo")).toEqual({ id: "foo", registered: true });
});

test("unregistered name derives a stable kebab id and signals not registered", () => {
  expect(resolveProjectId(hubWith([]), "foo bar")).toEqual({ id: "foo-bar", registered: false });
  expect(resolveProjectId(null, "foo bar")).toEqual({ id: "foo-bar", registered: false });
  expect(resolveProjectId(null, "  ")).toEqual({ id: "jspace", registered: false }); // empty -> fallback owner
});

test("non-ASCII names (CJK) get a stable distinct hash-based id, never collide", () => {
  const a = resolveProjectId(null, "周报");
  const b = resolveProjectId(null, "资产整理");
  expect(a.registered).toBe(false);
  expect(b.registered).toBe(false);
  expect(a.id.startsWith("p-")).toBe(true);
  expect(b.id.startsWith("p-")).toBe(true);
  expect(a.id).not.toBe(b.id); // distinct names -> distinct ids
  expect(resolveProjectId(null, "周报").id).toBe(a.id); // stable across calls
});

test("deriveProjectId collapses separators and strips edges", () => {
  expect(deriveProjectId("My Project!")).toBe("my-project");
  expect(deriveProjectId("---x---")).toBe("x");
  expect(deriveProjectId("   ")).toBe("jspace");
});
