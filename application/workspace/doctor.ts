// application/workspace/doctor.ts — `jspace doctor` use case.
// Business logic moved out of cli/cmds.ts cmdDoctor. Cron checks are injected
// (cli/cron.ts still owns the scheduler surface until Child C); everything here
// is read-only diagnostics with severity-tagged output. JSON output carries the
// full diagnostics (code/severity/path) so scripts can classify errors.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import type { RegistryDiagnostic } from "../../core/contracts/diagnostics.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { inspectWorkbench, type InspectEnv } from "../../core/registry/inspect.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../core/registry/effective.ts";
import { readIncidents } from "../automation/incidents.ts";
import { countInbox } from "../registry/inbox.ts";
import { readEnvelopes } from "../pending/envelope.ts";
import { isFile } from "../fs.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { readMaterializedJournal } from "./journal.ts";
import { SKILL_PROJECTIONS } from "./manifest.ts";
import { gbrainServer, gbrainSkillsDirWired } from "../gbrain/wiring.ts";

/** Minimal cron view consumed by doctor; full cron surface lives in Child C. */
export interface CronLike {
  id: string;
  schedule: string;
  enabled: boolean;
}

export interface CronHealthDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  parseSchedule: (schedule: string) => unknown;
  installedCronIds: (root: string) => string[];
  linuxCronHealth: () => { crontab: boolean; service: boolean };
  /** Official workbench skill names (SKILLS_MANIFEST.workbench). Injected from
   *  cli so doctor stays free of the embedded-bundle module. */
  officialSkillNames: () => string[];
  /** Parsed ~/.claude.json (user machine config), or null when missing/invalid.
   *  Injected so doctor can check the gbrain MCP skills-dir wiring without
   *  touching the machine-level file itself. */
  readUserClaudeJson?: () => unknown | null;
}

// Retirement thresholds (design §5). Deliberately conservative: mtime is
// rewritten by git clone / cloud-sync, so a false "stale" would be noise.
// These are info-level "take a look", never an assertion that something died.
const DOMAIN_DORMANT_DAYS = 90;
const PROJECT_STALE_DAYS = 120;

/** Newest mtime (epoch ms) under a directory tree, or 0 when unreadable/empty.
 *  Missing dir degrades to 0 (never throws — diagnostics are read-only). */
function lastActivityMs(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (st.mtimeMs > newest) {
        newest = st.mtimeMs;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

/** Relative paths of files whose bytes differ between two sibling trees.
 *  Files present in only one tree also count as drift (the copies must be
 *  byte-identical, so a file in either copy but not the other is a divergence).
 *  Never throws: unreadable or missing siblings degrade to "differs". */
function diffDirs(a: string, b: string): string[] {
  const out: string[] = [];
  // Collect every file rel under a tree (dotfiles skipped, matching the rest
  // of doctor's scanning). Missing root degrades to an empty set.
  const files = (base: string): Set<string> => {
    const set = new Set<string>();
    const walk = (dir: string, rel = ""): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.startsWith(".")) continue;
        if (name === "__pycache__") continue; // python bytecode, written at runtime into only one copy
        const relPath = rel ? `${rel}/${name}` : name;
        const p = join(dir, name);
        let isDir: boolean;
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          continue;
        }
        if (isDir) walk(p, relPath);
        else set.add(relPath);
      }
    };
    if (existsSync(base)) walk(base);
    return set;
  };
  const relsA = files(a);
  const relsB = files(b);
  for (const rel of new Set([...relsA, ...relsB])) {
    let ba: Buffer;
    try {
      ba = readFileSync(join(a, rel));
    } catch {
      out.push(rel); // missing on the other side counts as drift
      continue;
    }
    let bb: Buffer;
    try {
      bb = readFileSync(join(b, rel));
    } catch {
      out.push(rel); // missing on the other side counts as drift
      continue;
    }
    if (!ba.equals(bb)) out.push(rel);
  }
  return out;
}

