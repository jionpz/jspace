// application/registry/domain.ts — domain use cases (moved from cli/cmds.ts).
import { existsSync, mkdirSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fail, rejectErrors } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { normalizePortablePath } from "../../core/contracts/paths.ts";
import { decodeHub } from "../../core/contracts/hub.ts";
import { writeHubAtomic } from "../../adapters/fs/workbench-state.ts";
import { loadHub, assertHubValid } from "../workspace/state.ts";
import { cleanTags, findIndex, isWithin } from "./helpers.ts";

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

export function domainList(root: string, json: boolean): CmdResult {
  const hub = loadHub(root);
  if (json) {
    return { lines: [], data: { domains: hub.domains } };
  }
  return { lines: hub.domains.map((d) => `${d.id}  ${d.path}`) };
}

interface SkeletonResult {
  created: string[];
  nearestExisting: string;
}

export function writeDomainSkeleton(
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

export function rollbackDomainSkeleton(
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

export function domainAdd(
  root: string,
  domainId: string,
  pathOpt: string | undefined,
  tagsRaw: string[] | undefined,
  purposeOpt: string | undefined,
  dryRun: boolean,
): CmdResult {
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
  const domainDir = resolve(resolve(root, domainPath));
  if (!isWithin(domainDir, root) || domainDir === root) {
    fail(`--path must resolve inside the workbench root: ${domainPath}`);
  }
  if (existsSync(domainDir) && !statSync(domainDir).isDirectory()) {
    fail(`domain path is not a directory: ${domainPath}`);
  }

  const hub = loadHub(root);
  if (hub.domains.some((d) => d.id === domainId)) fail(`duplicate domain id: ${domainId}`);
  if (dryRun) {
    return { lines: [`jspace: ok: would add domain: ${domainId} (${domainPath})`] };
  }

  const { created, nearestExisting } = writeDomainSkeleton(domainDir, domainId, purpose, tags);
  hub.domains.push({ id: domainId, path: domainPath, ...(tags.length ? { tags } : {}) });
  const check = decodeHub(hub);
  if (!check.ok) {
    rollbackDomainSkeleton(domainDir, nearestExisting, created);
    rejectErrors(check.issues.map((i) => i.message));
  }
  try {
    writeHubAtomic(root, hub);
  } catch (e) {
    // skeleton written but the registry write failed — roll back the skeleton so
    // no orphan directory + missing hub record remains (issue #8 #13).
    rollbackDomainSkeleton(domainDir, nearestExisting, created);
    throw e;
  }
  return { lines: [`jspace: ok: added domain: ${domainId} (${domainPath})`] };
}

export function domainRemove(root: string, id: string, purge: boolean, dryRun: boolean): CmdResult {
  const hub = loadHub(root);
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
  if (dryRun) {
    let message = `would remove domain: ${id}`;
    if (!purge && domainPath) message += ` (kept directory ${domainPath})`;
    return { lines: [`jspace: ok: ${message}`] };
  }

  hub.domains.splice(index, 1);
  assertHubValid(hub);
  writeHubAtomic(root, hub);

  if (purge) {
    if (!domainPath) fail(`domain ${id} has no usable path to purge`);
    const domainDir = resolve(resolve(root, domainPath));
    if (!isWithin(domainDir, root) || domainDir === root) {
      fail(`refusing to purge directory outside workbench root: ${domainPath}`);
    }
    if (existsSync(domainDir)) rmSync(domainDir, { recursive: true, force: true });
  }

  let message = `removed domain: ${id}`;
  if (!purge && domainPath) message += ` (kept directory ${domainPath})`;
  return { lines: [`jspace: ok: ${message}`] };
}
