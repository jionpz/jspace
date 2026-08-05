// application/automation/win32-spawn.test.ts — Windows .cmd/.bat spawn-target
// builder (executor must route scripts through cmd.exe, not shell-quote them).
// Real cmd.exe round-trip is CI-verified on the Windows runner (AC9 matrix).
// Run: bun test application/automation/win32-spawn.test.ts
import { expect, test } from "bun:test";
import { win32SpawnTarget } from "./win32-spawn.ts";

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

test(".exe/.com and plain binaries pass through verbatim=false (Node quotes args)", () => {
  const exe = win32SpawnTarget(["C:\\bin\\claude.exe", "-p", "hi there"]);
  expect(exe.command).toBe("C:\\bin\\claude.exe");
  expect(exe.args).toEqual(["-p", "hi there"]);
  expect(exe.verbatim).toBe(false);
  const noExt = win32SpawnTarget(["claude", "-p", "x"]);
  expect(noExt.command).toBe("claude");
  expect(noExt.verbatim).toBe(false);
});
