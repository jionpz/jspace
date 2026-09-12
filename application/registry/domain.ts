// application/registry/domain.ts — domain use cases (moved from cli/cmds.ts).
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fail, rejectErrors } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { normalizePortablePath } from "../../core/contracts/paths.ts";
import { decodeHub } from "../../core/contracts/hub.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeHubAtomic } from "../../adapters/fs/workbench-state.ts";
import { withWorkbenchMutationLock } from "../lock.ts";
import { loadHub, assertHubValid } from "../workspace/state.ts";
import { cleanTags, confinedWithin, findIndex, isWithin } from "./helpers.ts";

/** Purge renames the tree here (O(1)) and deletes it after releasing the lock. */
const PURGE_TRASH_SEGMENTS = [CONFIG_DIR, "state", "trash"] as const;
/** Only residue this old can be swept: a younger entry may still be an in-flight
 *  delete from the process that released the lock seconds ago. */
const PURGE_TRASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  if (hub.domains.length === 0) return { lines: ["jspace: ok: no domains"] };
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
  return dryRun
    ? domainAddImpl(root, domainId, pathOpt, tagsRaw, purposeOpt, true)
    : withWorkbenchMutationLock(root, () => domainAddImpl(root, domainId, pathOpt, tagsRaw, purposeOpt, false));
}

function domainAddImpl(
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

interface DomainRemoveOutcome {
  result: CmdResult;
  /** Renamed-but-not-yet-deleted trees; empty unless this run purged. */
  trash: string[];
}

function purgeTrashDir(root: string): string {
  return join(root, ...PURGE_TRASH_SEGMENTS);
}

/** Best-effort reclaim of purge residue left by a crashed run. Runs OUTSIDE the
 *  lock (recursive deletion is unbounded in file count) and only touches entries
 *  old enough that no in-flight delete from another process can still own them. */
function sweepPurgeTrash(root: string, nowMs: number = Date.now()): void {
  const dir = purgeTrashDir(root);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (nowMs - statSync(p).mtimeMs > PURGE_TRASH_MAX_AGE_MS) rmSync(p, { recursive: true, force: true });
    } catch {
      // best-effort: an unreadable/busy entry is retried on the next purge
    }
  }
}

export function domainRemove(root: string, id: string, purge: boolean, dryRun: boolean): CmdResult {
  if (dryRun) return domainRemoveImpl(root, id, purge, true).result;
  if (purge) sweepPurgeTrash(root);
  const outcome = withWorkbenchMutationLock(root, () => domainRemoveImpl(root, id, purge, false));
  // The tree was renamed away inside the lock (O(1)); the recursive delete is
  // unbounded in file count, so it must NOT hold the lock — a multi-minute
  // delete would outlive the 30s stale budget and be reclaimed mid-flight.
  // A crash here leaves a uniquely-named tree under .jspace/state/trash, which
  // the next purge reclaims (sweepPurgeTrash).
  for (const p of outcome.trash) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // residue, reclaimed by a later purge
    }
  }
  return outcome.result;
}

function domainRemoveImpl(root: string, id: string, purge: boolean, dryRun: boolean): DomainRemoveOutcome {
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
  const trash: string[] = [];
  if (dryRun) {
    let message = `would remove domain: ${id}`;
    if (!purge && domainPath) message += ` (kept directory ${domainPath})`;
    return { result: { lines: [`jspace: ok: ${message}`] }, trash };
  }

  hub.domains.splice(index, 1);
  assertHubValid(hub);
  writeHubAtomic(root, hub);

  if (purge) {
    if (!domainPath) fail(`domain ${id} has no usable path to purge`);
    const domainDir = resolve(resolve(root, domainPath));
    const realRoot = realpathSync(root);
    const realDir = confinedWithin(domainDir, root);
    if (!realDir || realDir === realRoot) {
      fail(`refusing to purge directory outside workbench root: ${domainPath}`);
    }
    if (existsSync(domainDir)) {
      // Rename (same filesystem, O(1)) instead of recursing here: the caller
      // deletes the renamed tree after the lock is released.
      const trashPath = join(purgeTrashDir(root), `${id}-${Date.now()}-${process.pid}`);
      try {
        mkdirSync(dirname(trashPath), { recursive: true });
        renameSync(realDir, trashPath);
        trash.push(trashPath);
      } catch {
        // Cross-device / exotic mount: no O(1) handoff is possible, so fall
        // back to the legacy in-lock delete rather than refusing to purge.
        rmSync(realDir, { recursive: true, force: true });
      }
    }
  }

  let message = `removed domain: ${id}`;
  if (!purge && domainPath) message += ` (kept directory ${domainPath})`;
  return { result: { lines: [`jspace: ok: ${message}`] }, trash };
}
