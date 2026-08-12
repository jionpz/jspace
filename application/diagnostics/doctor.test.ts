// application/workspace/doctor.test.ts — `jspace doctor` health surface
// (zero coverage before the review; the most user-facing diagnostics).
// Real loadCrons/parseSchedule against a temp workbench; installed-task detection
// is stubbed (the real one spawns the platform scheduler — never in tests).
// Run: bun test application/workspace/doctor.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorWorkbench, type CronHealthDeps, type CronLike } from "./doctor.ts";
import { loadCrons, parseSchedule } from "../automation/definitions.ts";
import { sha256Of } from "../workspace/manifest.ts";
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
  writeFileSync(join(root, ".jspace", "hub.json"), JSON.stringify({ schema_version: 1, domains: [], resources: [], projects: [] }));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setCrons(crons: { id: string; schedule: string; enabled: boolean }[]): void {
  writeFileSync(
    join(root, ".jspace", "cron.json"),
    JSON.stringify({ schema_version: 1, crons: crons.map((c) => ({ ...c, harness: "claude", prompt: "p" })) }, null, 2),
  );
}

const stubDeps = (over: Partial<CronHealthDeps> = {}): CronHealthDeps => ({
  loadCrons,
  parseSchedule,
  installedCronIds: () => [],
  linuxCronHealth: () => ({ crontab: "ok", service: "ok" }),
  officialSkillNames: () => ["jspace-use", "asset-ingest", "memory-recall", "memory-writeback"],
  // deterministic: the test workbenches schedule claude, but the CI runner may
  // not have the claude binary — stub bin presence so harness checks are stable.
  harnessBinOnPath: () => true,
  // no machine harness config is read unless a test injects one (issue #8 #16)
  readHarnessConfig: () => null,
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

// ---- linux cron health tri-state (issue #10) --------------------------------
// doctor only runs the linux crontab/daemon health branch when
// process.platform === "linux"; force it so these cases run on any host.
function withLinuxPlatform(fn: () => CmdResult): CmdResult {
  const orig = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  try {
    return fn();
  } finally {
    if (orig) Object.defineProperty(process, "platform", orig);
    else delete (process as { platform?: string }).platform;
  }
}

test("unverifiable service (sandbox hides host daemon) -> info, no daemon_stopped", () => {
  const r = withLinuxPlatform(() =>
    doctorWorkbench(root, stubDeps({ linuxCronHealth: () => ({ crontab: "ok", service: "unverifiable" }) })),
  );
  expect(codes(r)).not.toContain("cron.daemon_stopped");
  expect(codes(r)).toContain("cron.daemon_unverifiable");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "cron.daemon_unverifiable")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0); // info never fails doctor
});

test("unverifiable crontab (sandbox hides host spool) -> info, no not_installed despite enabled cron", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = withLinuxPlatform(() =>
    doctorWorkbench(root, stubDeps({ linuxCronHealth: () => ({ crontab: "unverifiable", service: "ok" }) })),
  );
  expect(codes(r)).not.toContain("cron.crontab_missing");
  expect(codes(r)).not.toContain("cron.not_installed"); // cannot read installs -> cannot judge
  expect(codes(r)).toContain("cron.crontab_unverifiable");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "cron.crontab_unverifiable")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0);
});

test("confirmed missing crontab + stopped daemon (verifiable host) -> both warnings preserved", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = withLinuxPlatform(() =>
    doctorWorkbench(root, stubDeps({ linuxCronHealth: () => ({ crontab: "missing", service: "stopped" }) })),
  );
  expect(codes(r)).toContain("cron.crontab_missing");
  expect(codes(r)).toContain("cron.daemon_stopped");
  expect(codes(r)).toContain("cron.not_installed"); // confirmed no crontab -> enabled cron really is not installed
  expect(codes(r)).not.toContain("cron.crontab_unverifiable");
  expect(codes(r)).not.toContain("cron.daemon_unverifiable");
});

