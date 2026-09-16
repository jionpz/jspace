// application/workspace/doctor.test.ts — `jspace doctor` health surface
// (zero coverage before the review; the most user-facing diagnostics).
// Real loadCrons/parseSchedule against a temp workbench; installed-task detection
// is stubbed (the real one spawns the platform scheduler — never in tests).
// Run: bun test application/workspace/doctor.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorWorkbench, type CronHealthDeps, type CronLike } from "./doctor.ts";
import { loadCapabilities } from "../../adapters/harness/registry.ts";
import { loadCrons, parseSchedule } from "../automation/definitions.ts";
import { sha256Of } from "../workspace/manifest.ts";
import { filehubReadme as embeddedFilehubReadme } from "../../cli/embed.ts";
import { FILEHUB_CONTRACT_VERSION } from "../registry/filehub-block.ts";
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
  // Explicit cap: the budget test below creates ~36k files, and the default 5s
  // hook timeout is too tight to delete that tree on a loaded/shared runner
  // (observed one flake on Linux; Windows FS is slower still). Still fails if
  // cleanup genuinely hangs — this only raises the ceiling.
}, 60_000);

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

function severityOf(result: CmdResult, code: string): string | undefined {
  const data = result.data as { diagnostics: { code: string; severity: string }[] };
  return data.diagnostics.find((d) => d.code === code)?.severity;
}

function messageOf(result: CmdResult, code: string): string {
  const data = result.data as { diagnostics: { code: string; message: string }[] };
  return data.diagnostics.find((d) => d.code === code)?.message ?? "";
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

test("every cron disabled -> cron.all_disabled info (flywheel never starts), never a failure", () => {
  setCrons([
    { id: "inbox-tidy", schedule: "0 21 * * *", enabled: false },
    { id: "workbench-retro", schedule: "0 23 * * 0", enabled: false },
  ]);
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("cron.all_disabled");
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "cron.all_disabled");
  expect(d?.severity).toBe("info"); // an all-manual workbench is a legitimate choice
  expect(d?.message).toContain("jspace cron enable"); // the enable path is right there
  expect(r.exitCode ?? 0).toBe(0);
  expect((r.warnings ?? []).join("\n")).not.toContain("cron definition(s) disabled");
});

test("at least one cron enabled -> no cron.all_disabled; empty cron.json stays silent", () => {
  setCrons([
    { id: "inbox-tidy", schedule: "0 21 * * *", enabled: true },
    { id: "workbench-retro", schedule: "0 23 * * 0", enabled: false },
  ]);
  expect(codes(doctorWorkbench(root, stubDeps({ installedCronIds: () => ["inbox-tidy"] })))).not.toContain("cron.all_disabled");
  setCrons([]);
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("cron.all_disabled");
});

test("cron with tools on unsupported harness -> cron.tools_unsupported_harness warning", () => {
  writeFileSync(
    join(root, ".jspace", "cron.json"),
    JSON.stringify({
      schema_version: 1,
      crons: [{ id: "probe", schedule: "0 21 * * *", harness: "opencode", prompt: "p", tools: "Read", enabled: true }],
    }),
  );
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("cron.tools_unsupported_harness");
});

// ---- linux cron health tri-state (issue #10) --------------------------------
// doctor only runs the linux crontab/daemon health branch when platform is
// linux; inject `platform` through the deps (issue #11 P3-4) instead of mutating
// the global process.platform (a future runtime could make it non-configurable).
function linuxDeps(over: Partial<CronHealthDeps> = {}): CronHealthDeps {
  return stubDeps({ platform: "linux", ...over });
}

test("unverifiable service (sandbox hides host daemon) -> info, no daemon_stopped", () => {
  const r = doctorWorkbench(root, linuxDeps({ linuxCronHealth: () => ({ crontab: "ok", service: "unverifiable" }) }));
  expect(codes(r)).not.toContain("cron.daemon_stopped");
  expect(codes(r)).toContain("cron.daemon_unverifiable");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "cron.daemon_unverifiable")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0); // info never fails doctor
});

test("unverifiable crontab (sandbox hides host spool) -> info, no not_installed despite enabled cron", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, linuxDeps({ linuxCronHealth: () => ({ crontab: "unverifiable", service: "ok" }) }));
  expect(codes(r)).not.toContain("cron.crontab_missing");
  expect(codes(r)).not.toContain("cron.not_installed"); // cannot read installs -> cannot judge
  expect(codes(r)).toContain("cron.crontab_unverifiable");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "cron.crontab_unverifiable")?.severity).toBe("info");
  expect(r.exitCode ?? 0).toBe(0);
});

test("confirmed missing crontab + stopped daemon (verifiable host) -> both warnings preserved", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, linuxDeps({ linuxCronHealth: () => ({ crontab: "missing", service: "stopped" }) }));
  expect(codes(r)).toContain("cron.crontab_missing");
  expect(codes(r)).toContain("cron.daemon_stopped");
  expect(codes(r)).toContain("cron.not_installed"); // confirmed no crontab -> enabled cron really is not installed
  expect(codes(r)).not.toContain("cron.crontab_unverifiable");
  expect(codes(r)).not.toContain("cron.daemon_unverifiable");
});

