// cli/scheduler.ts — workbench-scoped scheduler context: marker tag + platform
// adapter + env, shared by cron install/uninstall and doctor/hint installed-task
// detection. Single assembly point so install, uninstall, and health checks
// agree on identity (tag-scoped com.jspace.cron.<tag>.<id> everywhere).
import { homedir } from "node:os";
import { fail } from "../core/shared/errors.ts";
import { readMarker } from "../adapters/fs/workbench-state.ts";
import { schedulerAdapter, workbenchTag, type SchedulerEnv } from "../adapters/scheduler/index.ts";
import { jspaceBinary } from "./cron.ts";
import { resolvePath } from "./paths.ts";

const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export function schedulerEnv(): SchedulerEnv {
  return {
    jspaceBinary: jspaceBinary(),
    home: homedir(),
    path: process.env.PATH ?? DEFAULT_PATH,
    resolvePath,
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