test("missing-cmd (crontab binary absent) -> crontab_missing warning preserved + distinct message", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = withLinuxPlatform(() =>
    doctorWorkbench(root, stubDeps({ linuxCronHealth: () => ({ crontab: "missing-cmd", service: "ok" }) })),
  );
  expect(codes(r)).toContain("cron.crontab_missing"); // confirmed fault, not unverifiable
  expect(codes(r)).toContain("cron.not_installed"); // no crontab -> enabled cron really is not installed
  const diag = (r.data as { diagnostics: { code: string; message: string }[] }).diagnostics.find((d) => d.code === "cron.crontab_missing");
  expect(diag?.message).toContain("crontab command not found"); // the missing-binary wording
});

test("installed task not in cron.json -> cron.stale_task", () => {
  setCrons([{ id: "a", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, stubDeps({ installedCronIds: () => ["a", "old-cron"] }));
  expect(codes(r)).toContain("cron.stale_task");
  expect(codes(r)).not.toContain("cron.not_installed"); // "a" is installed
});

// ---- cron.inline_prompt_legacy: contract frozen in user-owned cron.json ------
// cron.json is user data (upgrade never overwrites it), so a contract written
// into `prompt` is frozen at the version that shipped when the workbench was
// created. When the cron id names a bundled skill, the same contract lives in
// the upgrade-managed skill layer.
function writeCronsRaw(crons: unknown[]): void {
  writeFileSync(join(root, ".jspace", "cron.json"), JSON.stringify({ schema_version: 1, crons }, null, 2));
}

test("inline-prompt cron whose id names a bundled skill -> cron.inline_prompt_legacy (info)", () => {
  writeCronsRaw([{ id: "memory-writeback", schedule: "0 22 * * 0", harness: "claude", prompt: "frozen contract text", enabled: false }]);
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("cron.inline_prompt_legacy");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "cron.inline_prompt_legacy")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0); // info never fails doctor
});

test("same cron migrated to a skill target -> no cron.inline_prompt_legacy", () => {
  writeCronsRaw([
    {
      id: "memory-writeback",
      schedule: "0 22 * * 0",
      harness: "claude",
      target: { kind: "skill", skill: "memory-writeback", entrypoint: "weekly", input: "thin trigger" },
      enabled: false,
    },
  ]);
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("cron.inline_prompt_legacy");
});

test("custom inline-prompt cron (id is not a bundled skill) -> no cron.inline_prompt_legacy", () => {
  // the intended escape hatch: prose prompts for one-off jobs must stay silent
  writeCronsRaw([{ id: "my-own-job", schedule: "0 7 * * 1", harness: "claude", prompt: "do my thing", enabled: false }]);
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("cron.inline_prompt_legacy");
});

test("invalid schedule -> cron.file_unreadable (schedule now validated at decode, P2-5)", () => {  setCrons([
    { id: "ok", schedule: "0 21 * * *", enabled: true },
    { id: "bad", schedule: "*/5 * * * *", enabled: true },
  ]);
  const r = doctorWorkbench(root, stubDeps({ installedCronIds: () => ["ok", "bad"] }));
  const d = codes(r);
  // a hand-edited cron.json with a bad schedule fails decode -> doctor reports
  // the file as unreadable (never crashes; read-only diagnostics invariant).
  expect(d).toContain("cron.file_unreadable");
  expect(d).not.toContain("cron.not_installed"); // nothing readable to judge installs
});

test("valid schedules -> no cron.file_unreadable", () => {
  setCrons([
    { id: "ok", schedule: "0 21 * * *", enabled: true },
    { id: "bad", schedule: "0 21 * * *", enabled: true },
  ]);
  const r = doctorWorkbench(root, stubDeps({ installedCronIds: () => ["ok", "bad"] }));
  expect(codes(r)).not.toContain("cron.file_unreadable");
});

test("open incident -> cron.open_incidents", () => {
  mkdirSync(join(root, ".jspace", "state", "incidents"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "incidents", "x-failed.json"),
    JSON.stringify({ schema_version: 1, id: "a1b2c3d4-0000-4000-8000-000000000201", cronId: "x", failureClass: "failed", status: "open", openedAt: "2026-08-03T12:00:00", evidence: [] }),
  );
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("cron.open_incidents");
});

test("filehub registered with unfiled _inbox -> filehub.inbox_unfiled", () => {
  // register a filehub resource bound to a local dir with one unfiled file
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, "_inbox"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "untidy.pdf"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("filehub.inbox_unfiled");
});

