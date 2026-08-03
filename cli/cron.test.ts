// cli/cron.test.ts — pure-function unit tests for the cross-platform cron
// backends (crontab lines, block replacement, schtasks args, binary resolution).
// Run: bun test cli/cron.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crontabBlock,
  replaceManagedBlock,
  schtasksArgs,
  isWindowsInstallable,
  jspaceBinary,
  parseSchedule,
  readCronFailed,
  lastStatusFor,
  filehubRoot,
  findPendingApplies,
  cmdCronFailures,
} from "./cron.ts";

function cron(id: string, schedule: string, prompt = "test"): Parameters<typeof crontabBlock>[0][number] {
  return { id, schedule, harness: "claude", prompt, enabled: true };
}

test("parseSchedule accepts single values and star", () => {
  expect(parseSchedule("0 21 * * *")).toEqual({ Minute: 0, Hour: 21 });
  expect(parseSchedule("0 21 * * 0")).toEqual({ Minute: 0, Hour: 21, Weekday: 0 });
  expect(parseSchedule("30 8 1 6 *")).toEqual({ Minute: 30, Hour: 8, Day: 1, Month: 6 });
});

test("parseSchedule rejects lists/ranges/steps and DOM+DOW both set", () => {
  expect(() => parseSchedule("*/5 * * * *")).toThrow();
  expect(() => parseSchedule("0 8-9 * * *")).toThrow();
  expect(() => parseSchedule("0 0 1 * 1")).toThrow();
  expect(() => parseSchedule("0 21 * * 8")).toThrow();
});

test("crontabBlock quotes every path and escapes percent", () => {
  const root = "/home/u/my work";
  const block = crontabBlock([cron("inbox-tidy", "0 21 * * *")], root, "/opt/jspace/bin/jspace", "/usr/bin:/bin", "/home/u");
  expect(block).toContain("cd '/home/u/my work'");
  expect(block).toContain("PATH='/usr/bin:/bin'");
  expect(block).toContain("HOME='/home/u'");
  expect(block).toContain("'/opt/jspace/bin/jspace' cron run --dir '/home/u/my work' --id 'inbox-tidy'");
  expect(block.startsWith("# jspace crons (managed) DO NOT EDIT"));
  expect(block.trimEnd().endsWith("# end jspace"));
  // percent in a path is escaped (cronie treats % as newline)
  const pct = crontabBlock([cron("pct", "0 21 * * *")], "/tmp/100%folder", "/bin/jspace", "/bin", "/home");
  expect(pct).toContain("\\%");
});

test("crontabBlock rejects lines over 1000 chars", () => {
  const longRoot = "/x".repeat(1000);
  expect(() => crontabBlock([cron("long", "0 21 * * *")], longRoot, "/bin/jspace", "/bin", "/home")).toThrow();
});

test("replaceManagedBlock: empty input -> block", () => {
  const block = "# jspace crons (managed) DO NOT EDIT\n0 21 * * *  cmd\n# end jspace\n";
  expect(replaceManagedBlock("", block)).toBe(block);
});

test("replaceManagedBlock: replaces old block, keeps user lines", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n# jspace crons (managed) DO NOT EDIT\n0 21 * * *  old\n# end jspace\n0 7 * * *  /usr/bin/other\n";
  const block = "# jspace crons (managed) DO NOT EDIT\n0 22 * * *  new\n# end jspace\n";
  const out = replaceManagedBlock(existing, block);
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 22 * * *  new");
  expect(out).not.toContain("0 21 * * *  old");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
});

test("replaceManagedBlock: no existing block -> appended", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n";
  const block = "# jspace crons (managed) DO NOT EDIT\n0 21 * * *  new\n# end jspace\n";
  const out = replaceManagedBlock(existing, block);
  expect(out.startsWith("0 6 * * *  /usr/bin/backup"));
  expect(out).toContain(block.trim());
});

test("replaceManagedBlock: empty block removes the jspace block", () => {
  const existing = "0 6 * * *  /usr/bin/backup\n# jspace crons (managed) DO NOT EDIT\n0 21 * * *  old\n# end jspace\n0 7 * * *  /usr/bin/other\n";
  const out = replaceManagedBlock(existing, "");
  expect(out).toContain("0 6 * * *  /usr/bin/backup");
  expect(out).toContain("0 7 * * *  /usr/bin/other");
  expect(out).not.toContain("jspace crons");
  expect(out).not.toContain("0 21 * * *  old");
});

