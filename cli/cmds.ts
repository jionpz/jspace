// cli/cmds.ts — doctor + domain/resource commands (mirror Python cmd_*).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fail, rejectErrors } from "./errors.ts";
import { expandTilde } from "./embed.ts";
import { isFile, resolvePath } from "./paths.ts";
import { MARKER_FILE } from "./init.ts";
import {
  cleanTags,
  findIndex,
  isWithin,
  loadRegistry,
  REGISTRY_FILE,
  saveRegistry,
  validateHub,
  workbenchRoot,
} from "./registry.ts";

export const DEFAULT_DOMAIN_PURPOSE =
  "本域由 jspace domain add 创建，尚未填充用途；请按需补充管理方式/工作流。";

/** Python dict.get(key, default): default only when the key is absent (not null). */
function orD(v: unknown, d: unknown): unknown {
  return v === undefined ? d : v;
}

// ---- doctor ----
export function cmdDoctor(dir: string): void {
  const root = resolvePath(expandTilde(dir));
  const warnings: string[] = [];
  if (!isFile(join(root, MARKER_FILE))) {
    warnings.push("not an initialized JSpace workbench (missing .jspace.json)");
  }

  const registryPath = join(root, REGISTRY_FILE);
  if (!isFile(registryPath)) fail(`registry not found: ${registryPath}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(registryPath, "utf-8"));
  } catch (e) {
    fail(`${REGISTRY_FILE} is not valid JSON: ${(e as Error).message}`);
  }

  const errors = validateHub(data, root, warnings);
  for (const w of warnings) console.log(`jspace: warning: ${w}`);
  for (const e of errors) console.error(`jspace: error: ${e}`);
  if (errors.length) {
    console.error(
      `jspace: doctor failed: ${errors.length} error(s), ${warnings.length} warning(s)`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `jspace: doctor ok: ${errors.length} error(s), ${warnings.length} warning(s)`,
    );
  }
}

// ---- domain list ----
export function cmdDomainList(json: boolean): void {
  const data = loadRegistry(workbenchRoot());
  const raw = data.domains;
  const domains = (Array.isArray(raw) ? raw : []).filter(
    (d): d is Record<string, unknown> => !!d && typeof d === "object",
  );
  if (json) {
    const payload = domains.map((d) => ({
      id: orD(d.id, ""),
      path: orD(d.path, ""),
      tags: orD(d.tags, []),
    }));
    console.log(JSON.stringify({ domains: payload }, null, 2));
    return;
  }
  for (const d of domains) {
    console.log(`${d.id ?? ""}  ${d.path ?? ""}`);
  }
}

// ---- domain add ----
interface SkeletonResult {
  created: string[];
  nearestExisting: string;
}

function writeDomainSkeleton(
  domainDir: string,
  domainId: string,
  purpose: string,
  tags: string[],
): SkeletonResult {
  const created: string[] = [];
  let nearestExisting = domainDir;
  while (!existsSync(nearestExisting) && nearestExisting !== dirname(nearestExisting)) {
    nearestExisting = dirname(nearestExisting);
  }
  mkdirSync(domainDir, { recursive: true });

  const readme = join(domainDir, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# ${domainId} domain\n\n本域由 jspace domain add 创建，尚未填充内容；请按需补充管理方式/工作流。\n`,
      "utf-8",
    );
    created.push(readme);
  }

  const metadata = join(domainDir, "domain.json");
  if (!existsSync(metadata)) {
    writeFileSync(
      metadata,
      JSON.stringify({ id: domainId, purpose, summary: purpose, tags }, null, 2) + "\n",
      "utf-8",
    );
    created.push(metadata);
  }

  return { created, nearestExisting };
}

