// cli/cmds.ts — doctor + domain/resource/filehub commands. All commands consume
// typed state via the core contracts + effective registry; no consumer re-parses
// raw hub/local JSON.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fail, rejectErrors } from "./errors.ts";
import { devRoot, expandTilde, filehubReadme } from "./embed.ts";
import { isFile, resolvePath } from "./paths.ts";
import { loadCrons, parseSchedule, installedCronIds, linuxCronHealth } from "./cron.ts";
import {
  assertHubValid,
  cleanTags,
  findIndex,
  ID_PATTERN,
  isId,
  isWithin,
  PairedWriteError,
  readWorkbenchState,
  REGISTRY_FILE,
  workbenchRoot,
  writeHubAndLocal,
  writeHubAtomic,
  type WorkbenchStateReads,
} from "./registry.ts";
import { normalizePortablePath } from "../core/contracts/paths.ts";
import {
  decodeHub,
  type HubV4,
  type PathEntrypoint,
  type Resource,
  type UrlEntrypoint,
} from "../core/contracts/hub.ts";
import type { LocalStateV1 } from "../core/contracts/local.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../core/registry/effective.ts";
import { inspectWorkbench, type InspectEnv } from "../core/registry/inspect.ts";

export const DEFAULT_DOMAIN_PURPOSE =
  "本域由 jspace domain add 创建，尚未填充用途；请按需补充管理方式/工作流。";

const DOMAIN_PROJECTS_SECTION = `
## 本域进行中的项目

| 项目 | 资产目录 | 状态 |
|---|---|---|
| <项目id> | filehub/projects/<项目>/ | 进行中 |

> 跟踪新项目三步(资产协议,见工作台 README「资产管理」):
> ① 资产层建 filehub/projects/<项目>/index.md(dashboard);
> ② 本表挂一行;
> ③ 记忆层建实体(gbrain,记录项目事实与指针)。
`;

function hubOf(reads: WorkbenchStateReads): HubV4 {
  switch (reads.hub.status) {
    case "missing":
      fail(`registry not found: ${join(reads.root, REGISTRY_FILE)}`);
      break;
    case "invalid":
      rejectErrors(reads.hub.issues.map((i) => `${i.message} (${i.code})`));
      break;
    case "ok":
      return reads.hub.value;
  }
  throw new Error("unreachable");
}

function localOf(reads: WorkbenchStateReads): LocalStateV1 | null {
  switch (reads.local.status) {
    case "missing":
      return null;
    case "invalid":
      rejectErrors(reads.local.issues.map((i) => `${i.message} (${i.code})`));
      break;
    case "ok":
      return reads.local.value;
  }
  throw new Error("unreachable");
}

/** Fresh machine-local state for a workbench that has none yet (e.g. a clone). */
function freshLocal(): LocalStateV1 {
  return { version: 1, installation_id: crypto.randomUUID(), bindings: {} };
}

// ---- doctor ----
/** Recursive file count for the filehub _inbox "unfiled" count.
 *  Skips dotfiles (.DS_Store / the future .processing marker) so macOS noise
 *  doesn't inflate the number. */
