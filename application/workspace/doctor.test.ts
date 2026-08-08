// application/workspace/doctor.test.ts — `jspace doctor` health surface
// (zero coverage before the review; the most user-facing diagnostics).
// Real loadCrons/parseSchedule against a temp workbench; installed-task detection
// is stubbed (the real one spawns the platform scheduler — never in tests).
// Run: bun test application/workspace/doctor.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorWorkbench, type CronHealthDeps } from "./doctor.ts";
import { loadCrons, parseSchedule } from "../automation/definitions.ts";
import { sha256Of } from "./manifest.ts";
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
  officialSkillNames: () => ["jspace-use", "asset-ingest", "memory-recall", "memory-writeback"],
  ...over,
});

function codes(result: CmdResult): string[] {
  const data = result.data as { diagnostics: { code: string }[] };
  return data.diagnostics.map((d) => d.code);
}

test("healthy empty workbench -> exit ok; filehub.unregistered is info, local.missing warning, no cron diagnostics", () => {
  const r = doctorWorkbench(root, stubDeps());
  expect(r.exitCode ?? 0).toBe(0);
  const c = codes(r);
  expect(c.some((x) => x.startsWith("cron."))).toBe(false); // no cron diagnostics
  expect(c).toContain("filehub.unregistered");
  expect(c).toContain("local.missing");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "filehub.unregistered")?.severity).toBe("info");
  // info diagnostics never count as warnings (local.missing still is one)
  expect((r.warnings ?? []).join("\n")).not.toContain("filehub");
});

test("disabled cron (template default) not installed -> no cron.not_installed", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: false }]);
  const r = doctorWorkbench(root, stubDeps()); // installedCronIds = []
  expect(codes(r)).not.toContain("cron.not_installed");
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
    JSON.stringify({ version: 1, id: "x-failed", cronId: "x", failureClass: "failed", status: "open", openedAt: "2026-08-03T12:00:00", evidence: [] }),
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

test("orphan skill dir without journal record -> skills.orphan_dir", () => {
  // a pre-journal leftover (e.g. old jspace-bootstrap dir) with no journal base
  mkdirSync(join(root, ".jspace", "skills", "jspace-bootstrap"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "jspace-bootstrap", "SKILL.md"), "old skill");
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("skills.orphan_dir");
});

test("official skill dir -> no skills.orphan_dir", () => {
  mkdirSync(join(root, ".jspace", "skills", "asset-ingest"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "SKILL.md"), "x");
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).not.toContain("skills.orphan_dir");
});

test("orphan skill dir with a journal record -> no skills.orphan_dir (upgrade owns it)", () => {
  mkdirSync(join(root, ".jspace", "skills", "jspace-bootstrap"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "jspace-bootstrap", "SKILL.md"), "old skill");
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "materialized.json"),
    JSON.stringify({
      version: 1,
      asset_version: "1.0.6",
      applied_at: "2026-08-05",
      files: { ".jspace/skills/jspace-bootstrap/SKILL.md": { sha256: sha256Of("old skill") } },
    }) + "\n",
  );
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).not.toContain("skills.orphan_dir");
});

test("missing CLAUDE.md -> claude.pointer_missing; importing CLAUDE.md -> no diagnostic", () => {
  // no CLAUDE.md on the fresh workbench
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("claude.pointer_missing");

  // a CLAUDE.md that imports @AGENTS.md silences it
  writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).not.toContain("claude.pointer_missing");

  // a CLAUDE.md present but not importing is still broken
  writeFileSync(join(root, "CLAUDE.md"), "# notes\n");
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("claude.pointer_missing");

  // @./AGENTS.md (relative import form) is also a valid pointer
  writeFileSync(join(root, "CLAUDE.md"), "@./AGENTS.md\n");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("claude.pointer_missing");
});

test("harness projection drift -> skills.projection_drift", () => {
  mkdirSync(join(root, ".jspace", "skills", "asset-ingest", "scripts"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills", "asset-ingest", "scripts"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "SKILL.md"), "identical");
  writeFileSync(join(root, ".claude", "skills", "asset-ingest", "SKILL.md"), "identical");
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
  writeFileSync(join(root, ".claude", "skills", "asset-ingest", "scripts", "extract.py"), "v2"); // drifted copy
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("skills.projection_drift");

  // reconcile -> diagnostic clears
  writeFileSync(join(root, ".claude", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("skills.projection_drift");
});

test("file present only in the projection -> skills.projection_drift", () => {
  mkdirSync(join(root, ".jspace", "skills", "jspace-use"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills", "jspace-use"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "jspace-use", "SKILL.md"), "identical");
  writeFileSync(join(root, ".claude", "skills", "jspace-use", "SKILL.md"), "identical");
  // a file only in the projection copy is drift too (copies must be identical)
  writeFileSync(join(root, ".claude", "skills", "jspace-use", "EXTRA.md"), "stale-only-copy");
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("skills.projection_drift");

  // removing it reconciles
  unlinkSync(join(root, ".claude", "skills", "jspace-use", "EXTRA.md"));
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("skills.projection_drift");
});

test("legacy official copy in root skills/ -> skills.legacy_root_copy; user skills untouched", () => {
  mkdirSync(join(root, "skills", "jspace-use"), { recursive: true });
  mkdirSync(join(root, "skills", "my-user-skill"), { recursive: true });
  writeFileSync(join(root, "skills", "jspace-use", "SKILL.md"), "legacy official");
  writeFileSync(join(root, "skills", "my-user-skill", "SKILL.md"), "user's own");
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).toContain("skills.legacy_root_copy");
  expect(c).not.toContain("skills.orphan_dir"); // user skill in root is never flagged as orphan
});

test("pre-rename legacy copy (jspace-bootstrap) -> skills.legacy_root_copy", () => {
  // jspace-bootstrap was the official name before v1.0.9 renamed it to
  // jspace-use; a leftover under the old name must still be surfaced.
  mkdirSync(join(root, "skills", "jspace-bootstrap"), { recursive: true });
  writeFileSync(join(root, "skills", "jspace-bootstrap", "SKILL.md"), "old skill");
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).toContain("skills.legacy_root_copy");
  expect(c).not.toContain("skills.orphan_dir");
});

test("projection wholly missing but was materialized -> skills.projection_drift", () => {
  // source exists, projection dir gone entirely, journal records it was applied
  mkdirSync(join(root, ".jspace", "skills", "jspace-use"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "jspace-use", "SKILL.md"), "source");
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "materialized.json"),
    JSON.stringify({
      version: 1,
      asset_version: "1.0.9",
      applied_at: "2026-08-06",
      files: { ".claude/skills/jspace-use/SKILL.md": { sha256: "x" } },
    }) + "\n",
  );
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("skills.projection_drift");
});

test("projection never materialized -> no skills.projection_drift (upgrade pending)", () => {
  // pre-projection template workbench: no journal record, no .claude/skills dir
  mkdirSync(join(root, ".jspace", "skills", "jspace-use"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "jspace-use", "SKILL.md"), "source");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("skills.projection_drift");
});

test("__pycache__ bytecode in one copy -> no skills.projection_drift", () => {
  mkdirSync(join(root, ".jspace", "skills", "asset-ingest", "scripts", "__pycache__"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills", "asset-ingest", "scripts"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
  writeFileSync(join(root, ".claude", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
  // python writes a pyc into only the executed copy at runtime
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "scripts", "__pycache__", "extract.cpython-312.pyc"), "bc");
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).not.toContain("skills.projection_drift");
});

