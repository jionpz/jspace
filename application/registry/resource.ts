// application/registry/resource.ts — resource use cases (moved from cli/cmds.ts).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import type { HubV4, PathEntrypoint, Resource, UrlEntrypoint } from "../../core/contracts/hub.ts";
import {
  PairedWriteError,
  writeHubAndLocal,
  writeHubAtomic,
} from "../../adapters/fs/workbench-state.ts";
import { resolveEffectiveRegistry } from "../../core/registry/effective.ts";
import { loadHub, loadLocal, assertHubValid, freshLocal } from "../workspace/state.ts";
import { cleanTags, findIndex } from "./helpers.ts";

export function resourceList(root: string, json: boolean): CmdResult {
  const hub = loadHub(root);
  const local = loadLocal(root);
  const effective = resolveEffectiveRegistry(hub, local, { pathExists: existsSync });
  if (json) {
    const payload = effective.resources.map((r) => ({
      id: r.id,
      type: r.type,
      domain: r.domain,
      tags: r.tags ?? [],
      notes: r.notes ?? undefined,
      entrypoints: r.entrypoints.map((ep) =>
        ep.kind === "url"
          ? { id: ep.id, kind: "url", value: ep.value }
          : {
              id: ep.id,
              kind: "path",
              binding: ep.binding,
              primary: ep.primary ?? false,
              resolved_path: ep.resolved_path,
              resolution: ep.resolution,
            },
      ),
    }));
    return { lines: [], data: { resources: payload } };
  }
  return {
    lines: effective.resources.map((r) => {
      const entrypoints = r.entrypoints
        .map((ep) => (ep.kind === "url" ? ep.value : (ep.resolved_path ?? ep.binding)))
        .join(", ");
      return `${r.id}  ${r.domain}  ${entrypoints}`;
    }),
  };
}

export function resourceAdd(
  root: string,
  id: string,
  domain: string,
  typeOpt: string | undefined,
  pathOpt: string | undefined,
  urlOpt: string | undefined,
  tagsRaw: string[] | undefined,
  notes: string | undefined,
  dryRun: boolean,
): CmdResult {
  if (!isId(id)) failInvalidId(id);
  const hub = loadHub(root);
  const resourceType = (typeOpt ?? "project").trim() || "project";
  const tags = cleanTags(tagsRaw);

  if (!hub.domains.some((d) => d.id === domain)) fail(`no such domain: ${domain}`);
  if (hub.resources.some((r) => r.id === id)) fail(`duplicate resource id: ${id}`);

  const local = loadLocal(root) ?? freshLocal();
  let entrypoint: PathEntrypoint | UrlEntrypoint;
  if (pathOpt !== undefined) {
    if (!isAbsolute(pathOpt)) fail("--path must be an absolute path");
    const bindingKey = `${id}-path`;
    if (local.bindings[bindingKey] !== undefined) {
      fail(`binding already exists: ${bindingKey} (remove the orphan binding first)`);
    }
    local.bindings[bindingKey] = pathOpt;
    entrypoint = { id: "path", kind: "path", binding: bindingKey, primary: true };
  } else {
    if (urlOpt === undefined) fail("one of --path --url is required");
    entrypoint = { id: "url", kind: "url", value: urlOpt };
  }

  const record: Resource = { id, type: resourceType, domain, tags, entrypoints: [entrypoint] };
  if (notes) record.notes = notes;
  hub.resources.push(record);
  if (dryRun) {
    return { lines: [`jspace: ok: would add resource: ${id}`] };
  }
  try {
    writeHubAndLocal(root, hub, local);
  } catch (e) {
    if (e instanceof PairedWriteError) fail(e.message);
    throw e;
  }
  return { lines: [`jspace: ok: added resource: ${id}`] };
}

export function resourceRemove(root: string, id: string, dryRun: boolean): CmdResult {
  const hub: HubV4 = loadHub(root);
  const index = findIndex(hub.resources, id);
  if (index === null) fail(`no such resource: ${id}`);
  if (dryRun) {
    return { lines: [`jspace: ok: would remove resource: ${id}`] };
  }

  const removed = hub.resources[index];
  const removedBindings = removed.entrypoints
    .filter((ep) => ep.kind === "path")
    .map((ep) => ep.binding);
  hub.resources.splice(index, 1);
  assertHubValid(hub);

  const local = loadLocal(root);
  if (local) {
    const referenced = new Set<string>();
    for (const r of hub.resources) {
      for (const ep of r.entrypoints) {
        if (ep.kind === "path") referenced.add(ep.binding);
      }
    }
    for (const b of removedBindings) {
      if (!referenced.has(b)) delete local.bindings[b];
    }
    try {
      writeHubAndLocal(root, hub, local);
    } catch (e) {
      if (e instanceof PairedWriteError) fail(e.message);
      throw e;
    }
  } else {
    writeHubAtomic(root, hub);
  }
  return { lines: [`jspace: ok: removed resource: ${id}`] };
}

function failInvalidId(id: string): never {
  return fail(`invalid resource id: ${id} (lowercase letters, digits, and hyphens)`);
}