test("missing-cmd (crontab binary absent) -> crontab_missing warning preserved + distinct message", () => {
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const r = doctorWorkbench(root, linuxDeps({ linuxCronHealth: () => ({ crontab: "missing-cmd", service: "ok" }) }));
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

test("_inbox with only resident README + .skip-inbox-tidy dir -> NO inbox_unfiled (issue #38)", () => {  // Structure, not payload: the permanent false warning must be gone.
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
  mkdirSync(join(fh, "_inbox", "deep-learn"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "README.md"), "drop-zone contract");
  writeFileSync(join(fh, "_inbox", "deep-learn", ".skip-inbox-tidy"), "");
  writeFileSync(join(fh, "_inbox", "deep-learn", "note.md"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).not.toContain("filehub.inbox_unfiled");
});

test("_inbox payload next to resident/exempt entries still warns with the exact count", () => {
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
  mkdirSync(join(fh, "_inbox", "deep-learn"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "README.md"), "drop-zone contract");
  writeFileSync(join(fh, "_inbox", "deep-learn", ".skip-inbox-tidy"), "");
  writeFileSync(join(fh, "_inbox", "real-report.pdf"), "x");
  writeFileSync(join(root, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));
  const r = doctorWorkbench(root, stubDeps());
  const diag = (r.data as { diagnostics: { code: string; message: string }[] }).diagnostics.find((d) => d.code === "filehub.inbox_unfiled");
  expect(diag).toBeDefined();
  expect(diag!.message).toContain("1 unfiled file(s)");
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

test("claude pointer: the missing case points at upgrade, the edited case tells the truth about skip (issue #52)", () => {
  // missing seed -> upgrade really does re-create it, so naming that command is honest
  expect(messageOf(doctorWorkbench(root, stubDeps()), "claude.pointer_missing")).toContain(
    "a missing seed is re-created by 'jspace workspace upgrade'",
  );

  // edited seed (present, import removed) -> upgrade skips it: same two-step contract as the hooks
  writeFileSync(join(root, "CLAUDE.md"), "# notes\n");
  const edited = messageOf(doctorWorkbench(root, stubDeps()), "claude.pointer_missing");
  expect(edited).toContain("no longer imports @AGENTS.md");
  expect(edited).toContain("keeps it as-is (skip)");
  expect(edited).toContain("delete the file and re-run 'jspace workspace upgrade'");

  // range rule applies here too: unscheduled claude is info, scheduled claude is a warning
  expect(severityOf(doctorWorkbench(root, stubDeps()), "claude.pointer_missing")).toBe("info");
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  expect(severityOf(doctorWorkbench(root, stubDeps()), "claude.pointer_missing")).toBe("warning");
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

test("edited seed: hooks.not_wired and harness.session_start_not_wired share one honest repair sentence (issue #52)", () => {
  // The reported contradiction: one check said "upgrade preserves your edit",
  // the other said "run upgrade to restore the seed" — for the same file, and
  // upgrade really does skip it (manifest.ts: seed + local edit -> skip).
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
  const r = doctorWorkbench(root, stubDeps());
  const hooks = messageOf(r, "hooks.not_wired");
  const session = messageOf(r, "harness.session_start_not_wired");
  expect(hooks).not.toBe("");
  expect(session).not.toBe("");

  // same repair clause, verbatim, on both checks
  const repair = (m: string): string => m.slice(m.indexOf("; ") + 2);
  expect(repair(hooks)).toBe(repair(session));
  // honest about the skip, and the restore path is explicit about destroying edits
  expect(repair(hooks)).toContain("'jspace workspace upgrade' keeps it as-is (skip)");
  expect(repair(hooks)).toContain("delete the file and re-run 'jspace workspace upgrade'");
  expect(repair(hooks)).toContain("discards your local edits");
  // and never the old promise that upgrade clears the warning by itself
  expect(repair(hooks)).not.toContain("to restore the seed'");
});

test("harness-scoped wiring findings: warning only for harnesses this workbench schedules (issue #52)", () => {
  // an edited claude seed in a workbench that schedules nothing -> info, not warning
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
  expect(severityOf(doctorWorkbench(root, stubDeps()), "hooks.not_wired")).toBe("info");
  expect(severityOf(doctorWorkbench(root, stubDeps()), "harness.session_start_not_wired")).toBe("info");

  // the same workbench with claude scheduled -> both are warnings again
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  const active = doctorWorkbench(root, stubDeps());
  expect(severityOf(active, "hooks.not_wired")).toBe("warning");
  expect(severityOf(active, "harness.session_start_not_wired")).toBe("warning");
});

test("non-claude seed of an unscheduled harness -> info; scheduled -> warning (issue #52)", () => {
  // grok, not cursor: only harnesses with a cron enum value can ever be
  // "scheduled here", so an IDE-only harness (cursor) is always info — its
  // functional signal is briefing.stale, which stays a warning.
  mkdirSync(join(root, ".grok", "hooks"), { recursive: true });
  writeFileSync(join(root, ".grok", "hooks", "jspace.json"), JSON.stringify({ hooks: {} }));
  expect(severityOf(doctorWorkbench(root, stubDeps()), "harness.session_start_not_wired")).toBe("info");

  writeFileSync(
    join(root, ".jspace", "cron.json"),
    JSON.stringify({ schema_version: 1, crons: [{ id: "c", schedule: "0 21 * * *", harness: "grok", enabled: true, prompt: "p" }] }),
  );
  expect(severityOf(doctorWorkbench(root, stubDeps()), "harness.session_start_not_wired")).toBe("warning");
});

test("an unscheduled harness never turns its seed finding into a lost signal: briefing.stale still warns (issue #52)", () => {
  // The per-harness seed finding is informational when the harness is not used
  // here; the functional "hooks are not actually running" signal is the
  // harness-agnostic briefing.stale warning, which stays a warning either way.
  mkdirSync(join(root, ".cursor"), { recursive: true });
  writeFileSync(join(root, ".cursor", "hooks.json"), JSON.stringify({ hooks: {} }));
  const r = doctorWorkbench(root, stubDeps());
  expect(severityOf(r, "harness.session_start_not_wired")).toBe("info");
  expect(severityOf(r, "briefing.stale")).toBe("warning");
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

test("global skill install target missing -> skills.global_missing (info, issue #37)", () => {
  const r = doctorWorkbench(
    root,
    stubDeps({ globalSkills: () => [{ name: "harness-config", installPath: join(root, "absent", "harness-config") }] }),
  );
  expect(codes(r)).toContain("skills.global_missing");
  const data = r.data as { diagnostics: { code: string; severity: string; message: string }[] };
  const d = data.diagnostics.find((x) => x.code === "skills.global_missing");
  expect(d?.severity).toBe("info"); // optional machine-level skill: never a fault
  expect(d?.message).toContain("jspace skills install");
});

test("global skill installed (SKILL.md present) -> no skills.global_missing", () => {
  const dir = join(root, "installed", "harness-config");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# harness-config");
  const r = doctorWorkbench(root, stubDeps({ globalSkills: () => [{ name: "harness-config", installPath: dir }] }));
  expect(codes(r)).not.toContain("skills.global_missing");
});

test("globalSkills not injected -> skills.global_missing check skipped silently", () => {
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("skills.global_missing");
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

// ---- filehub.contract_stale / filehub.legacy_taxonomy (read-only doctor) ----


test("filehub without a README -> filehub.contract_stale warning (non-blocking)", () => {
  withFilehub([]);
  const r = doctorWorkbench(root, stubDeps());
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "filehub.contract_stale");
  expect(d?.severity).toBe("warning");
  expect(d!.message).toContain("jspace filehub upgrade");
  expect(r.exitCode ?? 0).toBe(0);
});

test("filehub README with no managed block -> filehub.contract_stale", () => {
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), "# 用户自己的 README\n");
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "filehub.contract_stale");
  expect(d).toBeDefined();
  expect(d!.message).toContain("no JSPACE:FILEHUB contract block");
  expect(d!.message).toContain("jspace filehub upgrade");
});

test("filehub README with damaged markers -> filehub.contract_stale (never throws)", () => {
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), "# t\n<!-- JSPACE:FILEHUB:START -->\nno end\n");
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "filehub.contract_stale");
  expect(d?.severity).toBe("warning");
  expect(d!.message).toContain("damaged");
});

test("filehub README with an outdated contract version -> filehub.contract_stale", () => {
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), `<!-- JSPACE:FILEHUB:START -->\n> filehub-contract-version: 1\nold\n<!-- JSPACE:FILEHUB:END -->\n`);
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "filehub.contract_stale");
  expect(d).toBeDefined();
  expect(d!.message).toContain(`v1 < v${FILEHUB_CONTRACT_VERSION}`);
});

test("compliant filehub (current block + flat project) -> no contract diagnostics", () => {
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "projects", "acme"), { recursive: true });
  writeFileSync(join(fh, "projects", "acme", "index.md"), "---\nlayout: flat\n---\n");
  mkdirSync(join(fh, "areas", "books"), { recursive: true });
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).not.toContain("filehub.contract_stale");
  expect(c).not.toContain("filehub.legacy_taxonomy");
});

