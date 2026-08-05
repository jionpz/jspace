// cli/cron.ts — jspace binary resolution for scheduling. The cron command
// surface lives in application/automation; the CLI layer only owns path/binary
// resolution (devRoot/isCompiled are cli assets, not importable from application).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { devRoot, isCompiled } from "./embed.ts";

type Platform = "darwin" | "linux" | "win32";
const platform: Platform = process.platform as Platform;

/** Absolute jspace binary for scheduling. Compiled: process.execPath; source
 *  checkout: repo bin/jspace[.exe] (win32 probes for the .exe, H4). */
export function jspaceBinary(plat: Platform = platform): string {
  if (isCompiled()) return process.execPath;
  if (plat === "win32") {
    const exe = join(devRoot(), "bin", "jspace.exe");
    return existsSync(exe) ? exe : join(devRoot(), "bin", "jspace");
  }
  return join(devRoot(), "bin", "jspace");
}
