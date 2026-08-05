// adapters/harness/argv.ts — headless harness argv generation (moved from
// cli/cron.ts). claude/codex/pi shapes are stable and CI-verified; the
// capability matrix in docs/PLATFORMS.md labels each as automated/best-effort.
import { spawnSync } from "node:child_process";
import { fail } from "../../core/shared/errors.ts";

/** Resolve a harness binary on PATH (win32 uses `where`, else `which`). */
export function resolveHarnessBin(harness: string, platform: string): string {
  const cmd = platform === "win32" ? "where" : "which";
  const w = spawnSync(cmd, [harness], { encoding: "utf-8" });
  return (w.stdout ?? "").trim().split(/\r?\n/)[0] || harness; // win: first line only
}

export function harnessArgv(harness: string, prompt: string, platform: string, bin?: string): string[] {
  const resolved = bin ?? resolveHarnessBin(harness, platform);
  switch (harness) {
    case "claude":
      // Permission whitelist for the batch needs: Bash/Read/Write/Edit + gbrain MCP.
      // NEVER bypassPermissions — cron is unattended.
      return [resolved, "-p", prompt, "--output-format", "text", "--allowedTools", "Bash,Read,Write,Edit,mcp__gbrain__*"];
    case "codex":
      return [resolved, "exec", prompt];
    case "pi":
      return [resolved, "-p", prompt];
    default:
      fail(`unsupported harness: ${harness}`);
  }
}