test("legacy format dirs under a registered project -> filehub.legacy_taxonomy", () => {
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "projects", "acme", "docs"), { recursive: true });
  mkdirSync(join(fh, "projects", "acme", "delivery"), { recursive: true });
  const r = doctorWorkbench(root, stubDeps());
  const d = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics.find(
    (x) => x.code === "filehub.legacy_taxonomy",
  );
  expect(d?.severity).toBe("warning");
  expect(d!.message).toContain("docs");
  expect(d!.message).not.toContain("delivery");
  expect(d!.message).toContain("migration.md");
  expect(r.exitCode ?? 0).toBe(0);
});

test("legacy format dir under areas/<domain> -> filehub.legacy_taxonomy", () => {
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "areas", "books", "data"), { recursive: true });
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "filehub.legacy_taxonomy");
  expect(d).toBeDefined();
  expect(d!.message).toContain("areas/books");
  expect(d!.message).toContain("data");
});

test("legacy taxonomy scan is one level only (semantic dir may contain a docs/ folder)", () => {
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "projects", "acme", "delivery", "docs"), { recursive: true });
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("filehub.legacy_taxonomy");
});

test("registered filehub root absent on this machine -> no content-check cascade", () => {
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "projects", "acme", "docs"), { recursive: true });
  rmSync(fh, { recursive: true, force: true }); // unmounted drive / unsynced folder
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).not.toContain("filehub.contract_stale");
  expect(c).not.toContain("filehub.legacy_taxonomy");
  expect(c).not.toContain("filehub.inbox_missing");
});

