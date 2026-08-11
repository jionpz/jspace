// adapters/scheduler/spawn.ts — single guarded entry for external scheduler
// commands. Every crontab/schtasks/plutil/launchctl call in the scheduler layer
// goes through schedulerSpawn: utf-8 encoding + a hard timeout. No bare
// spawnSync is allowed here (same red line as gbrain's process spawn — the
// adapters must never block the CLI on a hung platform tool).
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { SCHEDULER_SPAWN_TIMEOUT_MS } from "./types.ts";

export interface SchedulerSpawnOpts {
  /** stdin content written to the child (crontab `-`) — only set by callers
   *  that actually need stdin, so other tools never get an input pipe. */
  input?: string;
}

/** Options the wrapper always passes to the underlying spawn. */
export interface SchedulerSpawnImplOpts {
  encoding: "utf-8";
  timeout: number;
  input?: string;
}

export type SchedulerSpawnImpl = (
  cmd: string,
  args: string[],
  opts: SchedulerSpawnImplOpts,
) => SpawnSyncReturns<string>;

export type SchedulerSpawn = (
  cmd: string,
  args: string[],
  opts?: SchedulerSpawnOpts,
) => SpawnSyncReturns<string>;

/** Build a scheduler spawn with an injectable underlying spawn (tests pass a
 *  fake to observe the timeout without a real command). The default instance
 *  uses the real node spawnSync. */
export function makeSchedulerSpawn(spawn: SchedulerSpawnImpl): SchedulerSpawn {
  return (cmd, args, opts = {}) =>
    spawn(cmd, args, {
      encoding: "utf-8",
      timeout: SCHEDULER_SPAWN_TIMEOUT_MS,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
}

/** Production scheduler spawn (real spawnSync behind the timeout guard). */
export const schedulerSpawn = makeSchedulerSpawn(spawnSync);