test("nested _inbox dir counts as ONE item (top-level semantics; single countInbox impl)", () => {
  // _inbox/sub/ with 3 files + top.pdf: recursive counting would report 4,
  // top-level counting reports 2. doctor must agree with `jspace inbox status`
  // and the context hook (both route through the shared countInbox).
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, "_inbox", "sub"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "top.pdf"), "x");
  writeFileSync(join(fh, "_inbox", "sub", "a.pdf"), "x");
  writeFileSync(join(fh, "_inbox", "sub", "b.pdf"), "x");
  writeFileSync(join(fh, "_inbox", "sub", "c.pdf"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  const diag = (r.data as { diagnostics: { code: string; message: string }[] }).diagnostics.find((d) => d.code === "filehub.inbox_unfiled");
  expect(diag).toBeDefined();
  expect(diag!.message).toContain("2 unfiled file(s)");
});

test("malformed .APPLY.json -> filehub.pending_decode warning (P2-6)", () => {
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, ".jspace-logs"), { recursive: true });
  writeFileSync(join(fh, ".jspace-logs", "corrupt.APPLY.json"), "{ not json", "utf-8");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  const diags = (r.data as { diagnostics: { code: string }[] }).diagnostics;
  expect(diags.some((d) => d.code === "filehub.pending_decode")).toBe(true);
});

test("malformed ingest journal -> ingest.journal_decode warning (symmetric with pending)", () => {
  const dir = join(root, ".jspace", "state", "ingest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "corrupt.json"), "{ not json", "utf-8");
  const r = doctorWorkbench(root, stubDeps());
  const diag = (r.data as { diagnostics: { code: string; severity: string; path: string }[] }).diagnostics.find((d) => d.code === "ingest.journal_decode");
  expect(diag).toBeDefined();
  expect(diag!.severity).toBe("warning");
  expect(diag!.path).toContain("corrupt.json");
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
      schema_version: 1,
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

test("settings.json exists without context hooks -> hooks.not_wired; wired -> none", () => {
  // seed settings.json registers jspace context hooks
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "jspace context session-start 2>/dev/null || true", timeout: 10 }] }] } }),
  );
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("hooks.not_wired");

  // a user-edited settings.json without the hooks (upgrade would skip it)
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("hooks.not_wired");
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

test(".agents/skills projection drift is detected like .claude", () => {
  // the project-level .agents/skills projection must be health-checked too
  mkdirSync(join(root, ".jspace", "skills", "asset-ingest", "scripts"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills", "asset-ingest", "scripts"), { recursive: true });
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "SKILL.md"), "identical");
  writeFileSync(join(root, ".agents", "skills", "asset-ingest", "SKILL.md"), "identical");
  writeFileSync(join(root, ".jspace", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
  writeFileSync(join(root, ".agents", "skills", "asset-ingest", "scripts", "extract.py"), "v2"); // drifted copy
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("skills.projection_drift");

  // reconcile -> diagnostic clears
  writeFileSync(join(root, ".agents", "skills", "asset-ingest", "scripts", "extract.py"), "v1");
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
      schema_version: 1,
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


// ---- long-term-use health (info level) ----

function makeFileWithMtime(rel: string, daysAgo: number): void {
  const p = join(root, rel);
  writeFileSync(p, "x");
  const t = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(p, t, t);
}

test("dormant domain -> domain.dormant (info); fresh domain -> none", () => {
  // a registered domain whose only file is 120 days old
  mkdirSync(join(root, "workspace", "old-domain"), { recursive: true });
  makeFileWithMtime("workspace/old-domain/README.md", 120);
  // a fresh registered domain
  mkdirSync(join(root, "workspace", "fresh-domain"), { recursive: true });
  makeFileWithMtime("workspace/fresh-domain/README.md", 2);
  // dormant scan is hub-authoritative (issue #8 #14): register both
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "old-domain", path: "workspace/old-domain" }, { id: "fresh-domain", path: "workspace/fresh-domain" }],
      resources: [],
      projects: [],
    }),
  );

  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).toContain("domain.dormant");
  // fresh domain is not reported (only the old one)
  const dormant = c.filter((x) => x === "domain.dormant");
  expect(dormant).toHaveLength(1);
});

