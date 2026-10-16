// cli/scheduler.ts — workbench-scoped scheduler context: marker tag + platform
// adapter + env, shared by cron install/uninstall and doctor/hint installed-task
// detection. Single assembly point so install, uninstall, and health checks
// agree on identity (tag-scoped com.jspace.cron.<tag>.<id> everywhere).
import { closeSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fail } from "../core/shared/errors.ts";
import { readMarker } from "../adapters/fs/workbench-state.ts";
import { resolveHarnessBin } from "../adapters/harness/bin.ts";
import { cronHarnessNames } from "../adapters/harness/registry.ts";
import { schedulerAdapter, workbenchTag, type SchedulerEnv } from "../adapters/scheduler/index.ts";
import { jspaceBinary } from "./cron.ts";

/** Conventional system dirs, appended LAST so a user-installed harness in a
 *  custom dir still wins the lookup. POSIX list — the only platforms whose
 *  adapter consumes `env.path` (win32's schtasks path ignores it). */
const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** Binaries the scheduled entry's processes resolve BY NAME at run time. The
 *  list is the transitive closure, not just what jspace spawns itself:
 *    - the harness: `harnessArgv` resolves it through `which`/`where`;
 *    - gbrain: spawned with a bare argv[0] (`$GBRAIN_BIN` overrides it, and
 *      GBRAIN_* is in the cron env whitelist, so an override needs no PATH);
 *    - **jspace itself**: the harness's own hooks and plugins call bare `jspace`
 *      (templates wire `jspace context session-start|turn|session-end`), and
 *      that resolution happens off the SAME entry PATH.
 *  Both use the PATH the scheduler hands us — cron's own is /usr/bin:/bin. */
const SCHEDULED_BY_NAME = ["gbrain", ...cronHarnessNames(), "jspace"];

/** Node budget for the shebang closure. Each resolved binary can pull in its
 *  interpreter, which can itself be a shim, and so on; a cycle (a -> b -> a) or
 *  a pathological chain must terminate. Comfortably above any real machine's
 *  shim depth while keeping the entry short (the crontab line has a 1000-char
 *  cap, see crontabLine). */
const MAX_CLOSURE_NODES = 16;

/** Read the first line of a file (a shebang is on line 1). Capped at 128 bytes
 *  so a large binary is never read whole; unreadable files return "" (treated as
 *  "no shebang"). Injected in tests to model shim chains without real files. */
