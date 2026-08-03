// cli/cmds.ts — doctor + domain/resource/filehub commands (mirror Python cmd_*).
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
import { MARKER_FILE } from "./init.ts";
import { loadCrons, parseSchedule, installedCronIds, linuxCronHealth } from "./cron.ts";
import {
  cleanTags,
  findIndex,
  ID_PATTERN,
  isWithin,
  loadRegistry,
  REGISTRY_FILE,
  saveRegistry,
  validateHub,
  workbenchRoot,
} from "./registry.ts";

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

/** Python dict.get(key, default): default only when the key is absent (not null). */
function orD(v: unknown, d: unknown): unknown {
  return v === undefined ? d : v;
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
  const warnings: string[] = [];
  if (!isFile(join(root, MARKER_FILE))) {
    warnings.push("not an initialized JSpace workbench (missing .jspace/marker.json)");
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

  // filehub asset-layer checks (warnings only, never blocking).
  const hub = data as Record<string, unknown>;
  const filehubs = (Array.isArray(hub.resources) ? hub.resources : []).filter(
    (r): r is Record<string, unknown> =>
      !!r && typeof r === "object" && !Array.isArray(r) && r.type === "filehub",
  );
  if (filehubs.length === 0) {
    warnings.push(
      "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
    );
  } else {
    for (const fh of filehubs) {
      const ep = (Array.isArray(fh.entrypoints) ? fh.entrypoints : []).find(
        (e): e is Record<string, unknown> =>
          !!e && typeof e === "object" && e.kind === "path" && e.primary === true,
      );
      const fhRoot = typeof ep?.value === "string" ? ep.value : undefined;
      if (!fhRoot) {
        warnings.push(`${fh.id}: no primary path entrypoint`);
        continue;
      }
      if (!existsSync(fhRoot)) continue; // validateHub already warns on a missing primary path
      const inboxDir = join(fhRoot, "_inbox");
      if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
        warnings.push(`${fh.id}: _inbox missing: ${inboxDir}`);
      } else {
        const unfiled = countFiles(inboxDir);
        if (unfiled > 0) {
          warnings.push(
            `${fh.id}: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")`,
          );
        }
      }
      // pending staged gbrain writes (APPLY.md) — apply when the lock frees.
      const stagedDir = join(fhRoot, ".jspace-logs");
      if (existsSync(stagedDir)) {
        const applies = readdirSync(stagedDir).filter((n) => n.endsWith(".APPLY.md"));
        if (applies.length > 0) {
          warnings.push(
            `${fh.id}: ${applies.length} pending staged gbrain write(s) (*.APPLY.md in .jspace-logs); apply when gbrain lock frees (check jspace cron failures)`,
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

// ---- filehub init ----
/** Register the filehub root as a type=filehub resource in the workbench at cwd. */
function registerFilehub(root: string, domainOpt: string | undefined): void {
  const wb = workbenchRoot();
  if (!isFile(join(wb, REGISTRY_FILE))) {
    fail(
      `not a JSpace workbench: registry not found at ${join(wb, REGISTRY_FILE)} (run filehub init --register from a workbench dir, or register later with: jspace resource add filehub --type filehub --domain <domain> --path ${root})`,
    );
  }
  const data = loadRegistry(wb);
  if (!Array.isArray(data.resources)) fail("hub.json resources must be an array");
  if (!Array.isArray(data.domains)) fail("hub.json domains must be an array");

  // Single-root convention: refuse a second filehub registration.
  const existing = data.resources.find(
    (r): r is Record<string, unknown> =>
      !!r && typeof r === "object" && !Array.isArray(r) && r.type === "filehub",
  );
  if (existing) {
    fail(
      `filehub already registered: ${typeof existing.id === "string" ? existing.id : "?"} (remove it first with jspace resource remove, or reuse)`,
    );
  }

  const domain = (domainOpt ?? "files").trim() || "files";
  if (!ID_PATTERN.test(domain)) fail(`invalid domain id: ${domain}`);
  const domainIndex = findIndex(data.domains, domain);
  if (domainIndex === null) {
    const domainDir = resolve(resolve(wb, "workspace", domain));
    if (!isWithin(domainDir, wb) || domainDir === wb) {
      fail(`domain path must resolve inside the workbench root: workspace/${domain}`);
    }
    const { created, nearestExisting } = writeDomainSkeleton(
      domainDir,
      domain,
      DEFAULT_DOMAIN_PURPOSE,
      [],
    );
    (data.domains as unknown[]).push({ id: domain, path: `workspace/${domain}`, tags: [] });
    const errors = validateHub(data, wb, []);
    if (errors.length) {
      rollbackDomainSkeleton(domainDir, nearestExisting, created);
      rejectErrors(errors);
    }
    console.log(`jspace: ok: created domain: ${domain}`);
  }

  (data.resources as unknown[]).push({
    id: "filehub",
    type: "filehub",
    domain,
    tags: cleanTags(["assets"]),
    entrypoints: [{ id: "path", kind: "path", value: root, primary: true }],
    notes: "文件管理中心(资产层本体);归位/整理见 skills/asset-ingest",
  });
  rejectErrors(validateHub(data, wb, []));
  saveRegistry(wb, data);
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
/** Locate the inbox: filehub root/_inbox if registered, else the degraded
 *  staging dir (<workbench>-inbox/) next to the workbench. Mirrors the
 *  asset-ingest skill's front-matter lookup. Returns null when neither exists. */
function locateInbox(root: string): string | null {
  const hub = loadRegistry(root) as Record<string, unknown>;
  const filehub = (Array.isArray(hub.resources) ? hub.resources : []).find(
    (r): r is Record<string, unknown> =>
      !!r && typeof r === "object" && !Array.isArray(r) && r.type === "filehub",
  );
  if (filehub) {
    const ep = (Array.isArray(filehub.entrypoints) ? filehub.entrypoints : []).find(
      (e): e is Record<string, unknown> =>
        !!e && typeof e === "object" && e.kind === "path" && e.primary === true,
    );
    const fhRoot = typeof ep?.value === "string" ? ep.value : undefined;
    if (fhRoot) return join(fhRoot, "_inbox");
  }
  const staging = join(dirname(root), `${basename(root)}-inbox`);
  return staging;
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
