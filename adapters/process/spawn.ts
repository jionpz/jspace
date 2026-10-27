// adapters/process/spawn.ts — OS process spawn adapter.
// Spawns a harness argv (win32 .cmd/.bat routed through cmd.exe), streams
// stdout+stderr (capped), and arms a timeout kill. Returns exit/output/timedOut
// so the application layer never touches child_process directly. This is the
// single place platform process-I/O lives (was application/automation/win32-spawn.ts).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getCapability } from "../harness/registry.ts";

/** Max harness output bytes kept in memory (1 MiB); beyond that output is
 *  dropped at the tail so a runaway cron can't OOM the CLI. */
const MAX_OUTPUT_BYTES = 1_048_576;

/** POSIX: after SIGTERM, how long to wait before SIGKILL. A harness that
 *  registers a SIGTERM handler and keeps running must still die — otherwise the
 *  CLI hangs on child exit, the lock is never released, and ~1h later a second
 *  `cron run` sees the lock as stale and double-runs (issue #8 #5). */
const SIGKILL_GRACE_MS = 3000;
/** win32 timeout path: taskkill itself must not hang and cancel the outer timeout. */
const TASKKILL_TIMEOUT_MS = 5_000;
/** After the kill grace window, wait this much longer for `exit` before the
 *  adapter settles the run itself. A process that never emits `exit` (or a
 *  process tree whose stdio keeps the event loop busy) must not hold the cron
 *  lock open forever. */
const FORCE_RESOLVE_SLACK_MS = 500;
/** Synthetic exit code when the adapter had to settle without a child exit.
 *  124 is the conventional "command timed out" code. */
const SYNTHETIC_TIMEOUT_EXIT = 124;

export interface SpawnResult {
  exit: number;
  output: string;
  /** stdout only (NEW — issue #8 #8: gbrain `get` needs the page body without
   *  stderr noise for dedup hashing). `output` above stays stdout+stderr. */
  stdout: string;
  /** stderr only (NEW). */
  stderr: string;
  /** The timeout timer fired. */
  timedOut: boolean;
  /** The no-output watchdog fired (timeout timer did not). */
  stalled: boolean;
  /** The adapter settled after the kill grace window because `exit` never
   *  arrived; `exit` is the synthetic code above. */
  forced: boolean;
  /** Outcome of the idle-sleep guard (darwin only). Absent on platforms or
   *  call paths that never arm it. "unavailable" means the guard was requested
   *  but the binary was missing — the run proceeded WITHOUT protection, which
   *  the caller must surface rather than treat as success (2026-10-27: cron
   *  runs lost hours of budget to `Sleep Service Back to Sleep` while the
   *  harness waited on a suspended TCP stream). */
  preventSleep?: PreventSleepOutcome;
}

/** "armed" = the guard wrapped the command; "unavailable" = requested but the
 *  helper binary is missing, so the run went ahead unprotected. */
export type PreventSleepOutcome = "armed" | "unavailable";

export interface SpawnOpts {
  cwd: string;
  platform: string;
  timeoutMs: number;
  /** SIGTERM → SIGKILL grace window (default 3000ms). Tests inject a small
   *  value so the SIGKILL path is exercised without waiting. */
  killGraceMs?: number;
  /** Kill when neither stdout nor stderr produces new bytes for this long.
   *  undefined or 0 disables the watchdog. */
  stallMs?: number;
  /** Optional stdin content, written to the child then closed (gbrain put). */
  input?: string;
  /** Child env; defaults to the full process.env. Cron harness spawns pass the
   *  cronSpawnEnv whitelist so a prompt-injected shell can't read every secret. */
  env?: Record<string, string>;
  /** Test seam for process-group signals (defaults to process.kill). A no-op
   *  lets tests exercise the force-settle path without a child that can survive
   *  SIGKILL. */
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  /** Hold an idle-sleep guard for the child's whole lifetime (darwin only).
   *  A headless cron run does unattended model work for up to an hour with no
   *  user present; without the guard the Mac enters `Sleep Service Back to
   *  Sleep` a few seconds after the run starts and the harness's open stream is
   *  suspended, which the run only discovers as a ~960s "Request timed out."
   *  (2026-10-27: three crons lost 1800-3600s budgets this way; the transcript
   *  gaps matched the pmset sleep windows second for second). */
  preventSleep?: boolean;
  /** Test seam: the guard binary (defaults to /usr/bin/caffeinate). */
  preventSleepBin?: string;
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
  // Bun hides HTTP(S)_PROXY etc. from Object.keys(process.env) while still
  // allowing direct reads — so allowKeys must be copied by explicit lookup,
  // not only by enumerating process.env.
  for (const key of allowKeys) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GBRAIN_") || allowPrefixes.some((p) => key.startsWith(p))) {
      out[key] = process.env[key] as string;
    }
  }
  if (out.PATH === undefined) {
    out.PATH = platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  }
  return out;
}

/** Default guard binary: macOS ships it, so the feature costs no dependency. */
const CAFFEINATE_BIN = "/usr/bin/caffeinate";

/** Wrap `argv` so an idle-sleep guard (caffeinate) holds `PreventUserIdleSystemSleep`
 *  for the command's whole lifetime. Returns the argv unchanged plus "unavailable"
 *  when the feature is off, the platform has no guard, or the binary is missing —
 *  the caller must not treat that as a failure, but must not hide it either. */
