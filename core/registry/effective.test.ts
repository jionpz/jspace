// core/registry/effective.test.ts — pure effective-registry resolution tests.
// Covers resolved|unbound|missing projection, unused bindings, and the
// two-machine fixture: same portable hub + different local bindings → same
// logical identity, different resolved paths.
// Run: bun test core/registry/effective.test.ts
import { expect, test } from "bun:test";
import type { HubV4 } from "../contracts/hub.ts";
import type { LocalStateV1 } from "../contracts/local.ts";
import {
  primaryPathForResourceType,
  resolveEffectiveRegistry,
  resolvedPrimaryPathForResourceType,
} from "./effective.ts";

function validHub(): HubV4 {
  return {
    schema_version: 1,
    domains: [{ id: "files", path: "workspace/files" }],
    resources: [
      {
        id: "filehub",
        type: "filehub",
        domain: "files",
        entrypoints: [{ id: "primary", kind: "path", binding: "filehub-primary", primary: true }],
      },
      {
        id: "docs",
        type: "url",
        domain: "files",
        entrypoints: [{ id: "site", kind: "url", value: "https://example.com" }],
      },
    ],
    projects: [{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }],
  };
}

const local = (bindings: Record<string, string>, id = "inst"): LocalStateV1 => ({
  schema_version: 1,
  installation_id: id,
  bindings,
});

test("resolved projection: binding present and path exists", () => {
  const reg = resolveEffectiveRegistry(validHub(), local({ "filehub-primary": "/a/filehub" }), {
    pathExists: (p) => p === "/a/filehub",
  });
  const fh = reg.resources.find((r) => r.id === "filehub")!;
  const ep = fh.entrypoints[0];
  expect(ep.kind).toBe("path");
  if (ep.kind === "path") {
    expect(ep.resolution).toBe("resolved");
    expect(ep.resolved_path).toBe("/a/filehub");
  }
  expect(primaryPathForResourceType(reg, "filehub")).toBe("/a/filehub");
  expect(resolvedPrimaryPathForResourceType(reg, "filehub")).toBe("/a/filehub");
});

test("unbound projection: binding missing from local", () => {
  const reg = resolveEffectiveRegistry(validHub(), local({}), { pathExists: () => false });
  const fh = reg.resources.find((r) => r.id === "filehub")!;
  const ep = fh.entrypoints[0];
  if (ep.kind === "path") {
    expect(ep.resolution).toBe("unbound");
    expect(ep.resolved_path).toBeNull();
  }
  expect(primaryPathForResourceType(reg, "filehub")).toBeNull();
  expect(resolvedPrimaryPathForResourceType(reg, "filehub")).toBeNull();
});

test("missing projection: binding present but path absent on this machine", () => {
  const reg = resolveEffectiveRegistry(validHub(), local({ "filehub-primary": "/gone/filehub" }), {
    pathExists: () => false,
  });
  const fh = reg.resources.find((r) => r.id === "filehub")!;
  const ep = fh.entrypoints[0];
  if (ep.kind === "path") {
    expect(ep.resolution).toBe("missing");
    expect(ep.resolved_path).toBe("/gone/filehub");
  }
  // consumers still receive the configured path so they can existence-check it
  expect(primaryPathForResourceType(reg, "filehub")).toBe("/gone/filehub");
  // verification treats a missing path as not resolvable
  expect(resolvedPrimaryPathForResourceType(reg, "filehub")).toBeNull();
});

test("missing local state makes every path entrypoint unbound", () => {
  const reg = resolveEffectiveRegistry(validHub(), null, { pathExists: () => true });
  const fh = reg.resources.find((r) => r.id === "filehub")!;
  const ep = fh.entrypoints[0];
  if (ep.kind === "path") expect(ep.resolution).toBe("unbound");
  expect(reg.local).toBeNull();
});

test("url entrypoints pass through unchanged", () => {
  const reg = resolveEffectiveRegistry(validHub(), local({}), { pathExists: () => false });
  const docs = reg.resources.find((r) => r.id === "docs")!;
  const ep = docs.entrypoints[0];
  expect(ep).toEqual({ id: "site", kind: "url", value: "https://example.com" });
});

test("unused bindings are reported after all references are known", () => {
  const reg = resolveEffectiveRegistry(
    validHub(),
    local({ "filehub-primary": "/a/filehub", "stale-binding": "/a/stale" }),
    { pathExists: (p) => p === "/a/filehub" },
  );
  expect(reg.unusedBindings).toEqual(["stale-binding"]);
});

test("two-machine fixture: same logical ids, different resolved paths", () => {
  const hub = validHub();
  const localA = local({ "filehub-primary": "/mnt/a/filehub" }, "inst-a");
  const localB = local({ "filehub-primary": "/mnt/b/filehub" }, "inst-b");
  const regA = resolveEffectiveRegistry(hub, localA, { pathExists: (p) => p === "/mnt/a/filehub" });
  const regB = resolveEffectiveRegistry(hub, localB, { pathExists: (p) => p === "/mnt/b/filehub" });

  expect(regA.domains.map((d) => d.id)).toEqual(regB.domains.map((d) => d.id));
  expect(regA.resources.map((r) => r.id)).toEqual(regB.resources.map((r) => r.id));
  expect(regA.projects.map((p) => p.id)).toEqual(regB.projects.map((p) => p.id));
  expect(regA.local?.installation_id).toBe("inst-a");
  expect(regB.local?.installation_id).toBe("inst-b");
  expect(primaryPathForResourceType(regA, "filehub")).toBe("/mnt/a/filehub");
  expect(primaryPathForResourceType(regB, "filehub")).toBe("/mnt/b/filehub");
});

test("issue #8 #10: primaryPathForResourceType fails on a duplicate filehub resource", () => {
  const two: HubV4 = {
    ...validHub(),
    resources: [
      ...validHub().resources,
      { id: "fh2", type: "filehub", domain: "files", entrypoints: [{ id: "p", kind: "path", binding: "fh2-p", primary: true }] },
    ],
  };
  const reg = resolveEffectiveRegistry(two, local({ "filehub-primary": "/a/fh", "fh2-p": "/b/fh" }), { pathExists: () => true });
  expect(() => primaryPathForResourceType(reg, "filehub")).toThrow(/must be unique/);
});