test("boundary: domain just under threshold -> no domain.dormant", () => {
  mkdirSync(join(root, "workspace", "edge-domain"), { recursive: true });
  makeFileWithMtime("workspace/edge-domain/README.md", 89); // < 90d
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ schema_version: 1, domains: [{ id: "edge-domain", path: "workspace/edge-domain" }], resources: [], projects: [] }),
  );
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("domain.dormant");
});

test("stale filehub project -> filehub.project_stale (info); fresh -> none", () => {
  // register a filehub, put a stale + fresh project under it
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, "projects", "old-project", "docs"), { recursive: true });
  mkdirSync(join(fh, "projects", "active-project", "docs"), { recursive: true });
  // mtime must be on a file under the project (dirs alone have no lastActivity scan)
  const oldP = join(fh, "projects", "old-project", "docs", "index.md");
  writeFileSync(oldP, "x");
  const t = new Date(Date.now() - 130 * 86_400_000);
  utimesSync(oldP, t, t);
  writeFileSync(join(fh, "projects", "active-project", "docs", "index.md"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));

  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).toContain("filehub.project_stale");
  const stale = c.filter((x) => x === "filehub.project_stale");
  expect(stale).toHaveLength(1); // only old-project, not active-project
});

// ---- registry.project_unlinked: the reverse direction (disk -> registry) ----
// The pre-existing registry checks all go registry -> disk. The drift that
// actually happens is the other way: a folder appears in the file hub and
// nothing registers it, so weekly-report's project discovery misses it.

/** Register a filehub at <root>/filehub with the given hub projects[]. */
function withFilehub(projects: unknown[]): string {
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects,
    }),
  );
  const fh = join(root, "filehub");
  mkdirSync(join(fh, "projects"), { recursive: true });
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  return fh;
}

test("filehub project with no hub record -> registry.project_unlinked (info)", () => {
  const fh = withFilehub([]);
  mkdirSync(join(fh, "projects", "acme"), { recursive: true });
  writeFileSync(join(fh, "projects", "acme", "index.md"), "x");
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("registry.project_unlinked");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "registry.project_unlinked")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0);
});

test("registered project (ascii id bound to a free-form asset dir) -> no registry.project_unlinked", () => {
  // the 8.7 naming convention: id is ascii, the asset dir keeps its human name
  const fh = withFilehub([{ id: "tiyanying-52", domain: "files", asset_rel_path: "projects/52期体验营", status: "active" }]);
  mkdirSync(join(fh, "projects", "52期体验营"), { recursive: true });
  writeFileSync(join(fh, "projects", "52期体验营", "index.md"), "x");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("registry.project_unlinked");
});

// ---- agentsmd.stale_outside_block: pre-block-era template residue ----------
// Everything after JSPACE:END is user-owned, so upgrade never rewrites it and a
// stale template dump there survives forever, injecting a second contradictory
// copy of the rules into every session.

const MANAGED_BLOCK = `<!-- JSPACE:START -->\n# JSpace 工作台\n<!-- TRELLIS-BRAIN-OPS:BEGIN -->\n- **jspace-use**: x\n<!-- TRELLIS-BRAIN-OPS:END -->\n<!-- JSPACE:END -->\n`;

test("stale generated marker outside the managed block -> agentsmd.stale_outside_block", () => {
  writeFileSync(join(root, "AGENTS.md"), `${MANAGED_BLOCK}\n# 旧模板全文\n<!-- TRELLIS-BRAIN-OPS:BEGIN -->\n- **jspace-bootstrap**: x\n<!-- TRELLIS-BRAIN-OPS:END -->\n`);
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("agentsmd.stale_outside_block");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "agentsmd.stale_outside_block")?.severity).toBe("warning");
});

test("retired skill name outside the block -> agentsmd.stale_outside_block", () => {
  writeFileSync(join(root, "AGENTS.md"), `${MANAGED_BLOCK}\n我的个人规则:参考 jspace-bootstrap 的做法\n`);
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("agentsmd.stale_outside_block");
});

test("markers only INSIDE the block -> no agentsmd.stale_outside_block", () => {
  // the managed block legitimately carries the generated Brain-ops sub-block
  writeFileSync(join(root, "AGENTS.md"), `${MANAGED_BLOCK}\n# 我自己写的规则\n每天先看看日历。\n`);
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("agentsmd.stale_outside_block");
});