export function withPreventSleep(
  argv: string[],
  opts: { platform: string; requested?: boolean; exists?: (p: string) => boolean; bin?: string },
): { argv: string[]; outcome?: PreventSleepOutcome } {
  if (!opts.requested) return { argv };
  // -i (idle sleep) is what a headless run needs; it does NOT survive a closed
  // lid, so clamshell cron runs still fail and must be documented as such.
  if (opts.platform !== "darwin") return { argv };
  const bin = opts.bin ?? CAFFEINATE_BIN;
  const exists = opts.exists ?? existsSync;
  if (!exists(bin)) return { argv, outcome: "unavailable" };
  // No `-w <pid>`: the pid does not exist yet, and caffeinate already ties its
  // own lifetime to the command it was given. It forks a helper that becomes a
  // SIBLING in the same process group (verified on macOS 27: spawn()'s pid is
  // the command itself), so the existing `kill(-pgid)` covers the guard on both
  // the SIGTERM and the SIGKILL path — a leftover caffeinate would otherwise
  // keep the machine awake forever.
  return { argv: [bin, "-i", ...argv], outcome: "armed" };
}

/** Spawn `argv` and wait for exit, streaming stdout+stderr (capped at
 *  MAX_OUTPUT_BYTES). Arms a hard kill after `timeoutMs`. Never throws on a
 *  child error — a spawn failure resolves as exit 1 with the error message
 *  appended to the result's stderr (the caller reports it). */
export async function spawnProcess(argv: string[], opts: SpawnOpts): Promise<SpawnResult> {
  const defaultPath = opts.platform === "win32" ? "C:\\Windows\\system32;C:\\Windows" : "/usr/local/bin:/usr/bin:/bin";
  const env = opts.env ?? { ...process.env, PATH: process.env.PATH ?? defaultPath };
  const guarded = withPreventSleep(argv, {
    platform: opts.platform,
    requested: opts.preventSleep,
    bin: opts.preventSleepBin,
  });
  const effectiveArgv = guarded.argv;
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
    ? win32SpawnTarget(effectiveArgv)
    : { command: effectiveArgv[0], args: effectiveArgv.slice(1), verbatim: false };
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

  const killGroup = opts.killGroup ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  let timedOut = false;
  let stalled = false;
  let forced = false;
  let settled = false;
  let resolveExit: ((code: number) => void) | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = (): void => {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    if (killTimer !== undefined) clearTimeout(killTimer);
    if (forceTimer !== undefined) clearTimeout(forceTimer);
  };
  const finish = (code: number): void => {
    if (settled) return;
    settled = true;
    stopTimers();
    resolveExit?.(code);
  };
  /** Terminate once. The first cause (timeout or stall) wins; after the grace
   *  window the adapter force-settles even if the child never emits `exit`. */
  const killTree = (kind: "timeout" | "stall"): void => {
    if (timedOut || stalled) return;
    if (kind === "timeout") timedOut = true;
    else stalled = true;
    // the other cause's timer must not fire a second kill later
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (stallTimer !== undefined) clearTimeout(stallTimer);

    if (child.pid === undefined) {
      finish(1);
      return;
    }
    const graceMs = opts.killGraceMs ?? SIGKILL_GRACE_MS;
    if (opts.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { timeout: TASKKILL_TIMEOUT_MS });
      } catch { /* ignore */ }
    } else {
      try {
        killGroup(-child.pid, "SIGTERM");
        // grace period: a harness that ignores SIGTERM must still die
        killTimer = setTimeout(() => {
          try { killGroup(-child.pid!, "SIGKILL"); } catch {
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
          }
        }, graceMs);
      } catch {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }

    const settleAfter = opts.platform === "win32"
      ? TASKKILL_TIMEOUT_MS + FORCE_RESOLVE_SLACK_MS
      : graceMs + FORCE_RESOLVE_SLACK_MS;
    forceTimer = setTimeout(() => {
      if (settled) return;
      forced = true;
      // A lingering process tree must not keep the adapter (and its pipes)
      // alive after we have decided the run is over.
      try { child.stdout?.destroy(); } catch { /* ignore */ }
      try { child.stderr?.destroy(); } catch { /* ignore */ }
      try { child.unref(); } catch { /* ignore */ }
      finish(SYNTHETIC_TIMEOUT_EXIT);
    }, settleAfter);
  };
  const armStall = (): void => {
    if (opts.stallMs === undefined || opts.stallMs <= 0) return;
    // A stream can flush data after `exit`/force-settle; re-arming then would
    // leave a timer that keeps the CLI alive for the whole stall window.
    if (settled || timedOut || stalled) return;
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => killTree("stall"), opts.stallMs);
  };

  child.stdout?.on("data", (d: Buffer) => { pushOut(d); armStall(); });
  child.stderr?.on("data", (d: Buffer) => { pushErr(d); armStall(); });
  armStall();
  timeoutTimer = setTimeout(() => killTree("timeout"), opts.timeoutMs);

  const exited = await new Promise<number>((resolve) => {
    resolveExit = resolve;
    // Spawn failure (e.g. executable not in PATH) routes into the RESULT's
    // stderr, not this process's stderr: callers that report failures (cron
    // run log, gbrain put/list error field) still get the message, while an
    // expected state — gbrain not yet installed when a session-start hook
    // probes it — no longer prints noise at the top of every session.
    child.on("error", (e) => { pushErr(Buffer.from(`jspace: spawn error: ${e.message}\n`)); finish(1); });
    child.on("exit", (code) => finish(code ?? 1));
  });
  stopTimers();
  // timedOut is the timer's own flag, not a wall-clock comparison — a child
  // that exits normally just after the deadline is not mislabeled (issue #8 #5).
  const stdout = Buffer.concat(outChunks).toString("utf-8");
  const stderr = Buffer.concat(errChunks).toString("utf-8");
  return {
    exit: exited,
    output: `${stdout}${stderr}`,
    stdout,
    stderr,
    timedOut,
    stalled,
    forced,
    ...(guarded.outcome !== undefined ? { preventSleep: guarded.outcome } : {}),
  };
}