export function doctorWorkbench(root: string, cron: CronHealthDeps): CmdResult {
  const reads = readWorkbenchState(root);
  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: existsSync,
    isFile,
    readJson: (p) => JSON.parse(readFileSync(p, "utf-8")),
  };
  const diags: RegistryDiagnostic[] = [...inspectWorkbench(env)];

  // filehub asset-layer checks (info for unregistered, warnings for broken/inbox).
  if (reads.hub.status === "ok") {
    const local = reads.local.status === "ok" ? reads.local.value : null;
    const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
    const fhRoot = primaryPathForResourceType(effective, "filehub");
    if (!fhRoot) {
      // unregistered is an unconfigured optional resource (asset-ingest falls
      // back to the degraded staging area by design), not a health problem.
      diags.push({
        severity: "info",
        code: "filehub.unregistered",
        path: "resources",
        message: "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
      });
    } else {
      const inboxDir = join(fhRoot, "_inbox");
      if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
        diags.push({ severity: "warning", code: "filehub.inbox_missing", path: `filehub.${fhRoot}`, message: `filehub: _inbox missing: ${inboxDir}` });
      } else {
        const unfiled = countInbox(inboxDir);
        if (unfiled > 0) {
          diags.push({ severity: "warning", code: "filehub.inbox_unfiled", path: `filehub.${fhRoot}`, message: `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")` });
        }
      }
      // actionable pending gbrain writes (staged needs apply; terminal_failed
      // needs ack). applied/acked no longer alert.
      const actionable = readEnvelopes(fhRoot).filter((e) => e.status === "staged" || e.status === "terminal_failed");
      if (actionable.length > 0) {
        diags.push({ severity: "warning", code: "filehub.pending_applies", path: `filehub.${fhRoot}/.jspace-logs`, message: `filehub: ${actionable.length} actionable pending gbrain write(s); apply with "jspace pending apply", ack terminal_failed with "jspace pending ack"` });
      }
    }
  }

  // orphan skill dirs under .jspace/skills/ (official managed area). A directory
  // that is neither an official workbench skill nor recorded in the materialization
  // journal is a leftover from a removed/renamed skill (e.g. a pre-journal init).
  // It does not affect the new bundle and upgrade won't touch it (no journal base),
  // so surface it as a warning for manual removal or ignore. Root skills/
  // (user-created) is never scanned.
  {
    const official = new Set(cron.officialSkillNames());
    let recorded = new Set<string>();
    try {
      const j = readMaterializedJournal(root);
      if (j) recorded = new Set(Object.keys(j.files));
    } catch {
      // damaged journal: orphan detection skipped (workspace diff/upgrade report it)
    }
    const skillsDir = join(root, CONFIG_DIR, "skills");
    if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
      for (const name of readdirSync(skillsDir)) {
        if (official.has(name)) continue;
        if (name.startsWith(".")) continue;
        const p = join(skillsDir, name);
        if (!statSync(p).isDirectory()) continue;
        const rel = `${CONFIG_DIR}/skills/${name}`;
        const isRecorded = [...recorded].some((r) => r === rel || r.startsWith(`${rel}/`));
        if (isRecorded) continue;
        diags.push({
          severity: "warning",
          code: "skills.orphan_dir",
          path: `skills.${name}`,
          message: `orphan skill dir: .jspace/skills/${name} (not in the current bundle and no journal record; if not user-created, remove it manually)`,
        });
      }
    }
  }

  // Claude Code discovers the workbench context only via a CLAUDE.md that
  // imports @AGENTS.md (it reads CLAUDE.md, not AGENTS.md natively). A missing
  // or non-importing pointer keeps the whole routing layer invisible to claude
  // sessions. Warning: the fix is a workspace upgrade re-creating the seed file.
  {
    const claudeMd = join(root, "CLAUDE.md");
    let pointerOk = existsSync(claudeMd) && statSync(claudeMd).isFile();
    if (pointerOk) {
      try {
        // @AGENTS.md import (official syntax); @./AGENTS.md is the same path
        // written relative, also legal.
        pointerOk = /@(?:\.\/)?AGENTS\.md/.test(readFileSync(claudeMd, "utf-8"));
      } catch {
        pointerOk = false;
      }
    }
    if (!pointerOk) {
      diags.push({
        severity: "warning",
        code: "claude.pointer_missing",
        path: "CLAUDE.md",
        message: "CLAUDE.md missing or does not import @AGENTS.md; Claude Code cannot see the workbench context (run jspace workspace upgrade to re-create the seed file; irrelevant if you use a non-Claude harness)",
      });
    }
  }

  // Context hook wiring: the seed .claude/settings.json registers the
  // `jspace context` SessionStart/UserPromptSubmit hooks. A settings.json that
  // exists but lacks them means the user edited the seed file — upgrade will
  // preserve it (skip), so the hooks stay unwired until merged by hand.
  {
    const settingsPath = join(root, ".claude", "settings.json");
    if (existsSync(settingsPath) && statSync(settingsPath).isFile()) {
      try {
        const wired = readFileSync(settingsPath, "utf-8").includes("jspace context");
        if (!wired) {
          diags.push({
            severity: "warning",
            code: "hooks.not_wired",
            path: ".claude/settings.json",
            message: ".claude/settings.json exists but lacks the jspace context hooks; upgrade preserves a user-edited seed file (skip) — merge the hooks manually or restore the seed file",
          });
        }
      } catch {
        // unreadable settings: skip (doctor already surfaces broken configs)
      }
    }
  }

  // Official skills materialize to .jspace/skills/ (source of truth) plus
  // byte-identical harness projections under each SKILL_PROJECTIONS dir. Drift
  // means a harness sees a stale skill while diff/upgrade still treats the
  // source as current — surface it so the copies can be reconciled. A projection
  // dir that was never materialized (pre-projection template, upgrade pending)
  // is NOT drift — workspace diff shows the pending creates. Only a projection
  // that has a journal record (was materialized once) but is now missing or
  // differs counts as drift.
  {
    // projection dirs recorded in the journal = were materialized at some point
    const projRecorded = new Map<string, Set<string>>();
    for (const proj of SKILL_PROJECTIONS) projRecorded.set(proj, new Set());
    try {
      const j = readMaterializedJournal(root);
      if (j) {
        for (const rel of Object.keys(j.files)) {
          for (const proj of SKILL_PROJECTIONS) {
            const re = new RegExp(`^${proj.replace(/\./g, "\\.")}/([^/]+)(?:/|$)`);
            const m = re.exec(rel);
            if (m) projRecorded.get(proj)!.add(m[1]);
          }
        }
      }
    } catch {
      // damaged journal: nothing recorded as materialized; diff/upgrade report it
    }
    for (const proj of SKILL_PROJECTIONS) {
      for (const name of cron.officialSkillNames()) {
        const sourceDir = join(root, CONFIG_DIR, "skills", name);
        const projDir = join(root, proj, name);
        if (!existsSync(sourceDir)) continue; // source gone: diff/upgrade report the create
        if (!existsSync(projDir)) {
          if (!projRecorded.get(proj)!.has(name)) continue; // never materialized -> not drift
          diags.push({
            severity: "warning",
            code: "skills.projection_drift",
            path: `${proj}.${name}`,
            message: `skill projection drift: ${proj}/${name} is missing entirely (it was materialized before; run jspace workspace upgrade to re-create it)`,
          });
          continue;
        }
        const diffs = diffDirs(sourceDir, projDir);
        if (diffs.length === 0) continue;
        diags.push({
          severity: "warning",
          code: "skills.projection_drift",
          path: `${proj}.${name}`,
          message: `skill projection drift: ${proj}/${name} differs from .jspace/skills/${name} (${diffs.slice(0, 3).join(", ")}${diffs.length > 3 ? ", …" : ""}); jspace workspace upgrade refreshes unmodified copies, user edits are preserved (check jspace workspace diff)`,
        });
      }
    }
  }

  // Legacy layout check: before official skills moved under .jspace/skills/,
  // init also materialized them into root skills/. Those stale copies are
  // invisible to diff/upgrade (no journal record) and shadow the current tree.
  // Matched against current official names plus known historical names (e.g.
  // jspace-bootstrap, renamed to jspace-use in v1.0.9) — a pre-rename leftover
  // would otherwise be invisible forever. User-created root skills (any other
  // name) are untouched, per the "root skills/ is user-created" contract.
  {
    const official = new Set([...cron.officialSkillNames(), "jspace-bootstrap"]);
    const rootSkills = join(root, "skills");
    if (existsSync(rootSkills) && statSync(rootSkills).isDirectory()) {
      for (const name of readdirSync(rootSkills)) {
        if (name.startsWith(".")) continue;
        if (!official.has(name)) continue;
        const p = join(rootSkills, name);
        if (!statSync(p).isDirectory()) continue;
        diags.push({
          severity: "warning",
          code: "skills.legacy_root_copy",
          path: `skills.${name}`,
          message: `legacy copy of official skill in root skills/: skills/${name} (official skills live under .jspace/skills/; if not user-created, remove it manually)`,
        });
      }
    }
  }

  // Long-term-use health (info level, design §5): dormant domains and stale
  // filehub projects. These are "take a look" nudges, never assertions — mtime
  // is rewritten by git clone / cloud-sync, so thresholds stay conservative.
  {
    const now = Date.now();
    // domain.dormant: workspace/<d>/ has no file touched within the window.
    const workspaceDir = join(root, "workspace");
    if (existsSync(workspaceDir) && statSync(workspaceDir).isDirectory()) {
      for (const name of readdirSync(workspaceDir)) {
        if (name.startsWith(".")) continue;
        const p = join(workspaceDir, name);
        if (!statSync(p).isDirectory()) continue;
        const last = lastActivityMs(p);
        if (last === 0) continue; // empty/unreadable: nothing to judge
        const days = (now - last) / 86_400_000;
        if (days >= DOMAIN_DORMANT_DAYS) {
          diags.push({
            severity: "info",
            code: "domain.dormant",
            path: `domain.${name}`,
            message: `domain workspace/${name} has not been touched in ${Math.round(days)}d (≥${DOMAIN_DORMANT_DAYS}d); archive/merge or update it — see jspace-use 8.6`,
          });
        }
      }
    }
    // filehub.project_stale: a registered filehub with a projects/<x>/ dir
    // untouched within the window (candidate for archive/<年>/).
    if (reads.hub.status === "ok") {
      const readsLocal = reads.local.status === "ok" ? reads.local.value : null;
      const effective = resolveEffectiveRegistry(reads.hub.value, readsLocal, { pathExists: existsSync });
      const fhRoot = primaryPathForResourceType(effective, "filehub");
      if (fhRoot) {
        const projectsDir = join(fhRoot, "projects");
        if (existsSync(projectsDir) && statSync(projectsDir).isDirectory()) {
          for (const name of readdirSync(projectsDir)) {
            if (name.startsWith(".")) continue;
            const p = join(projectsDir, name);
            if (!statSync(p).isDirectory()) continue;
            const last = lastActivityMs(p);
            if (last === 0) continue;
            const days = (now - last) / 86_400_000;
            if (days >= PROJECT_STALE_DAYS) {
              diags.push({
                severity: "info",
                code: "filehub.project_stale",
                path: `filehub.projects.${name}`,
                message: `filehub project ${name} untouched for ${Math.round(days)}d (≥${PROJECT_STALE_DAYS}d); archive to archive/<年>/ if closed — see jspace-use 8.6`,
              });
            }
          }
        }
      }
    }
  }

  // gbrain skill-routing wiring (info). gbrain's resolver only auto-detects a
  // root `skills/` dir; wire it to the workbench's official skills via
  // GBRAIN_SKILLS_DIR=<wb>/.jspace/skills in ~/.claude.json's gbrain MCP env.
  // Missing/invalid machine config is not a workbench health problem — the
  // wire command handles it — so only report when we can read the config and
  // the value is wrong.
  {
    const wbSkillsDir = join(root, CONFIG_DIR, "skills");
    const doc = cron.readUserClaudeJson?.() ?? null;
    if (doc !== null) {
      const server = gbrainServer(doc);
      if (server !== null && !gbrainSkillsDirWired(server, wbSkillsDir)) {
        diags.push({
          severity: "info",
          code: "gbrain.skillsdir_unwired",
          path: "gbrain",
          message: `gbrain resolver not pointed at this workbench's official skills (${wbSkillsDir}); run jspace gbrain wire to wire GBRAIN_SKILLS_DIR`,
        });
      }
    }
  }

  // cron configuration checks (read-only; warnings only).
  const crons = cron.loadCrons(root).crons;
  for (const c of crons) {
    try {
      cron.parseSchedule(c.schedule);
    } catch {
      diags.push({ severity: "warning", code: "cron.invalid_schedule", path: `cron.${c.id}.schedule`, message: `cron ${c.id}: invalid schedule "${c.schedule}"` });
    }
  }
  if (process.platform === "linux") {
    const health = cron.linuxCronHealth();
    if (!health.crontab) diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "crontab command not found on this system; jspace cron cannot install tasks" });
    if (!health.service) diags.push({ severity: "warning", code: "cron.daemon_stopped", path: "cron", message: "cron daemon not running; scheduled tasks won't fire until it starts" });
  }
  const installedIds = new Set(cron.installedCronIds(root));
  if (crons.length > 0) {
    for (const c of crons) {
      if (c.enabled && !installedIds.has(c.id)) {
        diags.push({ severity: "warning", code: "cron.not_installed", path: `cron.${c.id}`, message: `cron ${c.id} enabled but not installed (run jspace cron install)` });
      }
    }
    for (const id of installedIds) {
      if (!crons.some((c) => c.id === id)) {
        diags.push({ severity: "warning", code: "cron.stale_task", path: `cron.${id}`, message: `stale scheduled task ${id} (cron removed; run jspace cron uninstall)` });
      }
    }
  }
  const incRead = readIncidents(root);
  const openCron = incRead.records.filter((i) => i.status === "open");
  if (openCron.length > 0) {
    diags.push({
      severity: "warning",
      code: "cron.open_incidents",
      path: "cron",
      message: `${openCron.length} open cron incident(s): ${openCron.map((i) => `${i.cronId}[${i.failureClass}]`).join(", ")} (check with jspace cron failures)`,
    });
  }
  for (const issue of incRead.issues) {
    diags.push({
      severity: "warning",
      code: "cron.incident_decode",
      path: `incidents.${issue.path}`,
      message: `incident record unreadable: ${issue.message}`,
    });
  }

  const errors = diags.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diags.filter((d) => d.severity === "warning").map((d) => d.message);
  const infos = diags.filter((d) => d.severity === "info").map((d) => d.message);
  return {
    exitCode: errors.length > 0 ? 1 : undefined,
    lines: [
      `jspace: doctor ${errors.length > 0 ? "failed" : "ok"}: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`,
    ],
    data: { diagnostics: diags, errors, warnings, infos },
    errors,
    warnings,
  };
}