function countFiles(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

export function cmdDoctor(dir: string): void {
  const root = resolvePath(expandTilde(dir));
  const reads = readWorkbenchState(root);
  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: existsSync,
    isFile,
    readJson: (p) => JSON.parse(readFileSync(p, "utf-8")),
  };
  const diagnostics = inspectWorkbench(env);
  const errors = diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  // filehub asset-layer checks (warnings only, never blocking).
  if (reads.hub.status === "ok") {
    const local = reads.local.status === "ok" ? reads.local.value : null;
    const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
    const fhRoot = primaryPathForResourceType(effective, "filehub");
    if (!fhRoot) {
      warnings.push(
        "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
      );
    } else {
      const inboxDir = join(fhRoot, "_inbox");
      if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
        warnings.push(`filehub: _inbox missing: ${inboxDir}`);
      } else {
        const unfiled = countFiles(inboxDir);
        if (unfiled > 0) {
          warnings.push(
            `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")`,
          );
        }
      }
      const stagedDir = join(fhRoot, ".jspace-logs");
      if (existsSync(stagedDir)) {
        const applies = readdirSync(stagedDir).filter((n) => n.endsWith(".APPLY.md"));
        if (applies.length > 0) {
          warnings.push(
            `filehub: ${applies.length} pending staged gbrain write(s) (*.APPLY.md in .jspace-logs); apply when gbrain lock frees (check jspace cron failures)`,
          );
        }
      }
    }
  }

  // cron configuration checks (read-only; warnings only).
  const crons = loadCrons(root).crons;
  for (const c of crons) {
    try {
      parseSchedule(c.schedule);
    } catch {
      warnings.push(`cron ${c.id}: invalid schedule "${c.schedule}"`);
    }
  }
  if (process.platform === "linux") {
    const health = linuxCronHealth();
    if (!health.crontab) warnings.push("crontab command not found on this system; jspace cron cannot install tasks");
    if (!health.service) warnings.push("cron daemon not running; scheduled tasks won't fire until it starts");
  }
  const installedIds = new Set(installedCronIds(root));
  if (crons.length > 0) {
    for (const c of crons) {
      if (c.enabled && !installedIds.has(c.id)) {
        warnings.push(`cron ${c.id} enabled but not installed (run jspace cron install)`);
      }
    }
    for (const id of installedIds) {
      if (!crons.some((c) => c.id === id)) {
        warnings.push(`stale scheduled task com.jspace.cron.${id} (cron removed; run jspace cron uninstall)`);
      }
    }
  }
  const failedPath = join(root, ".jspace", "logs", "cron-failed.md");
  if (isFile(failedPath)) {
    const failed = readFileSync(failedPath, "utf-8").split("\n").filter((l) => l.startsWith("- ")).length;
    if (failed > 0) {
      warnings.push(`${failed} failed cron run(s) recorded in .jspace/logs/cron-failed.md (check with jspace cron status)`);
    }
  }

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
  const root = workbenchRoot();
  const hub = hubOf(readWorkbenchState(root));
  if (json) {
    console.log(JSON.stringify({ domains: hub.domains }, null, 2));
    return;
  }
  for (const d of hub.domains) {
    console.log(`${d.id}  ${d.path}`);
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
      `# ${domainId} domain\n\n本域由 jspace domain add 创建，尚未填充内容；请按需补充管理方式/工作流。\n${DOMAIN_PROJECTS_SECTION}`,
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
  if (!isId(domainId)) {
    fail(`invalid domain id: ${domainId} (lowercase letters, digits, and hyphens)`);
  }
  const domainPath = normalizePortablePath(pathOpt || `workspace/${domainId}`);
  const tags = cleanTags(tagsRaw);
  const purpose = (purposeOpt ?? "").trim() || DEFAULT_DOMAIN_PURPOSE;

  if (isAbsolute(domainPath)) fail("--path must be a relative path inside the workbench");
  if (domainPath.split("/").some((s) => s === "." || s === "..")) {
    fail(`--path must not contain . or .. segments: ${domainPath}`);
  }
  const domainDir = resolvePath(resolve(root, domainPath));
  if (!isWithin(domainDir, root) || domainDir === root) {
    fail(`--path must resolve inside the workbench root: ${domainPath}`);
  }
  if (existsSync(domainDir) && !statSync(domainDir).isDirectory()) {
    fail(`domain path is not a directory: ${domainPath}`);
  }

  const hub = hubOf(readWorkbenchState(root));
  if (hub.domains.some((d) => d.id === domainId)) fail(`duplicate domain id: ${domainId}`);

  const { created, nearestExisting } = writeDomainSkeleton(domainDir, domainId, purpose, tags);
  hub.domains.push({ id: domainId, path: domainPath, ...(tags.length ? { tags } : {}) });
  const check = decodeHub(hub);
  if (!check.ok) {
    rollbackDomainSkeleton(domainDir, nearestExisting, created);
    rejectErrors(check.issues.map((i) => i.message));
  }
  writeHubAtomic(root, hub);
  console.log(`jspace: ok: added domain: ${domainId} (${domainPath})`);
}

