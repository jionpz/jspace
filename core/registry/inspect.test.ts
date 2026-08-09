// core/registry/inspect.test.ts — runtime inspection diagnostics. Distinguishes
// invalid/unbound/missing/drift classes with stable codes; never mutates state.
// Run: bun test core/registry/inspect.test.ts
import { expect, test } from "bun:test";
import type { FileRead, RegistryDiagnostic } from "../contracts/diagnostics.ts";
import type { HubV4 } from "../contracts/hub.ts";
import type { LocalStateV1 } from "../contracts/local.ts";
import type { WorkbenchMarkerV1 } from "../contracts/workbench.ts";
import { inspectWorkbench, type InspectEnv } from "./inspect.ts";

const ROOT = "/workbench";
const FH = "/filehub";

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
    ],
    projects: [{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }],
  };
}

function validMarker(): WorkbenchMarkerV1 {
  return { schema_version: 1, product: "JSpace", workbench_id: "wb-123", template_version: "1.0.3", created_at: "2026-08-03" };
}

function validLocal(bindings: Record<string, string> = { "filehub-primary": FH }): LocalStateV1 {
  return { version: 1, installation_id: "inst", bindings };
}

interface FakeFs {
  dirs: string[];
  files: string[];
  json: Record<string, unknown>;
}

interface EnvOverrides {
  hub?: FileRead<HubV4>;
  marker?: FileRead<WorkbenchMarkerV1>;
  local?: FileRead<LocalStateV1>;
  fs?: Partial<FakeFs>;
}

function makeEnv(overrides: EnvOverrides = {}): InspectEnv {
  const fs: FakeFs = {
    dirs: [
      `${ROOT}/workspace/files`,
      `${FH}`,
      `${FH}/projects`,
      `${FH}/projects/acme`,
    ],
    files: [
      `${ROOT}/workspace/files/README.md`,
      `${ROOT}/workspace/files/domain.json`,
      `${FH}/projects/acme/index.md`,
    ],
    json: {
      [`${ROOT}/workspace/files/domain.json`]: { id: "files", purpose: "资产" },
    },
    ...overrides.fs,
  };
  return {
    root: ROOT,
    hub: overrides.hub ?? { status: "ok", value: validHub() },
    marker: overrides.marker ?? { status: "ok", value: validMarker() },
    local: overrides.local ?? { status: "ok", value: validLocal() },
    pathExists: (p) => fs.dirs.includes(p) || fs.files.includes(p),
    isFile: (p) => fs.files.includes(p),
    readJson: (p) => {
      const v = fs.json[p];
      if (v === undefined) throw new Error(`no fake json for ${p}`);
      return v;
    },
  };
}

function codes(diags: RegistryDiagnostic[]): string[] {
  return diags.map((d) => d.code);
}

function severities(diags: RegistryDiagnostic[]): string[] {
  return diags.map((d) => d.severity);
}

test("healthy workbench produces no diagnostics", () => {
  expect(inspectWorkbench(makeEnv())).toEqual([]);
});

test("missing marker is a warning; invalid marker is blocking", () => {
  const missing = makeEnv({ marker: { status: "missing" } });
  expect(codes(inspectWorkbench(missing))).toContain("marker.missing");
  expect(severities(inspectWorkbench(missing))).toContain("warning");

  const legacy = makeEnv({ marker: { status: "invalid", issues: [{ code: "marker.unknown-field", path: "marker.source", message: "unknown field: source" }] } });
  const legacyDiags = inspectWorkbench(legacy);
  expect(codes(legacyDiags)).toContain("marker.unknown-field");
  expect(severities(legacyDiags)).toContain("error");
});

test("missing hub is an error; invalid (v3) hub is blocking", () => {
  expect(codes(inspectWorkbench(makeEnv({ hub: { status: "missing" } })))).toContain("hub.missing");

  const v3 = makeEnv({ hub: { status: "invalid", issues: [{ code: "hub.version.unsupported", path: "hub.version", message: 'version "3" is unsupported' }] } });
  const v3Diags = inspectWorkbench(v3);
  expect(codes(v3Diags)).toContain("hub.version.unsupported");
  expect(severities(v3Diags)).toContain("error");
});

