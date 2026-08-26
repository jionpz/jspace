// adapters/process/spawn.ts — OS process spawn adapter.
// Spawns a harness argv (win32 .cmd/.bat routed through cmd.exe), streams
// stdout+stderr (capped), and arms a timeout kill. Returns exit/output/timedOut
// so the application layer never touches child_process directly. This is the
// single place platform process-I/O lives (was application/automation/win32-spawn.ts).
import { spawn, spawnSync } from "node:child_process";
import { getCapability } from "../harness/registry.ts";

/** Max harness output bytes kept in memory (1 MiB); beyond that output is
 *  dropped at the tail so a runaway cron can't OOM the CLI. */
const MAX_OUTPUT_BYTES = 1_048_576;

/** POSIX: after SIGTERM, how long to wait before SIGKILL. A harness that
 *  registers a SIGTERM handler and keeps running must still die — otherwise the
 *  CLI hangs on child exit, the lock is never released, and ~1h later a second
 *  `cron run` sees the lock as stale and double-runs (issue #8 #5). */
const SIGKILL_GRACE_MS = 3000;

export interface SpawnResult {
  exit: number;
  output: string;
  /** stdout only (NEW — issue #8 #8: gbrain `get` needs the page body without
   *  stderr noise for dedup hashing). `output` above stays stdout+stderr. */
  stdout: string;
  /** stderr only (NEW). */
  stderr: string;
  timedOut: boolean;
}

