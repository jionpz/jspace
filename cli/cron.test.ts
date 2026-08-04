// cli/cron.test.ts — pure-function unit tests for the cross-platform cron
// backends (crontab lines, block replacement, schtasks args, binary resolution).
// Run: bun test cli/cron.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  jspaceBinary,
  parseSchedule,
  filehubRoot,
  findPendingApplies,
  cmdCronFailures,
} from "./cron.ts";


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

test("jspaceBinary win32 probes .exe", () => {
  const b = jspaceBinary("win32");
  expect(b.endsWith("bin/jspace") || b.endsWith("bin/jspace.exe")).toBe(true);
  expect(jspaceBinary("darwin").endsWith("bin/jspace")).toBe(true);
  expect(jspaceBinary("linux").endsWith("bin/jspace")).toBe(true);
});

// ---- cron failures (session-start check surface) ----

/** Build a temp workbench (and optional unique filehub) for failure-surface tests.
 *  State is structured: incidents (.jspace/state/incidents) + runs (.jspace/state/runs). */
function makeWorkbench(opts: {
  crons?: string[];
  incidents?: { cron: string; failureClass: string; status?: string }[];
  runs?: Record<string, "ok" | "suspect" | "failed">;
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

  // structured incidents
  for (const inc of opts.incidents ?? []) {
    const dir = join(wb, ".jspace", "state", "incidents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${inc.cron}-${inc.failureClass}.json`),
      JSON.stringify({
        id: `${inc.cron}-${inc.failureClass}`,
        cronId: inc.cron,
        failureClass: inc.failureClass,
        status: inc.status ?? "open",
        openedAt: "2026-08-03T12:00:00",
        evidence: ["run-1"],
      }),
    );
  }
  // structured runs
  for (const [id, status] of Object.entries(opts.runs ?? {})) {
    const dir = join(wb, ".jspace", "state", "runs", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "run-1.json"),
      JSON.stringify({
        id: "run-1",
        cronId: id,
        startedAt: "2026-08-03T12:00:00",
        exit: status === "ok" ? 0 : 1,
        status,
        timedOut: false,
        outputLog: "x",
        batchChanged: true,
      }),
    );
  }
  if (opts.filehub && opts.applies?.length) {
    const dir = join(fh, ".jspace-logs");
    mkdirSync(dir, { recursive: true });
    for (const a of opts.applies) {
      writeFileSync(
        join(dir, `${a}.APPLY.json`),
        JSON.stringify({ version: 1, id: a, idempotencyKey: "a".repeat(64), producer: "test", slug: `assets/${a}`, content: "content", status: "staged", retryCount: 0, createdAt: "2026-08-04T100000" }),
      );
    }
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

test("filehubRoot: unregistered -> null; registered -> primary path", () => {
  const wb = makeWorkbench({});
  expect(filehubRoot(wb)).toBeNull();
  const wb2 = makeWorkbench({ filehub: true });
  expect(filehubRoot(wb2)).toBe(join(wb2, "filehub"));
  rmSync(wb, { recursive: true, force: true });
  rmSync(wb2, { recursive: true, force: true });
});

test("findPendingApplies: empty unless filehub has APPLY.json", () => {
  const wb = makeWorkbench({});
  expect(findPendingApplies(wb)).toEqual({ root: null, paths: [] });
  const wb2 = makeWorkbench({ filehub: true });
  expect(findPendingApplies(wb2)).toEqual({ root: join(wb2, "filehub"), paths: [] });
  rmSync(wb, { recursive: true, force: true });
  rmSync(wb2, { recursive: true, force: true });
});

test("findPendingApplies: lists staged APPLY.json envelopes", () => {
  const wb = makeWorkbench({ filehub: true, applies: ["memory-consolidate-2026-08-03", "weekly-2026-08-03"] });
  const r = findPendingApplies(wb);
  expect(r.root).toBe(join(wb, "filehub"));
  expect(r.paths).toHaveLength(2);
  expect(r.paths[0]).toContain("memory-consolidate");
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: needs attention -> exit 1, JSON has fields", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], incidents: [{ cron: "a", failureClass: "failed" }], runs: { a: "failed", b: "ok" }, filehub: true, applies: ["x"] });
  const { out, exit } = runFailures(wb, true);
  expect(exit).toBe(1);
  const parsed = JSON.parse(out.trim());
  expect(parsed.crons).toHaveLength(2);
  expect(parsed.summary.failures).toBe(1);
  expect(parsed.summary.pending_applies).toBe(1);
  expect(parsed.open_incidents).toBe(1);
  expect(parsed.summary.needs_attention).toBe(2); // open incident + pending
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: clean -> exit 0; never-run not counted", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], runs: { a: "ok" } }); // b never run
  const { out, exit } = runFailures(wb, true);
  expect(exit).toBe(0);
  const parsed = JSON.parse(out.trim());
  expect(parsed.summary.never_run).toBe(1);
  expect(parsed.open_incidents).toBe(0);
  expect(parsed.summary.needs_attention).toBe(0);
  rmSync(wb, { recursive: true, force: true });
});

test("cmdCronFailures: open suspect incident alerts; human output", () => {
  const wb = makeWorkbench({ crons: ["a"], incidents: [{ cron: "a", failureClass: "suspect" }], runs: { a: "suspect" } });
  const { out, exit } = runFailures(wb, false);
  expect(exit).toBe(1);
  expect(out).toContain("open incidents:");
  expect(out).toContain("a [suspect]");
  expect(out).toContain("cron status:");
  expect(out).toContain("a: suspect");
  expect(out).toContain("needs_attention: 1");
  rmSync(wb, { recursive: true, force: true });
});