function rollbackDomainSkeleton(
  domainDir: string,
  nearestExisting: string,
  created: string[],
): void {
  for (const p of created) {
    if (existsSync(p)) unlinkSync(p);
  }
  let current = domainDir;
  while (current !== nearestExisting) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

export function cmdDomainAdd(
  domainId: string,
  pathOpt: string | undefined,
  tagsRaw: string[] | undefined,
  purposeOpt: string | undefined,
): void {
  const root = workbenchRoot();
  const domainPath = pathOpt || `workspace/${domainId}`;
  const tags = cleanTags(tagsRaw);
  const purpose = (purposeOpt ?? "").trim() || DEFAULT_DOMAIN_PURPOSE;

  if (isAbsolute(domainPath)) fail("--path must be a relative path inside the workbench");
  const domainDir = resolvePath(resolve(root, domainPath));
  if (!isWithin(domainDir, root) || domainDir === root) {
    fail(`--path must resolve inside the workbench root: ${domainPath}`);
  }
  if (existsSync(domainDir) && !statSync(domainDir).isDirectory()) {
    fail(`domain path is not a directory: ${domainPath}`);
  }

  const data = loadRegistry(root);
  if (!Array.isArray(data.domains)) fail("hub.json domains must be an array");

  const { created, nearestExisting } = writeDomainSkeleton(
    domainDir,
    domainId,
    purpose,
    tags,
  );
  (data.domains as unknown[]).push({ id: domainId, path: domainPath, tags });
  const errors = validateHub(data, root, []);
  if (errors.length) {
    rollbackDomainSkeleton(domainDir, nearestExisting, created);
    rejectErrors(errors);
  }

  saveRegistry(root, data);
  console.log(`jspace: ok: added domain: ${domainId} (${domainPath})`);
}

// ---- domain remove ----
export function cmdDomainRemove(id: string, purge: boolean): void {
  const root = workbenchRoot();
  const data = loadRegistry(root);
  const domains = data.domains;
  if (!Array.isArray(domains)) fail("hub.json domains must be an array");
  const index = findIndex(domains, id);
  if (index === null) fail(`no such domain: ${id}`);

  const resources = data.resources;
  const references = (Array.isArray(resources) ? resources : [])
    .filter(
      (r): r is Record<string, unknown> => !!r && typeof r === "object" && r.domain === id,
    )
    .map((r) => (typeof r.id === "string" ? r.id : "?"));
  if (references.length) {
    fail(
      `domain ${id} is referenced by resources: ${references.join(", ")} (remove them first)`,
    );
  }

  const domain = domains[index] as Record<string, unknown>;
  const domainPath = typeof domain.path === "string" ? domain.path : "";
  domains.splice(index, 1);
  rejectErrors(validateHub(data, root, []));

  saveRegistry(root, data);

  if (purge) {
    if (!domainPath) fail(`domain ${id} has no usable path to purge`);
    const domainDir = resolvePath(resolve(root, domainPath));
    if (!isWithin(domainDir, root) || domainDir === root) {
      fail(`refusing to purge directory outside workbench root: ${domainPath}`);
    }
    if (existsSync(domainDir)) rmSync(domainDir, { recursive: true, force: true });
  }

  let message = `removed domain: ${id}`;
  if (!purge && domainPath) message += ` (kept directory ${domainPath})`;
  console.log(`jspace: ok: ${message}`);
}

// ---- resource list ----
export function cmdResourceList(json: boolean): void {
  const data = loadRegistry(workbenchRoot());
  const raw = data.resources;
  const resources = (Array.isArray(raw) ? raw : []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
  if (json) {
    const payload = resources.map((r) => ({
      id: orD(r.id, ""),
      type: orD(r.type, ""),
      domain: orD(r.domain, ""),
      tags: orD(r.tags, []),
      entrypoints: orD(r.entrypoints, []),
    }));
    console.log(JSON.stringify({ resources: payload }, null, 2));
    return;
  }
  for (const r of resources) {
    const entrypoints = (Array.isArray(r.entrypoints) ? r.entrypoints : [])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => e.value ?? "")
      .join(", ");
    console.log(`${r.id ?? ""}  ${r.domain ?? ""}  ${entrypoints}`);
  }
}

// ---- resource add ----
export function cmdResourceAdd(
  id: string,
  domain: string,
  typeOpt: string | undefined,
  pathOpt: string | undefined,
  urlOpt: string | undefined,
  tagsRaw: string[] | undefined,
  notes: string | undefined,
): void {
  const root = workbenchRoot();
  const data = loadRegistry(root);
  if (!Array.isArray(data.resources)) fail("hub.json resources must be an array");

  const entrypoint =
    pathOpt !== undefined
      ? { id: "path", kind: "path", value: pathOpt, primary: true }
      : { id: "url", kind: "url", value: urlOpt };
  const resourceType = (typeOpt ?? "project").trim() || "project";

  const record: Record<string, unknown> = {
    id,
    type: resourceType,
    domain,
    tags: cleanTags(tagsRaw),
    entrypoints: [entrypoint],
  };
  if (notes) record.notes = notes;
  (data.resources as unknown[]).push(record);
  rejectErrors(validateHub(data, root, []));
  saveRegistry(root, data);
  console.log(`jspace: ok: added resource: ${id}`);
}

// ---- resource remove ----
export function cmdResourceRemove(id: string): void {
  const root = workbenchRoot();
  const data = loadRegistry(root);
  const resources = data.resources;
  if (!Array.isArray(resources)) fail("hub.json resources must be an array");
  const index = findIndex(resources, id);
  if (index === null) fail(`no such resource: ${id}`);
  resources.splice(index, 1);
  rejectErrors(validateHub(data, root, []));
  saveRegistry(root, data);
  console.log(`jspace: ok: removed resource: ${id}`);
}