test.skipIf(process.platform === "win32")("unreadable _inbox root degrades to a diagnostic instead of throwing", () => {
  // win32 skip: chmod 0o000 does not deny reads on Windows (no POSIX mode bits).
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  const inbox = join(fh, "_inbox");
  mkdirSync(inbox, { recursive: true });
  chmodSync(inbox, 0o000);
  try {
    const r = doctorWorkbench(root, stubDeps());
    expect(r.exitCode ?? 0).toBe(0);
    expect(codes(r)).toContain("filehub.inbox_unreadable");
  } finally {
    chmodSync(inbox, 0o755);
  }
});

test.skipIf(process.platform === "win32")("unreadable projects/ root degrades to a diagnostic instead of throwing", () => {
  // win32 skip: chmod 0o000 does not deny reads on Windows (no POSIX mode bits).
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  mkdirSync(join(fh, "projects", "acme"), { recursive: true });
  const projects = join(fh, "projects");
  chmodSync(projects, 0o000);
  try {
    const r = doctorWorkbench(root, stubDeps());
    expect(r.exitCode ?? 0).toBe(0);
    expect(codes(r)).toContain("filehub.projects_unreadable");
  } finally {
    chmodSync(projects, 0o755);
  }
});

test("a symlinked areas entry is never followed outside the filehub", () => {
  const fh = withFilehub([]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  const outside = join(root, "outside-area");
  mkdirSync(join(outside, "docs"), { recursive: true }); // legacy dir OUTSIDE the filehub
  mkdirSync(join(fh, "areas"), { recursive: true });
  symlinkSync(outside, join(fh, "areas", "external"));
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).not.toContain("filehub.legacy_taxonomy");
});

test("unregistered filehub -> no contract_stale / legacy_taxonomy noise", () => {
  const c = codes(doctorWorkbench(root, stubDeps()));
  expect(c).not.toContain("filehub.contract_stale");
  expect(c).not.toContain("filehub.legacy_taxonomy");
});

test.skipIf(process.platform === "win32")("unreadable project dir degrades to skip instead of crashing doctor", () => {
  // win32 skip: chmod 0o000 does not deny reads on Windows (no POSIX mode bits).
  const fh = withFilehub([{ id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" }]);
  writeFileSync(join(fh, "README.md"), embeddedFilehubReadme());
  const p = join(fh, "projects", "acme");
  mkdirSync(p, { recursive: true });
  chmodSync(p, 0o000);
  try {
    const r = doctorWorkbench(root, stubDeps());
    expect(r.exitCode ?? 0).toBe(0);
  } finally {
    chmodSync(p, 0o755);
  }
});

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

test("a large filehub collapses per-project fan-out into capped lines + a total", () => {
  // 40 unlinked + stale projects used to mean 80 diagnostics (and 80 verbose
  // lines) for ONE actionable fact; the first FANOUT_LIMIT stay concrete and
  // the rest collapse into a counted line.
  const fh = withFilehub([]);
  const t = new Date(Date.now() - 200 * 86_400_000);
  for (let i = 0; i < 40; i++) {
    const p = join(fh, "projects", `p${i}`);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "index.md"), "x");
    utimesSync(join(p, "index.md"), t, t);
  }
  const r = doctorWorkbench(root, stubDeps());
  const c = codes(r);
  expect(c.filter((x) => x === "registry.project_unlinked")).toHaveLength(6); // 5 + aggregate
  expect(c.filter((x) => x === "filehub.project_stale")).toHaveLength(6);
  const diags = (r.data as { diagnostics: { code: string; path: string; message: string }[] }).diagnostics;
  const agg = diags.find((d) => d.code === "registry.project_unlinked" && d.path === "filehub.projects");
  expect(agg?.message).toContain("40 project(s)");
  // the aggregate is info-level: a messy asset tree never fails doctor
  expect(r.exitCode ?? 0).toBe(0);
});

test("legacy format dirs in many locations collapse into one counted warning", () => {
  const fh = withFilehub([]);
  for (let i = 0; i < 12; i++) {
    mkdirSync(join(fh, "areas", `a${i}`, "docs"), { recursive: true });
  }
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; path: string; message: string }[] }).diagnostics;
  const legacy = diags.filter((d) => d.code === "filehub.legacy_taxonomy");
  expect(legacy).toHaveLength(6); // 5 concrete roots + 1 aggregate
  expect(legacy[5].path).toBe("filehub");
  expect(legacy[5].message).toContain("12 location(s)");
});