test("AGENTS.md without a JSPACE block is never scanned (user-authored file)", () => {
  // no managed block => the whole file is the user's; flagging it would be noise
  writeFileSync(join(root, "AGENTS.md"), "# 我的 AGENTS\n<!-- TRELLIS-BRAIN-OPS:BEGIN -->\n- x\n");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("agentsmd.stale_outside_block");
});

// ---- skills.bundle_stale: materialized skills vs the running bundle --------
// skills.projection_drift only compares workbench-internal copies against
// .jspace/skills/; nothing told the user that .jspace/skills/ itself lags the
// installed binary (the cron path failed on it, doctor stayed silent).

test("bundleStaleSkills reports names -> skills.bundle_stale (info)", () => {
  const r = doctorWorkbench(root, stubDeps({ bundleStaleSkills: () => ["asset-ingest", "jspace-use"] }));
  expect(codes(r)).toContain("skills.bundle_stale");
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "skills.bundle_stale");
  expect(d?.severity).toBe("info"); // a locally edited skill is a legitimate conflict, not a fault
  expect(d?.message).toContain("asset-ingest");
  expect(r.exitCode ?? 0).toBe(0);
});

test("bundleStaleSkills empty or not injected -> no skills.bundle_stale", () => {
  expect(codes(doctorWorkbench(root, stubDeps({ bundleStaleSkills: () => [] })))).not.toContain("skills.bundle_stale");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("skills.bundle_stale"); // dep omitted
});

// ---- gbrain skills-dir wiring (info level) ----

const gbrainWiredDoc = (skillsDir: string): unknown => ({
  mcpServers: { gbrain: { command: "/x/gbrain", args: ["serve"], type: "stdio", env: { GBRAIN_SKILLS_DIR: skillsDir } } },
});

test("gbrain skillsdir unwired -> gbrain.skillsdir_unwired (info); wired -> none", () => {
  // stub returns null by default -> no diagnostic (machine config absent is not a wb problem)
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("gbrain.skillsdir_unwired");

  // unwired: gbrain server env points elsewhere (read via the harness-config seam)
  const claudeCfg = (skillsDir: string): string => JSON.stringify(gbrainWiredDoc(skillsDir));
  const unwired = doctorWorkbench(
    root,
    stubDeps({ readHarnessConfig: (p) => (p.includes(".claude.json") ? claudeCfg("/other/skills") : null) }),
  );
  expect(codes(unwired)).toContain("gbrain.skillsdir_unwired");
  const diags = (unwired.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "gbrain.skillsdir_unwired")?.severity).toBe("info");

  // wired: env matches this workbench's .jspace/skills
  const wired = doctorWorkbench(
    root,
    stubDeps({ readHarnessConfig: (p) => (p.includes(".claude.json") ? claudeCfg(join(root, ".jspace", "skills")) : null) }),
  );
  expect(codes(wired)).not.toContain("gbrain.skillsdir_unwired");
});

test("invalid JSON harness config -> gbrain.config_invalid_json (info), doctor does not crash", () => {
  // a hand-edited .claude.json with bad JSON must not crash read-only diagnostics
  const r = doctorWorkbench(
    root,
    stubDeps({ readHarnessConfig: (p) => (p.includes(".claude.json") ? "{ not json" : null) }),
  );
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "gbrain.config_invalid_json");
  expect(d).toBeDefined();
  expect(d!.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0);
  // unreadable config is not double-reported as unwired (wire cmd owns repair)
  expect(diags.some((x) => x.code === "gbrain.skillsdir_unwired")).toBe(false);
});

test("invalid JSON domain.json -> domain.context_drift warning, doctor does not throw", () => {
  // a hand-edited domain.json with bad JSON must not crash read-only diagnostics
  // (the injected readJson lambda returns a sentinel instead of throwing)
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  writeFileSync(join(root, "workspace", "files", "README.md"), "x");
  writeFileSync(join(root, "workspace", "files", "domain.json"), "{ not json");
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ schema_version: 1, domains: [{ id: "files", path: "workspace/files" }], resources: [], projects: [] }),
  );
  const r = doctorWorkbench(root, stubDeps());
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "domain.context_drift" && x.message.includes("is not valid JSON"));
  expect(d).toBeDefined();
  expect(d!.severity).toBe("warning");
});

