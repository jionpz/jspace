// application/registry/project.ts — `jspace project` use cases.
// Registers projects in the hub `projects` array. Projects are the logical
// owning ids that `ingest begin --project` resolves against; registering one
// removes the "not registered" warning and keeps derived slugs stable.
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { normalizePortablePath } from "../../core/contracts/paths.ts";
import { decodeHub, type Project } from "../../core/contracts/hub.ts";
import { writeHubAtomic } from "../../adapters/fs/workbench-state.ts";
import { loadHub } from "../workspace/state.ts";

/** Default owning domain: `filehub init --register` creates this when missing. */
const DEFAULT_DOMAIN = "files";

export function projectList(root: string, json: boolean): CmdResult {
  const hub = loadHub(root);
  if (json) {
    return { lines: [], data: { projects: hub.projects } };
  }
  return { lines: hub.projects.map((p) => `${p.id}  ${p.domain}  ${p.status}`) };
}

export function projectAdd(
  root: string,
  id: string,
  domainOpt: string | undefined,
  assetRelPathOpt: string | undefined,
  dryRun: boolean,
): CmdResult {
  if (!isId(id)) {
    fail(`invalid project id: ${id} (lowercase letters, digits, and hyphens)`);
  }
  const hub = loadHub(root);
  if (hub.projects.some((p) => p.id === id)) fail(`duplicate project id: ${id}`);

  const domain = (domainOpt ?? DEFAULT_DOMAIN).trim() || DEFAULT_DOMAIN;
  if (!hub.domains.some((d) => d.id === domain)) {
    fail(`no such domain: ${domain} (register one first: jspace domain add ${domain})`);
  }

  // The hub project contract requires asset_rel_path to begin with projects/ and
  // name a child path; default to the conventional project asset directory.
  const assetRelPath = normalizePortablePath(assetRelPathOpt?.trim() || `projects/${id}`);
  if (!assetRelPath.startsWith("projects/") || assetRelPath === "projects/") {
    fail(`--asset-rel-path must begin with projects/ and name a child path: ${assetRelPath}`);
  }

  const record: Project = { id, domain, asset_rel_path: assetRelPath, status: "active" };
  if (dryRun) {
    return {
      lines: [
        `jspace: ok: would add project: ${id} (domain=${domain}, asset_rel_path=${assetRelPath})`,
      ],
    };
  }
  hub.projects.push(record);
  // Re-encode + decode so the contract (id/domain ref/rel path/status) still holds
  // before writing disk — same invariant check the paired write performs.
  const check = decodeHub(hub);
  if (!check.ok) fail(check.issues.map((i) => i.message).join("; "));
  writeHubAtomic(root, hub);
  return { lines: [`jspace: ok: added project: ${id} (domain=${domain})`] };
}
