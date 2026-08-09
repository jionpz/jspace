// application/automation/status.test.ts — cron status/failures/check surface
// (moved from cli/cron.test.ts). Asserts on the CmdResult return value instead
// of console.log + process.exitCode.
// Run: bun test application/automation/status.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPendingApplies, cronFailures, cronStatus } from "./status.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";

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
  writeFileSync(join(wb, ".jspace", "hub.json"), JSON.stringify({ schema_version: 1, domains: [{ id: "files", path: "workspace/files" }], resources, projects: [] }));
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
        version: 1,
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
        version: 1,
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

type FailureData = {
  crons: { id: string; status: string }[];
  open_incidents: number;
  summary: { failures: number; suspect: number; never_run: number; pending_applies: number; needs_attention: number };
};

test("filehubRoot resolution: unregistered -> null; registered -> primary path", () => {
  const wb = makeWorkbench({});
  expect(resolveFilehubRoot(wb)).toBeNull();
  const wb2 = makeWorkbench({ filehub: true });
  expect(resolveFilehubRoot(wb2)).toBe(join(wb2, "filehub"));
  rmSync(wb, { recursive: true, force: true });
  rmSync(wb2, { recursive: true, force: true });
});

test("findPendingApplies: empty unless filehub has APPLY.json", () => {
  const wb = makeWorkbench({});
  expect(findPendingApplies(wb)).toEqual({ root: null, paths: [], issues: [] });
  const wb2 = makeWorkbench({ filehub: true });
  expect(findPendingApplies(wb2)).toEqual({ root: join(wb2, "filehub"), paths: [], issues: [] });
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

test("cronFailures: needs attention -> exit 1, data has fields", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], incidents: [{ cron: "a", failureClass: "failed" }], runs: { a: "failed", b: "ok" }, filehub: true, applies: ["x"] });
  const r = cronFailures(wb);
  expect(r.exitCode).toBe(1);
  const data = r.data as FailureData;
  expect(data.crons).toHaveLength(2);
  expect(data.summary.failures).toBe(1);
  expect(data.summary.pending_applies).toBe(1);
  expect(data.open_incidents).toBe(1);
  expect(data.summary.needs_attention).toBe(2); // open incident + pending
  rmSync(wb, { recursive: true, force: true });
});

test("cronFailures: clean -> exit undefined (0); never-run not counted", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], runs: { a: "ok" } }); // b never run
  const r = cronFailures(wb);
  expect(r.exitCode).toBeUndefined();
  const data = r.data as FailureData;
  expect(data.summary.never_run).toBe(1);
  expect(data.open_incidents).toBe(0);
  expect(data.summary.needs_attention).toBe(0);
  rmSync(wb, { recursive: true, force: true });
});

test("cronFailures: open suspect incident alerts; human lines", () => {
  const wb = makeWorkbench({ crons: ["a"], incidents: [{ cron: "a", failureClass: "suspect" }], runs: { a: "suspect" } });
  const r = cronFailures(wb);
  expect(r.exitCode).toBe(1);
  const out = r.lines.join("\n");
  expect(out).toContain("open incidents:");
  expect(out).toContain("a [suspect]");
  expect(out).toContain("cron status:");
  expect(out).toContain("a: suspect");
  expect(out).toContain("needs_attention: 1");
  rmSync(wb, { recursive: true, force: true });
});

test("cronStatus: per-cron last run and never run", () => {
  const wb = makeWorkbench({ crons: ["a", "b"], runs: { a: "ok" } });
  const r = cronStatus(wb);
  expect(r.lines.join("\n")).toContain("a: ok (exit 0,");
  expect(r.lines.join("\n")).toContain("b: never run");
  const one = cronStatus(wb, "a");
  expect(one.lines).toHaveLength(1);
  rmSync(wb, { recursive: true, force: true });
});

test("cronStatus: no crons -> ok line", () => {
  const wb = makeWorkbench({});
  expect(cronStatus(wb).lines).toEqual(["jspace: ok: no crons defined"]);
  rmSync(wb, { recursive: true, force: true });
});

test("cronFailures: damaged run record -> damaged_state diagnostics, warnings, exit 1", () => {
  const wb = makeWorkbench({ crons: ["a"], runs: { a: "ok" } });
  writeFileSync(join(wb, ".jspace", "state", "runs", "a", "run-1.json"), "{ corrupt");
  const r = cronFailures(wb);
  expect(r.exitCode).toBe(1); // damaged state is attention-worthy
  expect(r.warnings?.some((w) => w.includes("run-1.json"))).toBe(true);
  expect(r.lines.join("\n")).toContain("damaged state records: (1)");
  const data = r.data as FailureData & { damaged_state: unknown[]; summary: { damaged_state: number } };
  expect(data.damaged_state).toHaveLength(1);
  expect(data.summary.damaged_state).toBe(1);
  rmSync(wb, { recursive: true, force: true });
});

test("damaged pending envelope (.APPLY.json malformed) -> cron check reports damaged_state (P2-6)", () => {
  const wb = makeWorkbench({ filehub: true, crons: ["x"] });
  const fh = join(wb, "filehub");
  mkdirSync(join(fh, ".jspace-logs"), { recursive: true });
  writeFileSync(join(fh, ".jspace-logs", "corrupt.APPLY.json"), "{ not json", "utf-8");
  const r = cronFailures(wb);
  const d = r.data as FailureData & { damaged_state: { code: string }[] };
  expect(d.damaged_state.some((s) => s.code.includes("APPLY"))).toBe(true);
  expect(r.exitCode).toBe(1); // needs attention
  rmSync(wb, { recursive: true, force: true });
});
