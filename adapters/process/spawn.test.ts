// application/automation/win32-spawn.test.ts — Windows .cmd/.bat spawn-target
// builder (executor must route scripts through cmd.exe, not shell-quote them).
// Real cmd.exe round-trip is CI-verified on the Windows runner.
// Run: bun test application/automation/win32-spawn.test.ts
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnProcess, win32SpawnTarget, cronSpawnEnv, withPreventSleep } from "./spawn.ts";

test(".cmd script -> cmd.exe /d /s /c, doubled-quoted tail, verbatim", () => {
  const t = win32SpawnTarget(["C:\\bin\\claude.cmd", "-p", "prompt", "--allowedTools", "Bash,Read"]);
  expect(t.command).toBe("cmd.exe");
  expect(t.verbatim).toBe(true);
  expect(t.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
  expect(t.args[3]).toBe('""C:\\bin\\claude.cmd" -p prompt --allowedTools Bash,Read"');
});

test(".cmd with a spaced prompt -> that arg is quoted inside the tail", () => {
  const t = win32SpawnTarget(["claude.cmd", "-p", "tidy the inbox"]);
  expect(t.args[3]).toBe('""claude.cmd" -p "tidy the inbox""');
});

test(".bat script -> same cmd.exe wrapping", () => {
  const t = win32SpawnTarget(["C:\\tools\\run.bat", "arg"]);
  expect(t.command).toBe("cmd.exe");
  expect(t.verbatim).toBe(true);
  expect(t.args[3]).toBe('""C:\\tools\\run.bat" arg"');
});

test(".cmd arg with cmd metacharacters is quoted (no cmd injection, issue #8 #3)", () => {
  // `hello&whoami` without quoting would make cmd run whoami after hello — the
  // injected command never reaches the model.
  const t = win32SpawnTarget(["claude.cmd", "-p", "hello&whoami"]);
  expect(t.args[3]).toBe('""claude.cmd" -p "hello&whoami""');
  const redir = win32SpawnTarget(["claude.cmd", "-p", "sum > out.txt"]);
  expect(redir.args[3]).toContain('"sum > out.txt"');
});

test(".cmd arg with embedded quote is doubled inside the quoted arg (issue #8 #3)", () => {
  const t = win32SpawnTarget(["claude.cmd", "-p", '" & whoami']);
  // embedded " -> "" ; the whole arg is then wrapped in quotes
  expect(t.args[3]).toContain('""" & whoami"');
  expect(t.args[3]).not.toContain('-p " & whoami"'); // raw (injectable) form must not appear
});

test(".cmd arg with % is caret-escaped so %VAR% stays literal", () => {
  // `%PATH%` expands even inside double quotes on a cmd /c command line; the
  // ^ escape keeps the prompt verbatim instead of substituting an env value.
  const t = win32SpawnTarget(["claude.cmd", "-p", "echo %PATH%"]);
  expect(t.args[3]).toContain('"echo ^%PATH^%"');
  expect(t.args[3]).not.toContain('"echo %PATH%"');
});

test("cronSpawnEnv whitelists harness/gbrain vars and withholds other secrets", () => {
  const saved = { ...process.env };
  try {
    process.env.AWS_SECRET_ACCESS_KEY = "topsecret";
    process.env.ANTHROPIC_API_KEY = "sk-harness";
    process.env.ANTHROPIC_BASE_URL = "https://proxy.example";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-token";
    process.env.HTTPS_PROXY = "http://proxy:8080";
    process.env.OPENAI_API_KEY = "sk-other";
    process.env.NODE_OPTIONS = "--inspect";
    process.env.GBRAIN_TEST_HOME = "/t/gbrain";
    const env = cronSpawnEnv("linux", "claude");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-harness");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token");
    expect(env.HTTPS_PROXY).toBe("http://proxy:8080");
    expect(env.GBRAIN_TEST_HOME).toBe("/t/gbrain");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBeDefined();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("cronSpawnEnv for grok allows GROK_/XAI_ only, not ANTHROPIC_", () => {
  const saved = { ...process.env };
  try {
    process.env.ANTHROPIC_API_KEY = "sk-claude";
    process.env.GROK_API_KEY = "sk-grok";
    process.env.XAI_API_KEY = "sk-xai";
    const env = cronSpawnEnv("linux", "grok");
    expect(env.GROK_API_KEY).toBe("sk-grok");
    expect(env.XAI_API_KEY).toBe("sk-xai");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test(".exe/.com and plain binaries pass through verbatim=false (Node quotes args)", () => {
  const exe = win32SpawnTarget(["C:\\bin\\claude.exe", "-p", "hi there"]);
  expect(exe.command).toBe("C:\\bin\\claude.exe");
  expect(exe.args).toEqual(["-p", "hi there"]);
  expect(exe.verbatim).toBe(false);
  const noExt = win32SpawnTarget(["claude", "-p", "x"]);
  expect(noExt.command).toBe("claude");
  expect(noExt.verbatim).toBe(false);
});

// ---- #5: timeout must SIGKILL a harness that ignores SIGTERM (else the CLI
// hangs on child exit → lock never released → double-run after the stale
// window), and timedOut must be the timer's own flag, not a wall-clock race.
// POSIX process-group signals only — win32 uses taskkill /F (already forced).

test.skipIf(process.platform === "win32")("ignore-SIGTERM harness is SIGKILLed after the grace window (timedOut=true, no hang)", async () => {
  // win32 skip: process-group SIGTERM/SIGKILL is POSIX-only (win32 uses taskkill /F).
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  const script = join(dir, "ignore-term.sh");
  writeFileSync(script, "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done\n");
  chmodSync(script, 0o755);
  try {
    const started = Date.now();
    const res = await spawnProcess(["/bin/sh", script], { cwd: dir, platform: "linux", timeoutMs: 200, killGraceMs: 150 });
    const elapsed = Date.now() - started;
    expect(res.timedOut).toBe(true); // the timer did fire
    expect(res.exit).not.toBe(0); // SIGKILLed, not a clean exit
    expect(elapsed).toBeLessThan(3000); // did not hang waiting for a TERM-ignoring child
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("normal quick exit before timeout -> timedOut=false, exit 0", async () => {
  // win32 skip: fixture is a /bin/sh script made executable (POSIX-only).
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  const script = join(dir, "quick.sh");
  writeFileSync(script, "#!/bin/sh\nexit 0\n");
  chmodSync(script, 0o755);
  try {
    const res = await spawnProcess(["/bin/sh", script], { cwd: dir, platform: "linux", timeoutMs: 5000, killGraceMs: 150 });
    expect(res.timedOut).toBe(false);
    expect(res.exit).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- issue #8 #8: spawnProcess stdin input + stdout/stderr separation (gbrain
// put needs stdin; get needs stdout without stderr noise for dedup hashing). ----

test.skipIf(process.platform === "win32")("spawnProcess feeds stdin input (gbrain put path)", async () => {
  // win32 skip: fixture drives /bin/sh -c cat (POSIX-only).
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  try {
    const res = await spawnProcess(["/bin/sh", "-c", "cat"], { cwd: dir, platform: "linux", timeoutMs: 5000, input: "hello stdin\n" });
    expect(res.exit).toBe(0);
    expect(res.stdout).toContain("hello stdin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("spawnProcess separates stdout from stderr", async () => {
  // win32 skip: fixture drives /bin/sh -c (POSIX-only).
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  try {
    const res = await spawnProcess(["/bin/sh", "-c", "echo out; echo err >&2"], { cwd: dir, platform: "linux", timeoutMs: 5000 });
    expect(res.stdout).toBe("out\n");
    expect(res.stderr).toBe("err\n");
    expect(res.output).toContain("out");
    expect(res.output).toContain("err");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("missing executable -> exit 1 with the error in RESULT stderr, nothing on process stderr", async () => {
  // win32 skip: asserts the POSIX ENOENT spawn-error path explicitly (platform: "linux").
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  const errWrite = process.stderr.write.bind(process.stderr);
  let leaked = "";
  // capture anything the adapter would print directly (the old console.error
  // path put "spawn error" noise at the top of every session when gbrain was
  // not installed yet — an expected pre-first-use state)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    leaked += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    return true;
  }) as typeof process.stderr.write;
  try {
    const res = await spawnProcess(["definitely-not-a-real-executable-jspace"], { cwd: dir, platform: "linux", timeoutMs: 5000 });
    expect(res.exit).toBe(1);
    expect(res.timedOut).toBe(false);
    expect(res.stderr).toContain("jspace: spawn error:");
    expect(res.output).toContain("jspace: spawn error:");
    expect(leaked).not.toContain("spawn error");
  } finally {
    process.stderr.write = errWrite;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- no-output watchdog + final settle ----

test.skipIf(process.platform === "win32")("no-output watchdog kills a silently stalled harness (stalled=true, timeout not reached)", async () => {
  // win32 skip: fixture is a /bin/sh script and the watchdog kill path is POSIX process-group signals.
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  const script = join(dir, "silent.sh");
  writeFileSync(script, "#!/bin/sh\nsleep 30\n");
  chmodSync(script, 0o755);
  try {
    const started = Date.now();
    const res = await spawnProcess(["/bin/sh", script], { cwd: dir, platform: "linux", timeoutMs: 5000, stallMs: 150, killGraceMs: 100 });
    expect(res.stalled).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(res.exit).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("output resets the stall watchdog (a chatty long run is not killed)", async () => {
  // win32 skip: fixture drives /bin/sh -c (POSIX-only).
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  try {
    const res = await spawnProcess(
      ["/bin/sh", "-c", "for i in 1 2 3 4 5; do echo tick; sleep 0.1; done; exit 0"],
      { cwd: dir, platform: "linux", timeoutMs: 5000, stallMs: 400, killGraceMs: 100 },
    );
    expect(res.stalled).toBe(false);
    expect(res.timedOut).toBe(false);
    expect(res.exit).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("force settle: a child that never exits is resolved after the kill grace (forced=true)", async () => {
  // win32 skip: POSIX process-group path; killGroup is injected so the child
  // survives the signal and only the adapter's final settle can end the run.
  const dir = mkdtempSync(join(tmpdir(), "jspace-spawn-"));
  const script = join(dir, "survive.sh");
  writeFileSync(script, "#!/bin/sh\nsleep 1\n");
  chmodSync(script, 0o755);
  try {
    const started = Date.now();
    const res = await spawnProcess(["/bin/sh", script], {
      cwd: dir,
      platform: "linux",
      timeoutMs: 100,
      killGraceMs: 100,
      killGroup: () => { /* no-op: simulate a process that never emits exit */ },
    });
    expect(res.timedOut).toBe(true);
    expect(res.forced).toBe(true);
    expect(res.exit).toBe(124);
    expect(Date.now() - started).toBeLessThan(2500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- idle-sleep guard (2026-10-27) ------------------------------------------
// Three scheduled crons lost 1800-3600s budgets to macOS re-entering sleep
// seconds after launchd's dark wake; the harness saw only a suspended stream.

test("withPreventSleep wraps a darwin argv with caffeinate -i", () => {
  const r = withPreventSleep(["claude", "-p", "hi"], {
    platform: "darwin", requested: true, exists: () => true, bin: "/usr/bin/caffeinate",
  });
  expect(r.outcome).toBe("armed");
  expect(r.argv).toEqual(["/usr/bin/caffeinate", "-i", "claude", "-p", "hi"]);
});

test("withPreventSleep leaves argv untouched when not requested (preventSleep: false)", () => {
  const argv = ["claude", "-p", "hi"];
  const r = withPreventSleep(argv, { platform: "darwin", requested: false, exists: () => true });
  expect(r.argv).toEqual(argv);
  expect(r.outcome).toBeUndefined();
});

test("withPreventSleep is a no-op off darwin (no caffeinate on linux/win32)", () => {
  const argv = ["claude", "-p", "hi"];
  for (const platform of ["linux", "win32"]) {
    const r = withPreventSleep(argv, { platform, requested: true, exists: () => true });
    expect(r.argv).toEqual(argv);
    expect(r.outcome).toBeUndefined();
  }
});

test("withPreventSleep degrades visibly when the guard binary is missing", () => {
  // Must not throw and must not pretend it protected the run: cron would
  // otherwise report a normal-looking run that actually had no protection.
  const argv = ["claude", "-p", "hi"];
  const r = withPreventSleep(argv, { platform: "darwin", requested: true, exists: () => false });
  expect(r.argv).toEqual(argv);
  expect(r.outcome).toBe("unavailable");
});

test.skipIf(process.platform !== "darwin")("guarded spawn exits normally and reports armed", async () => {
  const r = await spawnProcess(["/bin/sh", "-c", "echo hello; exit 0"], {
    cwd: tmpdir(), platform: "darwin", timeoutMs: 10_000, preventSleep: true,
  });
  expect(r.exit).toBe(0);
  expect(r.stdout).toContain("hello");
  expect(r.preventSleep).toBe("armed");
  expect(r.timedOut).toBe(false);
});

test.skipIf(process.platform !== "darwin")("guarded process-group kill also reaps the caffeinate helper", async () => {
  // The guard forks a helper that becomes a SIBLING in the same process group.
  // A leftover helper would hold PreventUserIdleSystemSleep forever, so the
  // timeout path must kill the whole group (it does, via kill(-pgid)).
  const r = await spawnProcess(["/bin/sh", "-c", "trap '' TERM; sleep 30"], {
    cwd: tmpdir(), platform: "darwin", timeoutMs: 300, killGraceMs: 100, preventSleep: true,
  });
  expect(r.timedOut).toBe(true);
  // No assertion survives the run: ask pmset what is still holding the wake lock.
  const leftover = Bun.spawnSync(["bash", "-lc", "pmset -g assertions | grep -c caffeinate || true"]);
  expect(leftover.stdout.toString().trim()).toBe("0");
});