test("an exhausted scan budget is reported instead of guessing at staleness", () => {
  const fh = withFilehub([]);
  const t = new Date(Date.now() - 200 * 86_400_000);
  // each project is genuinely stale, so every walk runs to the end and drains
  // the shared budget — the run must stop and say so, not fabricate verdicts.
  for (let i = 0; i < 6; i++) {
    const p = join(fh, "projects", `big${i}`);
    for (let j = 0; j < 6000; j++) {
      const d = join(p, `s${j % 3}`);
      mkdirSync(d, { recursive: true });
      const f = join(d, `f${j}.md`);
      writeFileSync(f, "x");
      utimesSync(f, t, t);
    }
  }
  const diags = (doctorWorkbench(root, stubDeps()).data as { diagnostics: { code: string; message: string }[] }).diagnostics;
  const trunc = diags.find((d) => d.code === "filehub.scan_truncated");
  expect(trunc).toBeDefined();
  expect(trunc!.message).toContain("budget");
  expect(trunc!.message).toContain("not checked");
}, 120_000);

// ---- agentsmd.stale_outside_block: pre-block-era template residue ----------
// Everything after JSPACE:END is user-owned, so upgrade never rewrites it and a
// stale template dump there survives forever, injecting a second contradictory
// copy of the rules into every session.

const MANAGED_BLOCK = `<!-- JSPACE:START -->\n# JSpace 工作台\n<!-- JSPACE-BRAIN-OPS:BEGIN -->\n- **jspace-use**: x\n<!-- JSPACE-BRAIN-OPS:END -->\n<!-- JSPACE:END -->\n`;

test("stale generated marker outside the managed block -> agentsmd.stale_outside_block", () => {
  writeFileSync(join(root, "AGENTS.md"), `${MANAGED_BLOCK}\n# 旧模板全文\n<!-- JSPACE-BRAIN-OPS:BEGIN -->\n- **jspace-bootstrap**: x\n<!-- JSPACE-BRAIN-OPS:END -->\n`);
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain("agentsmd.stale_outside_block");
  const diags = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics;
  expect(diags.find((d) => d.code === "agentsmd.stale_outside_block")?.severity).toBe("warning");
});

test("LEGACY TRELLIS marker residue outside the block is still detected after the rename", () => {
  // pre-rename workbenches dumped the old template with TRELLIS-* markers; the
  // residue check must keep matching the retired spelling forever
  writeFileSync(join(root, "AGENTS.md"), `${MANAGED_BLOCK}\n# 旧模板全文\n<!-- TRELLIS-BRAIN-OPS:BEGIN -->\n- **jspace-bootstrap**: x\n<!-- TRELLIS-BRAIN-OPS:END -->\n`);
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("agentsmd.stale_outside_block");
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

test("opencode gbrain wiring via mcp.<name> + environment env_key (issue #12)", () => {
  const wbSkillsDir = join(root, ".jspace", "skills");
  const opencodeCfg = (env: string): string =>
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: { opencodego: { apiKey: "sk-x" } },
      mcp: { gbrain: { type: "local", command: ["/x/gbrain", "serve"], enabled: true, environment: { GBRAIN_SKILLS_DIR: env } } },
    });
  // unwired: environment points elsewhere -> gbrain.skillsdir_unwired
  const unwired = doctorWorkbench(root, stubDeps({ readHarnessConfig: (p) => (p.includes("opencode.json") ? opencodeCfg("/other/skills") : null) }));
  expect(codes(unwired)).toContain("gbrain.skillsdir_unwired");
  // wired: environment.GBRAIN_SKILLS_DIR == wb skills -> no diagnostic (the old
  // top-level mcpServers.gbrain lookup would falsely report this as unwired)
  const wired = doctorWorkbench(root, stubDeps({ readHarnessConfig: (p) => (p.includes("opencode.json") ? opencodeCfg(wbSkillsDir) : null) }));
  expect(codes(wired)).not.toContain("gbrain.skillsdir_unwired");
});

test("cursor skills thin-links: all linked -> none; missing -> cursor.skills_unlinked (info)", () => {
  const allLinked = stubDeps({ cursorSkillsLinked: () => true });
  expect(codes(doctorWorkbench(root, allLinked))).not.toContain("cursor.skills_unlinked");
  const someMissing = stubDeps({ cursorSkillsLinked: (n) => n !== "memory-writeback" });
  const r = doctorWorkbench(root, someMissing);
  expect(codes(r)).toContain("cursor.skills_unlinked");
  const d = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics.find((x) => x.code === "cursor.skills_unlinked");
  expect(d?.severity).toBe("info");
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

test("Pi installed + active without jspace session-start extension -> harness.session_start_not_wired (issue #13)", () => {
  mkdirSync(join(root, ".pi"), { recursive: true });
  const piSettings = JSON.stringify({ packages: ["npm:pi-hooks"] });
  const r = doctorWorkbench(
    root,
    stubDeps({
      readHarnessConfig: (p) => {
        if (p.endsWith("settings.json") && p.includes(".pi")) return piSettings;
        return null;
      },
    }),
  );
  const c = codes(r);
  expect(c).toContain("harness.session_start_not_wired");
  const d = (r.data as { diagnostics: { code: string; path: string }[] }).diagnostics.find((x) => x.code === "harness.session_start_not_wired");
  expect(d?.path).toBe("harness.pi");
});

test("Pi installed but not active -> no harness.session_start_not_wired (no cross-harness noise)", () => {
  const piSettings = JSON.stringify({ packages: ["npm:pi-hooks"] });
  const r = doctorWorkbench(
    root,
    stubDeps({
      readHarnessConfig: (p) => (p.endsWith("settings.json") && p.includes(".pi") ? piSettings : null),
    }),
  );
  expect(codes(r)).not.toContain("harness.session_start_not_wired");
});

test("Pi session-start extension wired + active -> no harness.session_start_not_wired (issue #13)", () => {
  mkdirSync(join(root, ".pi"), { recursive: true });
  const piSettings = JSON.stringify({ packages: ["npm:pi-hooks"] });
  const piExt = "// jspace context session-start\n";
  const r = doctorWorkbench(
    root,
    stubDeps({
      readHarnessConfig: (p) => {
        if (p.endsWith("settings.json") && p.includes(".pi")) return piSettings;
        if (p.endsWith("index.ts") && p.includes(".pi")) return piExt;
        return null;
      },
    }),
  );
  expect(codes(r)).not.toContain("harness.session_start_not_wired");
});

test("briefing missing/old -> briefing.stale; recent -> none (issue #13)", () => {
  // a wired workbench seed is the signal that session-start should be running
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "jspace context session-start", timeout: 10 }] }] } }),
  );
  expect(codes(doctorWorkbench(root, stubDeps()))).toContain("briefing.stale");
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "briefing.json"),
    JSON.stringify({ schema_version: 1, last_session_start_at: new Date().toISOString(), session_count: 1 }),
  );
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain("briefing.stale");
});