test("missing local is a warning and leaves bindings unbound", () => {
  const diags = inspectWorkbench(makeEnv({ local: { status: "missing" } }));
  expect(codes(diags)).toContain("local.missing");
  expect(codes(diags)).toContain("binding.unbound");
});

test("invalid local is blocking and does not mask missing bindings", () => {
  const invalid = makeEnv({
    local: { status: "invalid", issues: [{ code: "local.version.unsupported", path: "local.version", message: "version must be 1" }] },
  });
  const diags = inspectWorkbench(invalid);
  expect(severities(diags)).toContain("error");
  expect(codes(diags)).toContain("local.version.unsupported");
});

test("unbound vs missing vs unused bindings produce distinct codes", () => {
  // unbound: binding key not in local
  const unbound = makeEnv({ local: { status: "ok", value: validLocal({}) } });
  expect(codes(inspectWorkbench(unbound))).toContain("binding.unbound");

  // missing: binding present but path does not exist
  const missing = makeEnv({
    local: { status: "ok", value: validLocal({ "filehub-primary": "/gone/filehub" }) },
    fs: { dirs: [] },
  });
  expect(codes(inspectWorkbench(missing))).toContain("binding.missing");

  // unused: binding present in local but referenced by no resource
  const unused = makeEnv({
    local: { status: "ok", value: validLocal({ "filehub-primary": FH, "stale": "/x" }) },
  });
  expect(codes(inspectWorkbench(unused))).toContain("binding.unused");
});

test("domain drift: missing dir, missing README, metadata mismatch", () => {
  const noDir = makeEnv({ fs: { dirs: [] } });
  expect(codes(inspectWorkbench(noDir))).toContain("domain.missing");

  const noReadme = makeEnv({ fs: { files: [`${ROOT}/workspace/files/domain.json`, `${FH}/projects/acme/index.md`] } });
  expect(codes(inspectWorkbench(noReadme))).toContain("domain.context_drift");

  const mismatch = makeEnv({
    fs: { json: { [`${ROOT}/workspace/files/domain.json`]: { id: "other", purpose: "x" } } },
  });
  expect(codes(inspectWorkbench(mismatch))).toContain("domain.context_drift");
});

test("project domain drift when the referenced domain directory is missing", () => {
  const diags = inspectWorkbench(makeEnv({ fs: { dirs: [`${FH}`, `${FH}/projects`, `${FH}/projects/acme`] } }));
  expect(codes(diags)).toContain("project.domain_drift");
});

test("filehub unbound makes project asset unverifiable, not missing", () => {
  const diags = inspectWorkbench(makeEnv({ local: { status: "ok", value: validLocal({}) } }));
  expect(codes(diags)).toContain("project.asset_unverifiable");
  expect(codes(diags)).not.toContain("project.asset_drift");
});

test("resolved filehub with missing project asset/index reports asset drift", () => {
  const noAsset = makeEnv({
    fs: { dirs: [`${ROOT}/workspace/files`, `${FH}`, `${FH}/projects`] },
  });
  expect(codes(inspectWorkbench(noAsset))).toContain("project.asset_drift");

  const noIndex = makeEnv({
    fs: {
      dirs: [`${ROOT}/workspace/files`, `${FH}`, `${FH}/projects`, `${FH}/projects/acme`],
      files: [`${ROOT}/workspace/files/README.md`, `${ROOT}/workspace/files/domain.json`],
    },
  });
  expect(codes(inspectWorkbench(noIndex))).toContain("project.asset_drift");
});

test("archived projects keep the drift warning (status does not suppress it)", () => {
  const hub = validHub();
  hub.projects[0].status = "archived";
  const diags = inspectWorkbench(
    makeEnv({
      hub: { status: "ok", value: hub },
      fs: { dirs: [`${ROOT}/workspace/files`, `${FH}`, `${FH}/projects`] },
    }),
  );
  expect(codes(diags)).toContain("project.asset_drift");
});