export interface SpawnOpts {
  cwd: string;
  platform: string;
  timeoutMs: number;
  /** SIGTERM → SIGKILL grace window (default 3000ms). Tests inject a small
   *  value so the SIGKILL path is exercised without waiting. */
  killGraceMs?: number;
  /** Optional stdin content, written to the child then closed (gbrain put). */
  input?: string;
  /** Child env; defaults to the full process.env. Cron harness spawns pass the
   *  cronSpawnEnv whitelist so a prompt-injected shell can't read every secret. */
  env?: Record<string, string>;
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

/** Escape one argv element for a cmd.exe command line (.cmd/.bat target). cmd
 *  metacharacters (& | < > ^ % !) are command operators at the top level, so an
 *  arg containing any of them — or whitespace, or a quote — is wrapped in double
 *  quotes, where cmd treats them as literals; embedded `"` are doubled (cmd's
 *  quoted-string escape). Without this a cron prompt like `hello&calc.exe` is
 *  executed by cmd, never reaching the model (issue #8 #3). */
function cmdEscapeArg(a: string): string {
  if (!/[\s&|<>^%!"]/.test(a)) return a;
  // `%VAR%` still expands inside double quotes on a cmd /c command line (unlike
  // the other metacharacters), so `%` needs an explicit `^` escape to stay
  // literal — a cron prompt containing `%PATH%` must reach the model verbatim.
  return `"${a.replace(/"/g, `""`).replace(/%/g, "^%")}"`;
}

/** Build the spawn target for one win32 argv. Non-scripts pass through; .cmd/.bat
 *  are wrapped in `cmd.exe /d /s /c ""<script>" <args>""` — the doubled outer
 *  quotes make cmd treat the whole tail as one command line without re-splitting. */
export function win32SpawnTarget(argv: string[]): Win32Spawn {
  const first = argv[0];
  if (!/\.(cmd|bat)$/i.test(first)) {
    return { command: first, args: argv.slice(1), verbatim: false };
  }
  // script path is always quoted so `cmd /s /c` keeps it as one token; every
  // arg is cmd-escaped (metacharacters neutralized by quoting)
  const cmdline = [`"${first}"`, ...argv.slice(1).map(cmdEscapeArg)].join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${cmdline}"`], verbatim: true };
}

/** Base env keys every headless cron child needs regardless of harness. */
const CRON_ENV_BASE_KEYS = [
  "PATH", "HOME", "TERM", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL", "TMPDIR", "NO_COLOR", "CLICOLOR", "BUN_INSTALL",
  // Corporate / local proxies — not secrets; required when ANTHROPIC_BASE_URL
  // (or other harness endpoints) sit behind HTTP(S)_PROXY.
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
] as const;

const CRON_ENV_WIN32_KEYS = [
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP",
] as const;

/** Env whitelist for a headless cron child (H1/B6). A scheduled, unattended LLM
 *  has a shell: passing it `{...process.env}` exposes every machine secret to a
 *  prompt-injected cron. Whitelist only what the harness needs to authenticate
 *  and what gbrain needs — cross-vendor API keys and NODE_OPTIONS are withheld
 *  unless the harness capability explicitly allows them. */
export function cronSpawnEnv(platform: string, harness: string): Record<string, string> {
  const cap = getCapability(harness);
  const allowKeys = new Set<string>([
    ...CRON_ENV_BASE_KEYS,
    ...(platform === "win32" ? CRON_ENV_WIN32_KEYS : []),
    ...(cap.cron_env.allow_keys ?? []),
  ]);
  const allowPrefixes = [...cap.cron_env.allow_prefixes];
  const out: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GBRAIN_") || allowKeys.has(key) || allowPrefixes.some((p) => key.startsWith(p))) {
      out[key] = process.env[key] as string;
    }
  }
  if (out.PATH === undefined) {
    out.PATH = platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  }
  return out;
}

/** Spawn `argv` and wait for exit, streaming stdout+stderr (capped at
 *  MAX_OUTPUT_BYTES). Arms a hard kill after `timeoutMs`. Never throws on a
 *  child error — a spawn failure resolves as exit 1 (the caller reports it). */
export async function spawnProcess(argv: string[], opts: SpawnOpts): Promise<SpawnResult> {
  const defaultPath = opts.platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = opts.env ?? { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  const cappedPush = (bufs: Buffer[], bytes: number, d: Buffer): number => {
    if (bytes >= MAX_OUTPUT_BYTES) return bytes;
    const take = Math.min(d.length, MAX_OUTPUT_BYTES - bytes);
    bufs.push(d.subarray(0, take));
    return bytes + take;
  };
  const pushOut = (d: Buffer): void => { outBytes = cappedPush(outChunks, outBytes, d); };
  const pushErr = (d: Buffer): void => { errBytes = cappedPush(errChunks, errBytes, d); };
  const spawnTarget = opts.platform === "win32"
    ? win32SpawnTarget(argv)
    : { command: argv[0], args: argv.slice(1), verbatim: false };
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: opts.cwd,
    env,
    detached: opts.platform !== "win32",
    windowsVerbatimArguments: spawnTarget.verbatim,
    stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
  });
  if (opts.input !== undefined && child.stdin) {
    child.stdin.write(opts.input);
    child.stdin.end();
  }
  child.stdout?.on("data", pushOut);
  child.stderr?.on("data", pushErr);
  let killed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    killed = true;
    if (opts.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } catch { /* ignore */ }
    } else {
      try {
        process.kill(-child.pid!, "SIGTERM");
        // grace period: a harness that ignores SIGTERM must still die
        killTimer = setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
        }, opts.killGraceMs ?? SIGKILL_GRACE_MS);
      } catch {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }
  }, opts.timeoutMs);

  const exited = await new Promise<number>((resolveExit) => {
    child.on("error", (e) => { console.error(`jspace: spawn error: ${e.message}`); resolveExit(1); });
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  clearTimeout(timer);
  if (killTimer !== undefined) clearTimeout(killTimer);
  // timedOut is the timer's own flag, not a wall-clock comparison — a child
  // that exits normally just after the deadline is not mislabeled (issue #8 #5).
  const timedOut = killed;
  const stdout = Buffer.concat(outChunks).toString("utf-8");
  const stderr = Buffer.concat(errChunks).toString("utf-8");
  return { exit: exited, output: `${stdout}${stderr}`, stdout, stderr, timedOut };
}