// Write-back habit gate (E). Fixtures are briefing state only: no gbrain page
// with source:session is ever created here — faking provenance would make the
// very metric retro check 1 measures meaningless.
const HABIT = "memory.writeback_habit_unverified";
function setBriefing(state: Record<string, unknown>): void {
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "briefing.json"),
    JSON.stringify({ schema_version: 1, last_session_start_at: new Date().toISOString(), ...state }),
  );
}

test("no briefing -> no writeback habit gate (a fresh workbench is never nagged)", () => {
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(HABIT);
});

test("session_count below threshold -> no writeback habit gate", () => {
  setBriefing({ session_count: 3, writeback_nudge_for_session: 3 });
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(HABIT);
});

test("nudge never claimed -> no writeback habit gate (that is a wiring question)", () => {
  setBriefing({ session_count: 5 });
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(HABIT);
  setBriefing({ session_count: 5, writeback_nudge_for_session: 0 });
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(HABIT);
});

test("sessions past threshold with a nudge spent -> memory.writeback_habit_unverified (info)", () => {
  setBriefing({ session_count: 5, writeback_nudge_for_session: 2 });
  const r = doctorWorkbench(root, stubDeps());
  expect(codes(r)).toContain(HABIT);
  const d = (r.data as { diagnostics: { code: string; severity: string; path: string; message: string }[] }).diagnostics.find((x) => x.code === HABIT);
  expect(d?.severity).toBe("info"); // never warning: an all-manual cadence is legitimate
  expect(d?.path).toBe("memory.writeback");
  expect(d?.message).toContain("「收工」");
  expect(d?.message).toContain("memory-writeback");
  expect(d?.message).toContain("gbrain list --type note --tag source:session -n 20");
  expect(d?.message).toContain("workbench-retro check 1");
  // doctor cannot measure the rate, so it must not claim it did
  expect(d?.message).toContain("doctor never queries gbrain");
  expect(d?.message).toContain("never writes gbrain");
});

test("writeback habit gate never fails doctor and is verbose-only in human output", () => {
  setBriefing({ session_count: 20, writeback_nudge_for_session: 20 });
  const quiet = doctorWorkbench(root, stubDeps());
  expect(quiet.exitCode ?? 0).toBe(0);
  expect((quiet.warnings ?? []).some((w) => w.includes("source:session"))).toBe(false);
  expect(quiet.lines.some((l) => l.includes("source:session"))).toBe(false);
  const verbose = doctorWorkbench(root, stubDeps(), true);
  expect(verbose.lines.some((l) => l.includes("source:session"))).toBe(true);
});

const LEDGER = "usage.mileage_ledger_missing";

test("no ledger template -> no usage mileage ledger hint", () => {
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(LEDGER);
});

test("ledger template present but instance missing -> usage.mileage_ledger_missing (info)", () => {
  const templatePath = join(root, ".jspace", "skills", "jspace-use", "references", "usage-mileage-ledger-template.md");
  mkdirSync(join(templatePath, ".."), { recursive: true });
  writeFileSync(templatePath, "# template\n");
  const r = doctorWorkbench(root, stubDeps(), true);
  expect(codes(r)).toContain(LEDGER);
  const d = (r.data as { diagnostics: { code: string; severity: string; path: string }[] }).diagnostics.find((x) => x.code === LEDGER);
  expect(d?.severity).toBe("info");
  expect(d?.path).toBe("usage.mileage");
});

test("ledger instance present -> no usage mileage ledger hint", () => {
  const templatePath = join(root, ".jspace", "skills", "jspace-use", "references", "usage-mileage-ledger-template.md");
  const instancePath = join(root, ".jspace", "usage-mileage-ledger.md");
  mkdirSync(join(templatePath, ".."), { recursive: true });
  writeFileSync(templatePath, "# template\n");
  writeFileSync(instancePath, "# instance\n");
  expect(codes(doctorWorkbench(root, stubDeps()))).not.toContain(LEDGER);
});