test("replaceManagedBlock: malformed markers throw", () => {
  const block = "# jspace crons (managed) DO NOT EDIT\nx\n# end jspace\n";
  expect(() => replaceManagedBlock("# jspace crons (managed) DO NOT EDIT\nx\n", block)).toThrow();
  expect(() => replaceManagedBlock("# end jspace\n", block)).toThrow();
  expect(() => replaceManagedBlock("# jspace crons (managed) DO NOT EDIT\nx\n# end jspace\n# jspace crons (managed) DO NOT EDIT\ny\n# end jspace\n", block)).toThrow();
});

test("schtasksArgs: DAILY and WEEKLY mapping", () => {
  const daily = schtasksArgs(cron("inbox-tidy", "0 21 * * *"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_inbox");
  expect(daily).toContain("/sc"); expect(daily).toContain("DAILY"); expect(daily).toContain("/st"); expect(daily).toContain("21:00");
  expect(daily).toContain("/tn"); expect(daily).toContain("JSpaceCron_wb_inbox");
  expect(daily!.join(" ")).toContain('cron run --dir "C:\\wb" --id inbox-tidy');

  const weekly = schtasksArgs(cron("weekly", "0 21 * * 0"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_weekly");
  expect(weekly).toContain("WEEKLY"); expect(weekly).toContain("/d"); expect(weekly).toContain("SUN");
  // dow=7 also maps to SUN
  const sun7 = schtasksArgs(cron("sun7", "0 21 * * 7"), "C:\\jspace.exe", "C:\\wb", "JSpaceCron_wb_sun7");
  expect(sun7).toContain("SUN");
});

test("schtasksArgs: unsupported schedules -> null", () => {
  expect(schtasksArgs(cron("monthly", "0 0 1 * *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
  expect(schtasksArgs(cron("dom", "0 0 1 6 *"), "C:\\jspace.exe", "C:\\wb", "x")).toBeNull();
});

test("isWindowsInstallable", () => {
  expect(isWindowsInstallable("0 21 * * *")).toBe(true);
  expect(isWindowsInstallable("0 21 * * 0")).toBe(true);
  expect(isWindowsInstallable("0 0 1 * *")).toBe(false);
  expect(isWindowsInstallable("0 0 1 6 *")).toBe(false);
});

test("jspaceBinary win32 probes .exe", () => {
  const b = jspaceBinary("win32");
  expect(b.endsWith("bin/jspace") || b.endsWith("bin/jspace.exe")).toBe(true);
  expect(jspaceBinary("darwin").endsWith("bin/jspace")).toBe(true);
  expect(jspaceBinary("linux").endsWith("bin/jspace")).toBe(true);
});

// ---- cron failures (session-start check surface) ----

/** Build a temp workbench (and optional unique filehub) for failure-surface tests. */
function makeWorkbench(opts: {
  crons?: string[];
  failed?: string[];
  logs?: Record<string, string>;
  filehub?: boolean;
  applies?: string[];
}): string {
  const wb = mkdtempSync(join(tmpdir(), "jspace-fail-"));
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  const fh = join(wb, "filehub"); // per-workbench unique filehub → no cross-test pollution
  const resources: unknown[] = [];
  if (opts.filehub) {
    resources.push({ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] });
  }
  writeFileSync(join(wb, ".jspace", "hub.json"), JSON.stringify({ version: "4", domains: [{ id: "files", path: "workspace/files" }], resources, projects: [] }));
  if (opts.filehub) {
    writeFileSync(join(wb, ".jspace", "local.json"), JSON.stringify({ version: 1, installation_id: "inst", bindings: { "filehub-path": fh } }));
  }
  const crons = (opts.crons ?? []).map((id) => ({ id, schedule: "0 21 * * *", harness: "claude", prompt: "test", enabled: true }));
  writeFileSync(join(wb, ".jspace", "cron.json"), JSON.stringify({ version: 1, crons }));
  if (opts.failed?.length) {
    mkdirSync(join(wb, ".jspace", "logs"), { recursive: true });
    writeFileSync(join(wb, ".jspace", "logs", "cron-failed.md"), opts.failed.map((l) => `- ${l}`).join("\n") + "\n");
  }
  for (const [id, status] of Object.entries(opts.logs ?? {})) {
    const dir = join(wb, ".jspace", "logs", "cron", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "20260803T120000.md"), `status: ${status}\nexit: 0\ntime: 2026-08-03T12:00:00\n`);
  }
  if (opts.filehub && opts.applies?.length) {
    const dir = join(fh, ".jspace-logs");
    mkdirSync(dir, { recursive: true });
    for (const a of opts.applies) writeFileSync(join(dir, a), "gbrain put ...");
  }
  return wb;
}

function runFailures(wb: string, json: boolean): { out: string; exit: number } {
  process.exitCode = 0;
  let out = "";
  const orig = console.log;
  console.log = (s: unknown) => { out += String(s) + "\n"; };
  cmdCronFailures(json, wb);
  console.log = orig;
  const exit = process.exitCode;
  process.exitCode = 0;
  return { out, exit };
}

test("readCronFailed: missing file -> []", () => {
  const wb = makeWorkbench({});
  expect(readCronFailed(wb)).toEqual([]);
  rmSync(wb, { recursive: true, force: true });
});

test("readCronFailed: parses recorded failure lines", () => {
  const wb = makeWorkbench({ failed: ["2026-08-03T120000  inbox-tidy  exit 1  log: a", "2026-08-03T130000  weekly  suspect  log: b"] });
  const lines = readCronFailed(wb);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("inbox-tidy");
  expect(lines[1]).toContain("weekly");
  rmSync(wb, { recursive: true, force: true });
});

test("lastStatusFor: never run -> null; reads recorded status", () => {
  const wb = makeWorkbench({ crons: ["a"], logs: { a: "failed" } });
  expect(lastStatusFor(wb, "a")).toBe("failed");
  expect(lastStatusFor(wb, "never")).toBeNull();
  rmSync(wb, { recursive: true, force: true });
});

test("filehubRoot: unregistered -> null; registered -> primary path", () => {
  const wb = makeWorkbench({});
  expect(filehubRoot(wb)).toBeNull();
  const wb2 = makeWorkbench({ filehub: true });
  expect(filehubRoot(wb2)).toBe(join(wb2, "filehub"));
  rmSync(wb, { recursive: true, force: true });
  rmSync(wb2, { recursive: true, force: true });
});

test("findPendingApplies: empty unless filehub has APPLY.md", () => {
  const wb = makeWorkbench({});
  expect(findPendingApplies(wb)).toEqual({ root: null, paths: [] });
  const wb2 = makeWorkbench({ filehub: true });
  expect(findPendingApplies(wb2)).toEqual({ root: join(wb2, "filehub"), paths: [] });
  rmSync(wb, { recursive: true, force: true });
  rmSync(wb2, { recursive: true, force: true });
});

test("findPendingApplies: lists staged APPLY.md files", () => {
  const wb = makeWorkbench({ filehub: true, applies: ["memory-consolidate-2026-08-03.APPLY.md", "weekly-2026-08-03.APPLY.md"] });
  const r = findPendingApplies(wb);
  expect(r.root).toBe(join(wb, "filehub"));
  expect(r.paths).toHaveLength(2);
  expect(r.paths[0]).toContain("memory-consolidate");
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: needs attention -> exit 1, JSON has fields", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], logs: { a: "failed", b: "ok" }, filehub: true, applies: ["x.APPLY.md"] });
  const { out, exit } = runFailures(wb, true);
  expect(exit).toBe(1);
  const parsed = JSON.parse(out.trim());
  expect(parsed.crons).toHaveLength(2);
  expect(parsed.summary.failed).toBe(1);
  expect(parsed.summary.pending_applies).toBe(1);
  expect(parsed.summary.needs_attention).toBe(2);
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: clean -> exit 0; never-run not counted", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], logs: { a: "ok" } }); // b never run
  const { out, exit } = runFailures(wb, true);
  expect(exit).toBe(0);
  const parsed = JSON.parse(out.trim());
  expect(parsed.summary.never_run).toBe(1);
  expect(parsed.summary.needs_attention).toBe(0);
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: suspect counts as needs attention; human output", () => {
  const wb = makeWorkbench({ crons: ["a"], logs: { a: "suspect" } });
  const { out, exit } = runFailures(wb, false);
  expect(exit).toBe(1);
  expect(out).toContain("cron status:");
  expect(out).toContain("a: suspect");
  expect(out).toContain("needs_attention: 1");
  rmSync(wb, { recursive: true, force: true });
});
