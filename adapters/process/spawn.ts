// adapters/process/spawn.ts — OS process spawn adapter.
// Spawns a harness argv (win32 .cmd/.bat routed through cmd.exe), streams
// stdout+stderr (capped), and arms a timeout kill. Returns exit/output/timedOut
// so the application layer never touches child_process directly. This is the
// single place platform process-I/O lives (was application/automation/win32-spawn.ts).
import { spawn, spawnSync } from "node:child_process";

/** Max harness output bytes kept in memory (1 MiB); beyond that output is
 *  dropped at the tail so a runaway cron can't OOM the CLI. */
const MAX_OUTPUT_BYTES = 1_048_576;

export interface SpawnResult {
  exit: number;
  output: string;
  timedOut: boolean;
}

export interface SpawnOpts {
  cwd: string;
  platform: string;
  timeoutMs: number;
}

/** Windows spawn target for one argv. A .cmd/.bat script cannot be executed
 *  directly (only .exe/.com can); it must go through `cmd.exe /d /s /c` with
 *  exact quoting. .exe/.com spawn directly (Node quotes args itself). */
export interface Win32Spawn {
  command: string;
  args: string[];
  /** Pass args verbatim (we already embedded the quoting) — only for cmd.exe. */
  verbatim: boolean;
}

/** Build the spawn target for one win32 argv. Non-scripts pass through; .cmd/.bat
 *  are wrapped in `cmd.exe /d /s /c ""<script>" <args>""` — the doubled outer
 *  quotes make cmd treat the whole tail as one command line without re-splitting. */
export function win32SpawnTarget(argv: string[]): Win32Spawn {
  const first = argv[0];
  if (!/\.(cmd|bat)$/i.test(first)) {
    return { command: first, args: argv.slice(1), verbatim: false };
  }
  const quoteIf = (a: string): string => (/\s/.test(a) && !/^"/.test(a) ? `"${a}"` : a);
  // script path is always quoted so `cmd /s /c` keeps it as one token
  const cmdline = [`"${first}"`, ...argv.slice(1).map(quoteIf)].join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${cmdline}"`], verbatim: true };
}

/** Spawn `argv` and wait for exit, streaming stdout+stderr (capped at
 *  MAX_OUTPUT_BYTES). Arms a hard kill after `timeoutMs`. Never throws on a
 *  child error — a spawn failure resolves as exit 1 (the caller reports it). */
export async function spawnProcess(argv: string[], opts: SpawnOpts): Promise<SpawnResult> {
  const defaultPath = opts.platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const chunks: Buffer[] = [];
  let bytes = 0;
  const push = (d: Buffer): void => {
    if (bytes >= MAX_OUTPUT_BYTES) return;
    const take = Math.min(d.length, MAX_OUTPUT_BYTES - bytes);
    chunks.push(d.subarray(0, take));
    bytes += take;
  };
  const spawnTarget = opts.platform === "win32"
    ? win32SpawnTarget(argv)
    : { command: argv[0], args: argv.slice(1), verbatim: false };
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: opts.cwd,
    env,
    detached: opts.platform !== "win32",
    windowsVerbatimArguments: spawnTarget.verbatim,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  const started = Date.now();
  const timer = setTimeout(() => {
    if (opts.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } catch { /* ignore */ }
    } else {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    }
  }, opts.timeoutMs);

  const exited = await new Promise<number>((resolveExit) => {
    child.on("error", (e) => { console.error(`jspace: spawn error: ${e.message}`); resolveExit(1); });
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  clearTimeout(timer);
  const timedOut = Date.now() - started > opts.timeoutMs;
  return { exit: exited, output: Buffer.concat(chunks).toString("utf-8"), timedOut };
}