test("usage mileage ledger hint never fails doctor", () => {
  const templatePath = join(root, ".jspace", "skills", "jspace-use", "references", "usage-mileage-ledger-template.md");
  mkdirSync(join(templatePath, ".."), { recursive: true });
  writeFileSync(templatePath, "# template\n");
  const quiet = doctorWorkbench(root, stubDeps());
  expect(quiet.exitCode ?? 0).toBe(0);
  expect(quiet.lines.some((l) => l.includes("usage-mileage-ledger"))).toBe(false);
  const verbose = doctorWorkbench(root, stubDeps(), true);
  expect(verbose.lines.some((l) => l.includes("usage-mileage-ledger"))).toBe(true);
});

test("journal link mode=copy -> skills.copy_fallback info (fallback stays visible, issue #39)", () => {
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
  writeFileSync(
    join(root, ".jspace", "state", "materialized.json"),
    JSON.stringify({
      schema_version: 2,
      asset_version: "v1",
      applied_at: "2026-09-05",
      files: {},
      links: { ".claude/skills/jspace-use": { target: "../../.jspace/skills/jspace-use", mode: "copy" } },
    }),
  );
  const r = doctorWorkbench(root, stubDeps());
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const diag = diags.find((d) => d.code === "skills.copy_fallback");
  expect(diag).toBeDefined();
  expect(diag!.severity).toBe("info");
  expect(diag!.message).toContain(".claude/skills/jspace-use");
});

test("user-level real copy + projection -> duplicate_roots; dangling link -> user_link_broken (issue #39)", () => {
  const userSkills = join(root, "fake-home", ".agents", "skills");
  // asset-ingest: real dir at user level AND a workbench projection visible
  mkdirSync(join(userSkills, "asset-ingest"), { recursive: true });
  writeFileSync(join(userSkills, "asset-ingest", "SKILL.md"), "user copy");
  mkdirSync(join(root, ".claude", "skills", "asset-ingest"), { recursive: true });
  // memory-recall: dangling link (target moved / workbench unmounted)
  symlinkSync(join(userSkills, "moved-away-ssot"), join(userSkills, "memory-recall"), "dir");
  const r = doctorWorkbench(root, stubDeps({ userSkillsRoot: () => userSkills }));
  const c = codes(r);
  expect(c).toContain("skills.duplicate_roots");
  expect(c).toContain("skills.user_link_broken");
});

test("healthy user-level dir links produce no duplicate/broken diagnostics (issue #39)", () => {
  const userSkills = join(root, "fake-home", ".agents", "skills");
  mkdirSync(userSkills, { recursive: true });
  for (const name of ["jspace-use", "asset-ingest"]) {
    const ssot = join(root, ".jspace", "skills", name);
    mkdirSync(ssot, { recursive: true });
    symlinkSync(ssot, join(userSkills, name), "dir");
  }
  const r = doctorWorkbench(root, stubDeps({ userSkillsRoot: () => userSkills }));
  const c = codes(r);
  expect(c).not.toContain("skills.duplicate_roots");
  expect(c).not.toContain("skills.user_link_broken");
});

test("a retired official skill still materialized -> skills.retired_present (warning)", () => {
  // The machine ran `jspace update` (binary only) and never the follow-up that
  // materializes the skill layer, so a name we deleted keeps being injected.
  const userSkills = join(root, "fake-home", ".agents", "skills");
  mkdirSync(join(userSkills, "jspace-bootstrap"), { recursive: true });
  writeFileSync(join(userSkills, "jspace-bootstrap", "SKILL.md"), "# old");
  // also as a dangling link in a workbench projection: still residue
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  symlinkSync(join(root, "gone"), join(root, ".claude", "skills", "jspace-bootstrap"), "dir");

  const r = doctorWorkbench(root, stubDeps({ userSkillsRoot: () => userSkills }));
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const d = diags.find((x) => x.code === "skills.retired_present");
  expect(d).toBeDefined();
  expect(d!.severity).toBe("warning");
  expect(d!.message).toContain("~/.agents/skills/jspace-bootstrap");
  expect(d!.message).toContain(".claude/skills/jspace-bootstrap");
  expect(d!.message).toContain("jspace workspace upgrade");
});

test("no retired residue -> no skills.retired_present", () => {
  const userSkills = join(root, "fake-home", ".agents", "skills");
  mkdirSync(join(userSkills, "harness-config"), { recursive: true }); // user/global skill, not retired
  const r = doctorWorkbench(root, stubDeps({ userSkillsRoot: () => userSkills }));
  expect(codes(r)).not.toContain("skills.retired_present");
});

// ---- machine-global governance detection (injected temp home only) ---------

const GOVERNANCE_BODY = [
  "# Global governance",
  "## 1. 安全与隐私红线(最高优先级)",
  "## 2. 决策原则",
  "## 3. 维护约定",
].join("\n");