// ---- domain remove ----
export function cmdDomainRemove(id: string, purge: boolean): void {
  const root = workbenchRoot();
  const hub = hubOf(readWorkbenchState(root));
  const index = findIndex(hub.domains, id);
  if (index === null) fail(`no such domain: ${id}`);

  const references = hub.resources.filter((r) => r.domain === id).map((r) => r.id);
  if (references.length) {
    fail(
      `domain ${id} is referenced by resources: ${references.join(", ")} (remove them first)`,
    );
  }

  const domain = hub.domains[index];
  const domainPath = domain.path;
  hub.domains.splice(index, 1);
  assertHubValid(hub);
  writeHubAtomic(root, hub);

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
  const root = workbenchRoot();
  const reads = readWorkbenchState(root);
  const hub = hubOf(reads);
  const local = localOf(reads);
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
    console.log(JSON.stringify({ resources: payload }, null, 2));
    return;
  }
  for (const r of effective.resources) {
    const entrypoints = r.entrypoints
      .map((ep) => (ep.kind === "url" ? ep.value : (ep.resolved_path ?? ep.binding)))
      .join(", ");
    console.log(`${r.id}  ${r.domain}  ${entrypoints}`);
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
  if (!isId(id)) fail(`invalid resource id: ${id} (lowercase letters, digits, and hyphens)`);
  const reads = readWorkbenchState(root);
  const hub = hubOf(reads);
  const resourceType = (typeOpt ?? "project").trim() || "project";
  const tags = cleanTags(tagsRaw);

  if (!hub.domains.some((d) => d.id === domain)) fail(`no such domain: ${domain}`);
  if (hub.resources.some((r) => r.id === id)) fail(`duplicate resource id: ${id}`);

  const local = localOf(reads) ?? freshLocal();
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
  try {
    writeHubAndLocal(root, hub, local);
  } catch (e) {
    if (e instanceof PairedWriteError) fail(e.message);
    throw e;
  }
  console.log(`jspace: ok: added resource: ${id}`);
}

// ---- resource remove ----
export function cmdResourceRemove(id: string): void {
  const root = workbenchRoot();
  const reads = readWorkbenchState(root);
  const hub = hubOf(reads);
  const index = findIndex(hub.resources, id);
  if (index === null) fail(`no such resource: ${id}`);

  const removed = hub.resources[index];
  const removedBindings = removed.entrypoints
    .filter((ep) => ep.kind === "path")
    .map((ep) => ep.binding);
  hub.resources.splice(index, 1);
  assertHubValid(hub);

  const local = localOf(reads);
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
  console.log(`jspace: ok: removed resource: ${id}`);
}

// ---- filehub init ----
/** Register the filehub root as a type=filehub resource in the workbench at cwd. */
function registerFilehub(root: string, domainOpt: string | undefined): void {
  const wb = workbenchRoot();
  const reads = readWorkbenchState(wb);
  const hub = hubOf(reads);
  if (hub.resources.some((r) => r.type === "filehub")) {
    const existing = hub.resources.find((r) => r.type === "filehub")!;
    fail(
      `filehub already registered: ${existing.id} (remove it first with jspace resource remove, or reuse)`,
    );
  }

  const domain = (domainOpt ?? "files").trim() || "files";
  if (!isId(domain)) fail(`invalid domain id: ${domain}`);
  const domainPath = `workspace/${domain}`;
  let created: string[] = [];
  let nearestExisting = join(wb, "workspace");
  if (!hub.domains.some((d) => d.id === domain)) {
    const domainDir = resolvePath(resolve(wb, domainPath));
    if (!isWithin(domainDir, wb) || domainDir === wb) {
      fail(`domain path must resolve inside the workbench root: ${domainPath}`);
    }
    ({ created, nearestExisting } = writeDomainSkeleton(
      domainDir,
      domain,
      DEFAULT_DOMAIN_PURPOSE,
      [],
    ));
    hub.domains.push({ id: domain, path: domainPath });
    console.log(`jspace: ok: created domain: ${domain}`);
  }

  const bindingKey = "filehub-path";
  const local = localOf(reads) ?? freshLocal();
  if (local.bindings[bindingKey] !== undefined) {
    fail(`binding already exists: ${bindingKey} (remove the orphan binding first)`);
  }
  local.bindings[bindingKey] = root;
  hub.resources.push({
    id: "filehub",
    type: "filehub",
    domain,
    tags: cleanTags(["assets"]),
    entrypoints: [{ id: "path", kind: "path", binding: bindingKey, primary: true }],
    notes: "文件管理中心(资产层本体);归位/整理见 skills/asset-ingest",
  });
  try {
    writeHubAndLocal(wb, hub, local);
  } catch (e) {
    if (created.length) {
      rollbackDomainSkeleton(resolve(wb, domainPath), nearestExisting, created);
    }
    if (e instanceof PairedWriteError) fail(e.message);
    throw e;
  }
  console.log(`jspace: ok: registered filehub resource (type=filehub, primary=${root})`);
}