// ---- checkHarness (active harness support health) ----

test("active headless harness with binary present -> no harness.* diagnostics", () => {
  setCrons([{ id: "a", schedule: "0 9 * * *", enabled: true }]); // harness claude, bin stubbed present
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c.some((x) => x.startsWith("harness."))).toBe(false);
});

test("active headless harness with missing binary -> harness.bin_missing warning", () => {
  setCrons([{ id: "a", schedule: "0 9 * * *", enabled: true }]);
  const r = doctorWorkbench(root, stubDeps({ harnessBinOnPath: () => false }));
  expect(codes(r)).toContain("harness.bin_missing");
  expect(r.exitCode ?? 0).toBe(0); // warning is non-blocking
});

test("non-active harnesses are not checked (no cross-harness noise)", () => {
  // only claude is scheduled; grok/opencode/pi/cursor must not be probed
  setCrons([{ id: "a", schedule: "0 9 * * *", enabled: true }]);
  const probed = new Set<string>();
  doctorWorkbench(
    root,
    stubDeps({ harnessBinOnPath: (name) => (probed.add(name), true) }),
  );
  expect([...probed]).toEqual(["claude"]);
});

test("cron harness outside capabilities -> harness.unknown warning", () => {
  const badLoad = (): { crons: CronLike[] } => ({ crons: [{ id: "a", schedule: "0 9 * * *", enabled: true, harness: "bogus" }] });
  const r = doctorWorkbench(root, stubDeps({ loadCrons: badLoad }));
  expect(codes(r)).toContain("harness.unknown");
});

// ---- Pi branch (honest boundary + optional extension hint) ----

function setCronsHarness(harness: string): void {
  writeFileSync(
    join(root, ".jspace", "cron.json"),
    JSON.stringify({ schema_version: 1, crons: [{ id: "a", schedule: "0 9 * * *", harness, prompt: "p", enabled: true }] }, null, 2),
  );
}

test("active pi harness with pi CLI present -> info hint (harness.pi_mcp_adapter), not a warning", () => {
  setCronsHarness("pi");
  const r = doctorWorkbench(root, stubDeps({ harnessBinOnPath: (n) => n === "pi" }));
  expect(codes(r)).toContain("harness.pi_mcp_adapter");
  expect(codes(r)).not.toContain("harness.bin_missing");
  expect(r.exitCode ?? 0).toBe(0); // info never blocks
  const diag = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics.find((d) => d.code === "harness.pi_mcp_adapter");
  expect(diag?.severity).toBe("info");
  expect(diag?.message).toContain("npm executes package code"); // inline supply-chain warning
  expect(diag?.message).toContain("harness-pi.md");
});

test("active pi harness without pi CLI -> bin_missing warning (no fake extension hint)", () => {
  setCronsHarness("pi");
  const r = doctorWorkbench(root, stubDeps({ harnessBinOnPath: () => false }));
  expect(codes(r)).toContain("harness.bin_missing");
  expect(codes(r)).not.toContain("harness.pi_mcp_adapter");
});

test("non-active pi is not probed (active-only, no cross-harness noise)", () => {
  setCronsHarness("claude");
  const probed = new Set<string>();
  doctorWorkbench(root, stubDeps({ harnessBinOnPath: (n) => (probed.add(n), true) }));
  expect([...probed]).toEqual(["claude"]);
  expect(codes(doctorWorkbench(root, stubDeps({ harnessBinOnPath: () => true })))).not.toContain("harness.pi_mcp_adapter");
});