function readFirstLine(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(128);
    const n = readSync(fd, buf, 0, 128, 0);
    return buf.subarray(0, n).toString("utf-8").split("\n")[0] ?? "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** One node of the closure walk: either a NAME to look up on PATH, or an
 *  absolute path already fixed by a shebang (which needs no lookup — the kernel
 *  execs it directly). */
type ClosureNode = { kind: "name"; name: string } | { kind: "abs"; path: string };

/** Follow a shebang one step. Two forms matter:
 *    `#!/usr/bin/env <name>`  — a SECOND name lookup at run time. This is the
 *        case that made `gbrain` resolve but not run: `which gbrain` returns the
 *        shim dir, while the shim's `#!/usr/bin/env bun` needs `bun` (Homebrew)
 *        on PATH as well (2026-10-14, issue #50's other face).
 *    `#!<abs/path>`           — a fixed interpreter path; PATH is irrelevant to
 *        reaching it, and the interpreter may itself be a shim, so it is
 *        followed again from that path.
 *  Null when the line is not a shebang. */
function shebangInterpreterNode(line: string): ClosureNode | null {
  const m = line.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
  if (!m) return null;
  const [, first, second] = m;
  if (first.endsWith("/env") && second !== undefined) return { kind: "name", name: second };
  return first.startsWith("/") ? { kind: "abs", path: first } : { kind: "name", name: first };
}

/** Expand the name set into the directory closure: resolve each name, then
 *  follow each resolved binary's shebang chain (shim -> interpreter -> ...).
 *  Bounded by `visited` (keyed on the resolved path, so a cycle is visited once)
 *  and MAX_CLOSURE_NODES. */
function closureDirs(
  names: string[],
  resolveBin: (name: string) => string,
  read: (p: string) => string,
): string[] {
  const dirs = new Set<string>();
  const visited = new Set<string>();
  const queue: ClosureNode[] = names.map((name) => ({ kind: "name", name }));
  let steps = 0;
  while (queue.length > 0 && steps < MAX_CLOSURE_NODES) {
    steps += 1;
    const node = queue.shift()!;
    let resolved: string | null;
    if (node.kind === "abs") {
      resolved = node.path; // fixed by the shebang — no PATH lookup applies
    } else {
      const looked = resolveBin(node.name);
      resolved = looked === node.name ? null : looked; // bare name = not found
    }
    if (resolved === null || visited.has(resolved)) continue;
    visited.add(resolved);
    dirs.add(dirname(resolved));
    const target = shebangInterpreterNode(read(resolved));
    if (target !== null) queue.push(target);
  }
  return [...dirs];
}

/** PATH for the managed scheduler entry: the dirs that actually resolve the
 *  binaries the entry's processes need — including their shebang interpreters —
 *  plus the conventional system dirs.
 *
 *  It deliberately NEVER copies the invoking shell's `process.env.PATH`
 *  (issue #50):
 *    - unbounded — a long interactive PATH blew the crontab 1000-char cap, so
 *      `cron install` failed on a command that has nothing to do with PATH;
 *    - non-deterministic — the same install produced a different entry
 *      depending on which shell ran it.
 *  Walking the shebang closure is bounded by construction (visited set +
 *  MAX_CLOSURE_NODES) and independent of the caller's PATH length. Unresolvable
 *  names drop out (bare-name fallback = `which` miss, see `binaryOnPath`). */
export function schedulerPath(
  resolveBin: (name: string) => string,
  names: string[] = SCHEDULED_BY_NAME,
  read: (p: string) => string = readFirstLine,
): string {
  const dirs = closureDirs(names, resolveBin, read);
  return [...new Set([...dirs, ...DEFAULT_PATH.split(":")])].join(":");
}

export function schedulerEnv(deps: { resolveBin?: (name: string) => string } = {}): SchedulerEnv {
  const resolveBin = deps.resolveBin ?? ((name: string) => resolveHarnessBin(name, process.platform));
  return {
    jspaceBinary: jspaceBinary(),
    home: homedir(),
    path: schedulerPath(resolveBin),
  };
}

/** Workbench tag from marker.workbench_id; fails loud when the marker is missing
 *  (a shared "unknown" tag would let one broken workbench clobber another's). */
export function workbenchTagFor(root: string): string {
  const marker = readMarker(root);
  if (marker.status !== "ok") fail(`missing .jspace/marker.json in ${root}; re-init or repair before cron scheduling`);
  return workbenchTag(marker.value.workbench_id);
}

/** Installed cron ids for THIS workbench (tag-scoped). Returns [] when the
 *  marker/adapter is unavailable so `jspace doctor` keeps reporting the marker
 *  issue as a diagnostic instead of throwing (doctor is a health check). */
export function installedCronIdsForRoot(root: string): string[] {
  const marker = readMarker(root);
  if (marker.status !== "ok") return [];
  const adapter = schedulerAdapter(process.platform);
  if (!adapter) return [];
  return adapter.inspect(workbenchTag(marker.value.workbench_id), schedulerEnv()).map((t) => t.cronId);
}

/** Hint source for cron add/remove: is this cron id currently installed for
 *  this workbench's tag? (Replaces the legacy untagged plist existence check.) */
export function cronIsInstalledForRoot(root: string, cronId: string): boolean {
  return installedCronIdsForRoot(root).includes(cronId);
}