export function cmdFilehubInit(
  rootArg: string,
  register: boolean,
  domainOpt: string | undefined,
): void {
  const root = resolvePath(expandTilde(rootArg));
  if (existsSync(root) && !statSync(root).isDirectory()) {
    fail(`not a directory: ${root}`);
  }

  const readme = join(root, "README.md");
  const obsidianVault =
    existsSync(join(root, ".obsidian")) && statSync(join(root, ".obsidian")).isDirectory();

  // Always ensure the skeleton dirs (mkdir is idempotent; never touches user
  // files). Write the README only when missing, so a re-run is a no-op.
  mkdirSync(root, { recursive: true });
  for (const d of ["_inbox", "projects", "areas", "archive"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  if (!isFile(readme)) {
    writeFileSync(readme, filehubReadme(devRoot()), "utf-8");
    console.log(`jspace: ok: initialized filehub at ${root}`);
  } else {
    console.log(
      `jspace: ok: filehub already initialized at ${root} (skeleton kept, nothing overwritten)`,
    );
  }
  console.log(
    obsidianVault
      ? "jspace: info: existing Obsidian vault detected; structure is vault-compatible (no .obsidian written)"
      : "jspace: info: not an Obsidian vault yet; open this folder as a vault in Obsidian any time (structure is vault-compatible)",
  );

  if (register) {
    registerFilehub(root, domainOpt);
  } else {
    console.log(
      `jspace: hint: register later from a workbench dir with: jspace resource add filehub --type filehub --domain <domain> --path ${root} (or re-run with --register)`,
    );
  }
}

// ---- inbox status ----
/** Locate the inbox: filehub root/_inbox if registered and bound, else the
 *  degraded staging dir (<workbench>-inbox/) next to the workbench. Mirrors the
 *  asset-ingest skill's front-matter lookup. Returns null when neither exists. */
function locateInbox(root: string): string | null {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok") {
    return join(dirname(root), `${basename(root)}-inbox`);
  }
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  const fhRoot = primaryPathForResourceType(effective, "filehub");
  if (fhRoot) return join(fhRoot, "_inbox");
  return join(dirname(root), `${basename(root)}-inbox`);
}

/** Read-only inbox listing (no semantic judgment). */
export function cmdInboxStatus(json: boolean): void {
  const root = workbenchRoot();
  const inbox = locateInbox(root);
  if (!inbox || !existsSync(inbox)) {
    if (json) {
      console.log(JSON.stringify({ inbox: null, count: 0, files: [] }, null, 2));
      return;
    }
    console.log(
      "jspace: ok: no inbox to process (filehub not registered and no degraded staging dir)",
    );
    return;
  }

  const files = readdirSync(inbox)
    .filter((n) => !n.startsWith("."))
    .map((n) => {
      const p = join(inbox, n);
      const st = statSync(p);
      return {
        name: n,
        size: st.size,
        mtime: st.mtime.toISOString(),
        dir: st.isDirectory(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (json) {
    console.log(JSON.stringify({ inbox, count: files.length, files }, null, 2));
    return;
  }
  if (files.length === 0) {
    console.log("jspace: ok: inbox is empty (nothing to do)");
    return;
  }
  console.log(`jspace: inbox (${inbox}): ${files.length} file(s)`);
  for (const f of files) {
    console.log(
      `  ${f.name}${f.dir ? "/" : ""}  ${f.size} B  ${f.mtime.slice(0, 10)}`,
    );
  }
}
