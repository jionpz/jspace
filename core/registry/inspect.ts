// core/registry/inspect.ts — runtime workbench inspection. Structural/schema
// validation already happened in the decoders; this layer owns filesystem and
// drift facts: local presence, binding resolution, domain context and project
// asset drift. Returns stable, severity-tagged diagnostics; never mutates state.
import { isAbsolute, join, relative } from "node:path";
import {
  isRecord,
  type FileRead,
  type RegistryDiagnostic,
} from "../contracts/diagnostics.ts";
import { HUB_FILE, LOCAL_FILE, MARKER_FILE } from "../contracts/files.ts";
import type { HubV4 } from "../contracts/hub.ts";
import type { LocalStateV1 } from "../contracts/local.ts";
import type { WorkbenchMarkerV1 } from "../contracts/workbench.ts";
import { resolveEffectiveRegistry } from "./effective.ts";

export interface InspectEnv {
  root: string;
  hub: FileRead<HubV4>;
  marker: FileRead<WorkbenchMarkerV1>;
  local: FileRead<LocalStateV1>;
  pathExists: (p: string) => boolean;
  isFile: (p: string) => boolean;
  readJson: (p: string) => unknown;
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function asErrors(issues: readonly { code: string; path: string; message: string }[]): RegistryDiagnostic[] {
  return issues.map((i) => ({ severity: "error", ...i }));
}

export function inspectWorkbench(env: InspectEnv): RegistryDiagnostic[] {
  const out: RegistryDiagnostic[] = [];

  // marker — missing is advisory (not initialized); invalid is blocking.
  if (env.marker.status === "missing") {
    out.push({
      severity: "warning",
      code: "marker.missing",
      path: MARKER_FILE,
      message: "not an initialized JSpace workbench (missing .jspace/marker.json)",
    });
  } else if (env.marker.status === "invalid") {
    out.push(...asErrors(env.marker.issues));
  }

  // hub — schema invalid is blocking; a missing registry in a marker-present
  // workbench is an error we cannot recover from.
  if (env.hub.status === "missing") {
    out.push({
      severity: "error",
      code: "hub.missing",
      path: HUB_FILE,
      message: `registry not found: ${join(env.root, HUB_FILE)}`,
    });
    return out;
  }
  if (env.hub.status === "invalid") {
    out.push(...asErrors(env.hub.issues));
    return out;
  }

  // local — missing is a warning (bindings unbound); malformed is blocking.
  let local: LocalStateV1 | null = null;
  if (env.local.status === "missing") {
    out.push({
      severity: "warning",
      code: "local.missing",
      path: LOCAL_FILE,
      message: "machine-local state missing (.jspace/local.json); path bindings are unbound until it is created",
    });
  } else if (env.local.status === "invalid") {
    out.push(...asErrors(env.local.issues));
  } else {
    local = env.local.value;
  }

  const effective = resolveEffectiveRegistry(env.hub.value, local, { pathExists: env.pathExists });

  // binding projection
  for (const r of effective.resources) {
    for (const ep of r.entrypoints) {
      if (ep.kind !== "path") continue;
      const where = `resources[${r.id}].entrypoints[${ep.id}]`;
      if (ep.resolution === "unbound") {
        out.push({
          severity: "warning",
          code: "binding.unbound",
          path: where,
          message: `resource ${r.id} entrypoint ${ep.id}: binding "${ep.binding}" is not set in local.json`,
        });
      } else if (ep.resolution === "missing") {
        out.push({
          severity: "warning",
          code: "binding.missing",
          path: where,
          message: `resource ${r.id} entrypoint ${ep.id}: bound path does not exist on this machine: ${ep.resolved_path}`,
        });
      }
    }
  }
  for (const key of effective.unusedBindings) {
    out.push({
      severity: "warning",
      code: "binding.unused",
      path: `local.bindings.${key}`,
      message: `binding "${key}" is not referenced by any resource`,
    });
  }

  // domain context drift
  const domainDirByIndex = new Map<string, string>();
  for (const d of env.hub.value.domains) {
    const where = `hub.domains[${d.id}]`;
    const dir = join(env.root, d.path);
    domainDirByIndex.set(d.id, dir);
    if (!env.pathExists(dir)) {
      out.push({
        severity: "warning",
        code: "domain.missing",
        path: where,
        message: `domain directory missing: ${d.path}`,
      });
      continue;
    }
    const readme = join(dir, "README.md");
    const meta = join(dir, "domain.json");
    if (!env.isFile(readme)) {
      out.push({
        severity: "warning",
        code: "domain.context_drift",
        path: where,
        message: `domain context missing README.md: ${d.path}/README.md`,
      });
    }
    if (!env.isFile(meta)) {
      out.push({
        severity: "warning",
        code: "domain.context_drift",
        path: where,
        message: `domain metadata missing: ${d.path}/domain.json`,
      });
    } else {
      try {
        const metadata = env.readJson(meta);
        if (!isRecord(metadata)) {
          out.push({ severity: "warning", code: "domain.context_drift", path: where, message: `${d.path}/domain.json must be an object` });
        } else {
          if (metadata.id !== d.id) {
            out.push({ severity: "warning", code: "domain.context_drift", path: where, message: `${d.path}/domain.json id must match ${d.id}` });
          }
          if (typeof metadata.purpose !== "string" || metadata.purpose.length === 0) {
            out.push({ severity: "warning", code: "domain.context_drift", path: where, message: `${d.path}/domain.json purpose must be non-empty` });
          }
        }
      } catch {
        out.push({ severity: "warning", code: "domain.context_drift", path: where, message: `${d.path}/domain.json is not valid JSON` });
      }
    }
  }

  // project drift — assets only verifiable when filehub resolves to a real path.
  const filehubRoot = effective.resources.find((r) => r.type === "filehub");
  const resolvedFilehub = filehubRoot
    ? filehubRoot.entrypoints.find(
        (ep) => ep.kind === "path" && ep.primary === true && ep.resolution === "resolved",
      )
    : undefined;

  for (const p of env.hub.value.projects) {
    const where = `hub.projects[${p.id}]`;
    const domainDir = domainDirByIndex.get(p.domain);
    if (domainDir && !env.pathExists(domainDir)) {
      out.push({
        severity: "warning",
        code: "project.domain_drift",
        path: where,
        message: `project ${p.id}: domain directory missing: ${p.domain}`,
      });
    }
    if (!resolvedFilehub || resolvedFilehub.kind !== "path" || !resolvedFilehub.resolved_path) {
      out.push({
        severity: "warning",
        code: "project.asset_unverifiable",
        path: where,
        message: `project ${p.id}: asset cannot be verified while filehub is unbound or missing`,
      });
      continue;
    }
    const fhRoot = resolvedFilehub.resolved_path;
    const assetDir = join(fhRoot, p.asset_rel_path);
    if (!isWithin(assetDir, fhRoot)) {
      out.push({
        severity: "error",
        code: "project.asset_drift",
        path: where,
        message: `project ${p.id}: asset path escapes filehub root: ${p.asset_rel_path}`,
      });
      continue;
    }
    if (!env.pathExists(assetDir)) {
      out.push({
        severity: "warning",
        code: "project.asset_drift",
        path: where,
        message: `project ${p.id}: asset directory missing: ${p.asset_rel_path}`,
      });
    } else if (!env.isFile(join(assetDir, "index.md"))) {
      out.push({
        severity: "warning",
        code: "project.asset_drift",
        path: where,
        message: `project ${p.id}: asset index missing: ${p.asset_rel_path}/index.md`,
      });
    }
  }

  return out;
}