test("dormant custom-path domain + unregistered workspace dir (issue #8 #14)", () => {
  // registered domain at a custom hub path (not workspace/<id>)
  const domainDir = join(root, "workspace", "deep", "custom");
  mkdirSync(domainDir, { recursive: true });
  const f = join(domainDir, "README.md");
  writeFileSync(f, "stale");
  const old = new Date(Date.now() - 100 * 86_400_000); // 100 days ago
  utimesSync(f, old, old);
  writeFileSync(
    join(root, ".jspace", "hub.json"),
    JSON.stringify({ schema_version: 1, domains: [{ id: "custom", path: "workspace/deep/custom" }], resources: [], projects: [] }),
  );
  // unregistered residue directory (workspace/deep is an ANCESTOR of the
  // registered domain, so only the sibling below is flagged)
  mkdirSync(join(root, "workspace", "stale"), { recursive: true });
  const r = doctorWorkbench(root, stubDeps());
  const c = codes(r);
  expect(c).toContain("domain.dormant");
  expect(c).toContain("domain.unregistered");
  const diags = (r.data as { diagnostics: { code: string; message: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "domain.dormant")!.message).toContain("workspace/deep/custom");
  expect(diags.find((d) => d.code === "domain.unregistered")!.message).toContain("workspace/stale");
  expect(diags.some((d) => d.code === "domain.unregistered" && d.message.includes("workspace/deep"))).toBe(false);
});

test("multi-harness gbrain wiring via capabilities.mcp_config (issue #8 #16)", () => {
  const wbSkillsDir = join(root, ".jspace", "skills");
  // claude: ~/.claude.json mcpServers.gbrain env unwired -> unwired diag
  const claudeUnwired = stubDeps({
    readHarnessConfig: (p) => (p.includes(".claude.json") ? JSON.stringify({ mcpServers: { gbrain: { command: "gbrain", env: {} } } }) : null),
  });
  expect(codes(doctorWorkbench(root, claudeUnwired))).toContain("gbrain.skillsdir_unwired");
  // claude wired -> none
  const claudeWired = stubDeps({
    readHarnessConfig: (p) => (p.includes(".claude.json") ? JSON.stringify({ mcpServers: { gbrain: { command: "gbrain", env: { GBRAIN_SKILLS_DIR: wbSkillsDir } } } }) : null),
  });
  expect(codes(doctorWorkbench(root, claudeWired))).not.toContain("gbrain.skillsdir_unwired");
  // grok: config.toml env points elsewhere -> unwired
  const grokUnwired = stubDeps({
    readHarnessConfig: (p) => (p.includes("config.toml") ? "[mcp_servers.gbrain]\ncommand = 'gbrain'\nenv = { GBRAIN_SKILLS_DIR = '/wrong/skills' }\n" : null),
  });
  expect(codes(doctorWorkbench(root, grokUnwired))).toContain("gbrain.skillsdir_unwired");
  // grok wired -> none
  const grokWired = stubDeps({
    readHarnessConfig: (p) => (p.includes("config.toml") ? `[mcp_servers.gbrain]\ncommand = 'gbrain'\nenv = { GBRAIN_SKILLS_DIR = '${wbSkillsDir}' }\n` : null),
  });
  expect(codes(doctorWorkbench(root, grokWired))).not.toContain("gbrain.skillsdir_unwired");
});

test("tomlSkillsDirWired scoped to target section: sibling server with same key cannot mask unwired (issue #9 #9-07)", () => {
  const wbSkillsDir = join(root, ".jspace", "skills");
  // [mcp_servers.other] carries the wb skills dir while [mcp_servers.gbrain]
  // points elsewhere — the whole-file regex would wrongly report "wired".
  const interfering = `[mcp_servers.other]\ncommand = 'other'\nenv = { GBRAIN_SKILLS_DIR = '${wbSkillsDir}' }\n\n[mcp_servers.gbrain]\ncommand = 'gbrain'\nenv = { GBRAIN_SKILLS_DIR = '/wrong/skills' }\n`;
  const r = doctorWorkbench(
    root,
    stubDeps({ readHarnessConfig: (p) => (p.includes("config.toml") ? interfering : null) }),
  );
  expect(codes(r)).toContain("gbrain.skillsdir_unwired"); // NOT masked by the sibling
  // reverse: gbrain section itself wired -> no diagnostic even with a sibling unwired
  const gbrainWired = `[mcp_servers.other]\ncommand = 'other'\nenv = { GBRAIN_SKILLS_DIR = '/wrong/skills' }\n\n[mcp_servers.gbrain]\ncommand = 'gbrain'\nenv = { GBRAIN_SKILLS_DIR = '${wbSkillsDir}' }\n`;
  expect(codes(doctorWorkbench(root, stubDeps({ readHarnessConfig: (p) => (p.includes("config.toml") ? gbrainWired : null) })))).not.toContain("gbrain.skillsdir_unwired");
});
