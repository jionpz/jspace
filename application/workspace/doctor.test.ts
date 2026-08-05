// application/workspace/doctor.test.ts — `jspace doctor` health surface
// (zero coverage before the review; the most user-facing diagnostics).
// Real loadCrons/parseSchedule against a temp workbench; installed-task detection
// is stubbed (the real one spawns the platform scheduler — never in tests).
// Run: bun test application/workspace/doctor.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorWorkbench, type CronHealthDeps } from "./doctor.ts";
import { loadCrons, parseSchedule } from "../automation/definitions.ts";
import type { CmdResult } from "../commands/command.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-doctor-"));
  mkdirSync(join(root, ".jspace"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "marker.json"),
    JSON.stringify({
      schema_version: 1,
      product: "JSpace",
      workbench_id: "a1b2c3d4-5678-9abc-def0-123456789abc",
      template_version: "1.0.3",
      created_at: "2026-08-05",
    }),
  );
  writeFileSync(join(root, ".jspace", "hub.json"), JSON.stringify({ version: "4", domains: [], resources: [], projects: [] }));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setCrons(crons: { id: string; schedule: string; enabled: boolean }[]): void {
  writeFileSync(
    join(root, ".jspace", "cron.json"),
    JSON.stringify({ version: 1, crons: crons.map((c) => ({ ...c, harness: "claude", prompt: "p" })) }, null, 2),
  );
}

const stubDeps = (over: Partial<CronHealthDeps> = {}): CronHealthDeps => ({
  loadCrons,
  parseSchedule,
  installedCronIds: () => [],
  linuxCronHealth: () => ({ crontab: true, service: true }),
  ...over,
});

function codes(result: CmdResult): string[] {
  const data = result.data as { diagnostics: { code: string }[] };
  return data.diagnostics.map((d) => d.code);
}

test("healthy empty workbench -> exit ok; only structural warnings (local/filehub), no cron diagnostics", () => {
  const r = doctorWorkbench(root, stubDeps());
  expect(r.exitCode ?? 0).toBe(0);
  const c = codes(r);
  expect(c.some((x) => x.startsWith("cron."))).toBe(false); // no cron diagnostics
  expect(c).toContain("filehub.unregistered");
  expect(c).toContain("local.missing");
});

test("enabled cron not installed -> cron.not_installed", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, stubDeps()); // installedCronIds = []
  expect(codes(r)).toContain("cron.not_installed");
});

test("installed task not in cron.json -> cron.stale_task", () => {
  setCrons([{ id: "a", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, stubDeps({ installedCronIds: () => ["a", "old-cron"] }));
  expect(codes(r)).toContain("cron.stale_task");
  expect(codes(r)).not.toContain("cron.not_installed"); // "a" is installed
});

test("invalid schedule -> cron.invalid_schedule; valid cron no warning", () => {
  setCrons([
    { id: "ok", schedule: "0 21 * * *", enabled: true },
    { id: "bad", schedule: "*/5 * * * *", enabled: true },
  ]);
  const r = doctorWorkbench(root, stubDeps({ installedCronIds: () => ["ok", "bad"] }));
  const d = codes(r);
  expect(d).toContain("cron.invalid_schedule");
  expect(d).not.toContain("cron.not_installed"); // both installed
});

test("open incident -> cron.open_incidents", () => {
  mkdirSync(join(root, ".jspace", "state", "incidents"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "incidents", "x-failed.json"),
    JSON.stringify({ id: "x-failed", cronId: "x", failureClass: "failed", status: "open", openedAt: "2026-08-03T12:00:00", evidence: [] }),
  );
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("cron.open_incidents");
});

test("filehub registered with unfiled _inbox -> filehub.inbox_unfiled", () => {
  // register a filehub resource bound to a local dir with one unfiled file
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      version: "4",
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, "_inbox"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "untidy.pdf"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("filehub.inbox_unfiled");
});
