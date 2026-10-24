// application/filehub/refresh.ts — `jspace filehub refresh`: rebuild the two
// derived navigation blocks from registry + owner entries.
//
// Navigation is not state: a stale view is fixed by running refresh again, and
// nothing here writes hub.json, gbrain or any asset. Writes are planned for
// BOTH files first (every target's bytes are read and the marker state is
// checked), and only then applied — projects/README first, root README last, so
// a mid-way failure leaves the root entry pointing at an already-complete view
// instead of a file that does not exist yet.

import { accessSync, constants, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { loadHub } from "../workspace/state.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import {
  checkWritable,
  planManagedBlock,
  type BlockPlan,
} from "../registry/managed-readme.ts";
import {
  NAV_BLOCK_END,
  NAV_BLOCK_START,
  NAV_PROJECTS_BLOCK_END,
  NAV_PROJECTS_BLOCK_START,
  renderProjectsNavBlock,
  renderRootNavBlock,
  type NavArea,
  type NavInput,
  type NavProject,
} from "./navigation.ts";

export interface FilehubRefreshDeps {
  /** Workbench root used to resolve the registered filehub. */
  wbRoot: string;
  /** Injected for tests; defaults to the atomic writer. */
  write?: (path: string, content: string, mode?: number) => void;
}

interface FileResult {
  path: string;
  action: BlockPlan["action"];
  error?: string;
}

function readableIndex(path: string): boolean {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink()) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function directDirectories(path: string): string[] {
  let names: string[];
  try {
    names = readdirSync(path);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    try {
      const st = lstatSync(join(path, name));
      if (st.isDirectory() && !st.isSymbolicLink()) out.push(name);
    } catch {
      // unreadable/broken entry: skip, never guess
    }
  }
  return out;
}

function navInput(root: string, wbRoot: string): NavInput {
  const hub = loadHub(wbRoot);
  const projects: NavProject[] = hub.projects.map((project) => ({
    id: project.id,
    status: project.status,
    assetRelPath: project.asset_rel_path.replace(/\\/g, "/").replace(/\/+$/, ""),
    hasIndex: readableIndex(join(root, project.asset_rel_path, "index.md")),
  }));

  const areas: NavArea[] = directDirectories(join(root, "areas")).map((id) => ({
    id,
    hasIndex: readableIndex(join(root, "areas", id, "index.md")),
  }));

  const registered = projects.map((project) => project.assetRelPath);
  const unregistered = directDirectories(join(root, "projects"))
    .map((name) => `projects/${name}`)
    .filter((rel) => !registered.some((owner) => owner === rel || owner.startsWith(`${rel}/`)));

  return { projects, areas, unregistered };
}

/** `jspace filehub refresh [--dry-run] [--json]`. */
export function filehubRefresh(deps: FilehubRefreshDeps, dryRun: boolean, json: boolean): CmdResult {
  const root = resolveFilehubRoot(deps.wbRoot);
  if (root === null) {
    fail("no registered filehub found; register one with: jspace filehub init <path> --register");
  }
  let rootStat: ReturnType<typeof lstatSync>;
  try {
    rootStat = lstatSync(root);
  } catch {
    fail(`filehub root not found: ${root}`);
  }
  if (!rootStat.isDirectory()) fail(`not a directory: ${root}`);

  const input = navInput(root, deps.wbRoot);

  const rootReadme = join(root, "README.md");
  const projectsReadme = join(root, "projects", "README.md");
  const plans: BlockPlan[] = [
    planManagedBlock(
      projectsReadme,
      NAV_PROJECTS_BLOCK_START,
      NAV_PROJECTS_BLOCK_END,
      renderProjectsNavBlock(input),
    ),
    planManagedBlock(rootReadme, NAV_BLOCK_START, NAV_BLOCK_END, renderRootNavBlock(input)),
  ];

  const results: FileResult[] = [];
  let blocked = false;
  for (const plan of plans) {
    const problem = checkWritable(plan);
    if (problem !== null) {
      blocked = true;
      results.push({ path: plan.path, action: "conflict", error: problem });
    } else {
      results.push({ path: plan.path, action: plan.action });
    }
  }
  if (blocked) {
    const lines = [
      "jspace: filehub refresh refused; nothing was written",
      ...results.map((r) => `  ${relative(root, r.path) || r.path}: ${r.action}${r.error ? ` — ${r.error}` : ""}`),
    ];
    return { exitCode: 1, lines, errors: results.filter((r) => r.error).map((r) => `${r.path}: ${r.error}`), ...(json ? { data: { changed: false, files: results } } : {}) };
  }

  const changed = plans.some((plan) => plan.action !== "no-op");
  if (dryRun) {
    const lines = [
      changed
        ? "jspace: ok: would refresh filehub navigation (dry-run, nothing written)"
        : "jspace: ok: no-op: filehub navigation is already current (dry-run)",
      ...results.map((r) => `  ${relative(root, r.path) || r.path}: ${r.action}`),
    ];
    return {
      lines: json ? [] : lines,
      ...(json ? { data: { root, changed, dryRun: true, files: results } } : {}),
    };
  }

  // Apply in order: the full project directory first, the root entry last.
  const write = deps.write ?? ((path: string, content: string, mode?: number) => writeBytesAtomic(path, content, mode));
  const written: string[] = [];
  for (const plan of plans) {
    if (plan.action === "no-op") continue;
    // Re-check right before writing: the preflight above happened before the
    // first file was written, which is enough time for a concurrent edit.
    const problem = checkWritable(plan);
    if (problem !== null) {
      const done = written.map((path) => `  already written: ${path}`);
      return {
        exitCode: 1,
        lines: [
          `jspace: error: filehub refresh stopped at ${plan.path}: ${problem}`,
          ...done,
          "  re-run refresh after fixing the file — the written block is already correct and will be kept",
        ],
        errors: [`${plan.path}: ${problem}`],
        ...(json ? { data: { root, changed, partial: true, files: results } } : {}),
      };
    }
    if (plan.action === "create") {
      try {
        mkdirSync(dirname(plan.path), { recursive: true });
      } catch (error) {
        return {
          exitCode: 1,
          lines: [`jspace: error: cannot create ${dirname(plan.path)}: ${(error as Error).message}`],
          errors: [(error as Error).message],
          ...(json ? { data: { root, changed: false, files: results } } : {}),
        };
      }
    }
    try {
      write(plan.path, plan.next as string, plan.mode);
    } catch (error) {
      return {
        exitCode: 1,
        lines: [
          `jspace: error: failed writing ${plan.path}: ${(error as Error).message}`,
          "  re-run refresh to converge; already-written blocks are kept",
        ],
        errors: [(error as Error).message],
        ...(json ? { data: { root, changed, partial: true, files: results } } : {}),
      };
    }
    written.push(plan.path);
    results[results.findIndex((r) => r.path === plan.path)] = {
      path: plan.path,
      action: plan.action,
    };
  }

  const lines = [
    changed ? "jspace: ok: filehub navigation refreshed" : "jspace: ok: no-op: filehub navigation is already current",
    ...results.map((r) => `  ${relative(root, r.path) || r.path}: ${r.action}`),
    "jspace: info: registry, assets and gbrain untouched (derived view only)",
  ];
  return {
    lines: json ? [] : lines,
    ...(json ? { data: { root, changed, dryRun: false, files: results } } : {}),
  };
}