function writeGovernanceSource(home: string, body = GOVERNANCE_BODY): string {
  const declared = loadCapabilities().global_governance.source;
  const source = join(home, declared.replace(/^~\//, ""));
  mkdirSync(join(source, ".."), { recursive: true });
  writeFileSync(source, body);
  return source;
}

function governanceCodes(result: CmdResult): string[] {
  return codes(result).filter((code) => code.startsWith("governance."));
}

test("governance check is inert when globalGovernanceHome is not injected", () => {
  expect(governanceCodes(doctorWorkbench(root, stubDeps()))).toEqual([]);
});

test("missing global governance source -> one source_missing warning, no wiring noise", () => {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const r = doctorWorkbench(
    root,
    stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: () => true }),
  );
  expect(governanceCodes(r)).toEqual(["governance.source_missing"]);
  const diag = (r.data as { diagnostics: { code: string; severity: string }[] }).diagnostics.find(
    (d) => d.code === "governance.source_missing",
  );
  expect(diag?.severity).toBe("warning");
});

test("missing required governance topics -> one core_missing warning listing every topic", () => {
  const home = join(root, "home");
  writeGovernanceSource(home, "# Global governance\n## 安全与隐私红线\n");
  const r = doctorWorkbench(
    root,
    stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: () => false }),
  );
  const diags = (r.data as { diagnostics: { code: string; severity: string; message: string }[] }).diagnostics;
  const governance = diags.filter((d) => d.code === "governance.core_missing");
  expect(governance).toHaveLength(1);
  expect(governance[0]!.severity).toBe("warning");
  expect(governance[0]!.message).toContain("决策原则");
  expect(governance[0]!.message).toContain("维护约定");
});

test("healthy governance source + Claude import + Codex/Pi symlinks -> no governance diagnostics", () => {
  const home = join(root, "home");
  const source = writeGovernanceSource(home);
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "@~/.agents/AGENTS.md\n");
  mkdirSync(join(home, ".codex"), { recursive: true });
  symlinkSync(source, join(home, ".codex", "AGENTS.md"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  symlinkSync(source, join(home, ".pi", "agent", "AGENTS.md"));

  const r = doctorWorkbench(root, stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: () => true }));
  expect(governanceCodes(r)).toEqual([]);
});

test("installed Claude with a missing governance entry -> harness_unwired warning", () => {
  const home = join(root, "home");
  writeGovernanceSource(home);
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]); // claude is a cron harness here
  const r = doctorWorkbench(
    root,
    stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: (name) => name === "claude" }),
  );
  expect(governanceCodes(r)).toEqual(["governance.harness_unwired"]);
  expect(severityOf(r, "governance.harness_unwired")).toBe("warning");
  const diag = (r.data as { diagnostics: { code: string; message: string }[] }).diagnostics.find(
    (d) => d.code === "governance.harness_unwired",
  );
  expect(diag?.message).toContain("run harness-config");
});

test("harness on PATH but not scheduled here -> governance.harness_unwired is info, never a warning (issue #52)", () => {
  // The old range was "binary is on PATH", so a workbench the user runs with one
  // harness warned about every other installed harness. harness.ts had already
  // settled the range as cron-enabled; governance now matches it.
  const home = join(root, "home");
  writeGovernanceSource(home);
  const deps = stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: (name) => name === "claude" });
  const idle = doctorWorkbench(root, deps);
  expect(governanceCodes(idle)).toEqual(["governance.harness_unwired"]);
  expect(severityOf(idle, "governance.harness_unwired")).toBe("info");

  // scheduled -> the same finding becomes actionable
  setCrons([{ id: "inbox-tidy", schedule: "0 21 * * *", enabled: true }]);
  expect(severityOf(doctorWorkbench(root, deps), "governance.harness_unwired")).toBe("warning");
});

test("uninstalled harnesses produce no governance wiring diagnostics", () => {
  const home = join(root, "home");
  writeGovernanceSource(home);
  const r = doctorWorkbench(
    root,
    stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: () => false }),
  );
  expect(governanceCodes(r)).toEqual([]);
});

test("manual and unverified global contexts are skipped without diagnostics", () => {
  const home = join(root, "home");
  writeGovernanceSource(home);
  const r = doctorWorkbench(
    root,
    stubDeps({
      globalGovernanceHome: () => home,
      harnessBinOnPath: (name) => name === "cursor" || name === "grok" || name === "opencode",
    }),
  );
  expect(governanceCodes(r)).toEqual([]);
});

test("non-empty Codex AGENTS.override.md shadows a wired AGENTS.md and is validated", () => {
  const home = join(root, "home");
  const source = writeGovernanceSource(home);
  mkdirSync(join(home, ".codex"), { recursive: true });
  symlinkSync(source, join(home, ".codex", "AGENTS.md"));
  const override = join(home, ".codex", "AGENTS.override.md");
  writeFileSync(override, "# local override without the governance import\n");

  const deps = stubDeps({ globalGovernanceHome: () => home, harnessBinOnPath: (name) => name === "codex" });
  const shadowed = doctorWorkbench(root, deps);
  expect(governanceCodes(shadowed)).toEqual(["governance.harness_unwired"]);
  const diag = (shadowed.data as { diagnostics: { code: string; message: string }[] }).diagnostics.find(
    (d) => d.code === "governance.harness_unwired",
  );
  expect(diag?.message).toContain("AGENTS.override.md shadows AGENTS.md");

  writeFileSync(override, "");
  expect(governanceCodes(doctorWorkbench(root, deps))).toEqual([]);
});
