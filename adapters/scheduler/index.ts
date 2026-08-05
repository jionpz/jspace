// adapters/scheduler/index.ts — platform scheduler adapter selection.
import type { SchedulerAdapter } from "./types.ts";
import { darwinAdapter } from "./darwin.ts";
import { linuxAdapter } from "./linux.ts";
import { win32Adapter } from "./win32.ts";

export type { InstalledTask, SchedulerAdapter, SchedulerEnv, SchedulerOp } from "./types.ts";
export { taskIdFor, workbenchTag } from "./types.ts";

const ADAPTERS: Record<string, SchedulerAdapter> = {
  darwin: darwinAdapter,
  linux: linuxAdapter,
  win32: win32Adapter,
};

export function schedulerAdapter(platform: string): SchedulerAdapter | null {
  return ADAPTERS[platform] ?? null;
}
