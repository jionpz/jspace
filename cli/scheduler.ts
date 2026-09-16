// cli/scheduler.ts — workbench-scoped scheduler context: marker tag + platform
// adapter + env, shared by cron install/uninstall and doctor/hint installed-task
// detection. Single assembly point so install, uninstall, and health checks
// agree on identity (tag-scoped com.jspace.cron.<tag>.<id> everywhere).
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

/** Binaries the scheduled `jspace cron run` resolves BY NAME at run time, so the
 *  scheduler entry must carry a PATH containing them:
 *    - the harness: `harnessArgv` resolves it through `which`/`where`;
 *    - gbrain: spawned with a bare argv[0] (`$GBRAIN_BIN` overrides it, and
 *      GBRAIN_* is in the cron env whitelist, so an override needs no PATH).
 *  Both use the PATH the scheduler hands us — cron's own is /usr/bin:/bin. */
const SCHEDULED_BY_NAME = ["gbrain", ...cronHarnessNames()];

/** PATH for the managed scheduler entry: the dirs that actually resolve the
 *  binaries the run needs, plus the conventional system dirs.
 *
 *  It deliberately NEVER copies the invoking shell's `process.env.PATH`
 *  (issue #50):
 *    - unbounded — a long interactive PATH blew the crontab 1000-char cap, so
 *      `cron install` failed on a command that has nothing to do with PATH;
 *    - non-deterministic — the same install produced a different entry
 *      depending on which shell ran it.
 *  Resolving the dirs we need is bounded by construction (|SCHEDULED_BY_NAME|
 *  dirs) and independent of the caller's PATH length. Unresolvable names drop
 *  out (bare-name fallback = `which` miss, see `binaryOnPath`). */
export function schedulerPath(resolveBin: (name: string) => string, names: string[] = SCHEDULED_BY_NAME): string {
  const dirs = names
    .map((name) => ({ name, resolved: resolveBin(name) }))
    .filter(({ name, resolved }) => resolved !== name) // bare name = not found
    .map(({ resolved }) => dirname(resolved));
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
