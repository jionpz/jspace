// application/workspace/doctor.ts — `jspace doctor` use case.
// Business logic moved out of cli/cmds.ts cmdDoctor; cron checks are injected.
// Everything here is read-only diagnostics with severity-tagged output. The
// workbench lifecycle checks live here; cross-domain health checks are factored
// into focused check* functions (one responsibility each) so doctorWorkbench
// only orchestrates + aggregates severity. JSON output carries the full
// diagnostics (code/severity/path) so scripts can classify errors.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import type { RegistryDiagnostic } from "../../core/contracts/diagnostics.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { inspectWorkbench, INVALID_JSON, type InspectEnv } from "../../core/registry/inspect.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../core/registry/effective.ts";
import { readIncidents } from "../automation/incidents.ts";
import { readJournals } from "../ingest/journal.ts";
import { countInbox } from "../registry/inbox.ts";
import { readEnvelopes } from "../pending/envelope.ts";
import { isFile } from "../fs.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { readMaterializedJournal } from "../workspace/journal.ts";
import { skillProjections } from "../workspace/manifest.ts";
import type { HubV1 } from "../../core/contracts/hub.ts";
import { getCapability, loadCapabilities } from "../../adapters/harness/registry.ts";
import { isBriefingStale, readBriefing } from "../context/briefing.ts";
import { binaryOnPath } from "../../adapters/harness/bin.ts";
import type { LinuxCronHealth } from "../../adapters/scheduler/types.ts";

/** Minimal cron view consumed by doctor; full cron surface lives in the scheduler. */
export interface CronLike {
  id: string;
  schedule: string;
  harness?: string; // read by checkHarness (active harness set)
  enabled: boolean;
  /** Present when the cron drives a bundled skill instead of an inline prose
   *  prompt. Read by the legacy-inline-prompt migration check: a contract kept
   *  in cron.json (user data, never overwritten by upgrade) is frozen forever,
   *  while a skill target keeps it in the upgrade-managed skill layer. */
  target?: { skill: string };
  /** Per-cron headless tools override; read by checkCrons for harness support. */
  tools?: string;
}

export interface CronHealthDeps {
  loadCrons: (root: string) => { crons: CronLike[] };
  parseSchedule: (schedule: string) => unknown;
  installedCronIds: (root: string) => string[];
  /** Linux cron health tri-state. `unverifiable` = detection failed in a way
   *  that may be environmental (sandbox / namespace isolation) rather than a
   *  real fault — doctor maps it to info, never warning (issue #10). */
  linuxCronHealth: () => LinuxCronHealth;
  /** Official workbench skill names (SKILLS_MANIFEST.workbench). Injected from
   *  cli so doctor stays free of the embedded-bundle module. */
  officialSkillNames: () => string[];
  /** Skill names whose materialized copy differs from the running bundle.
   *  Injected from cli for the same reason as officialSkillNames (diffBundle
   *  needs BUNDLE_MANIFEST). Omitted => the check is skipped silently. */
  bundleStaleSkills?: (root: string) => string[];
  /** Parsed ~/.claude.json (user machine config), or null when missing/invalid.
   *  Injected so doctor can check the gbrain MCP skills-dir wiring without
   *  touching the machine-level file itself. */
  readUserClaudeJson?: () => unknown | null;
  /** Raw text of a harness's machine config (~/.claude.json / ~/.grok/config.toml),
   *  or null when missing. Used by the multi-harness gbrain wiring check
   *  (issue #8 #16). */
  readHarnessConfig?: (path: string) => string | null;
  /** True when an official skill is thin-linked into Cursor's user-level skills
   *  dir (~/.cursor/skills/<name> → ~/.agents/skills/<name>). Injected from cli
   *  (uses homedir + readlink); doctor reports gaps as info (issue #12). */
  cursorSkillsLinked?: (name: string) => boolean;
  /** Active-harness binary presence (injectable so tests stay deterministic on
   *  machines without the harness CLI installed). Defaults to a real PATH check. */
  harnessBinOnPath?: (name: string) => boolean;
  /** Platform the linux cron-health branch keys on. Defaults to
   *  `process.platform`; injected so tests exercise the linux branch without
   *  mutating the global process.platform (which a future runtime could make
   *  non-configurable — issue #11 P3-4). */
  platform?: string;
}

type WorkbenchReads = ReturnType<typeof readWorkbenchState>;

// Retirement thresholds (design §5). Deliberately conservative: mtime is
// rewritten by git clone / cloud-sync, so a false "stale" would be noise.
// These are info-level "take a look", never an assertion that something died.
const DOMAIN_DORMANT_DAYS = 90;
const PROJECT_STALE_DAYS = 120;

/** End marker of the JSpace managed block in the workbench AGENTS.md. Content
 *  after it is user-owned: upgrade never rewrites it, so only doctor can
 *  surface a pre-block-era template dump left behind there. */
const BLOCK_END = "<!-- JSPACE:END -->";

/** Official skill names that no longer ship. A mention outside the managed
 *  block is proof of stale template residue (jspace-bootstrap was renamed to
 *  jspace-use in v1.0.9). Kept next to the same list used by the legacy
 *  root-copy check. */
const RETIRED_SKILL_NAMES = ["jspace-bootstrap"] as const;

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

/** Registered filehub root for a workbench, or null when unregistered/broken.
 *  Shared by the filehub resource-level, inbox and pending checks. */
function resolveFhRoot(reads: WorkbenchReads): string | null {
  if (reads.hub.status !== "ok") return null;
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  return primaryPathForResourceType(effective, "filehub");
}

/** filehub resource-level health: unregistered (info), _inbox state, stale
 *  projects (info nudge). Read-only; never throws. */
function checkInbox(reads: WorkbenchReads): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const fhRoot = resolveFhRoot(reads);
  if (!fhRoot) {
    // unregistered is an unconfigured optional resource (asset-ingest falls
    // back to the degraded staging area by design), not a health problem.
    diags.push({
      severity: "info",
      code: "filehub.unregistered",
      path: "resources",
      message: "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
    });
    return diags;
  }
  const inboxDir = join(fhRoot, "_inbox");
  if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
    diags.push({ severity: "warning", code: "filehub.inbox_missing", path: `filehub.${fhRoot}`, message: `filehub: _inbox missing: ${inboxDir}` });
  } else {
    const unfiled = countInbox(inboxDir);
    if (unfiled > 0) {
      diags.push({ severity: "warning", code: "filehub.inbox_unfiled", path: `filehub.${fhRoot}`, message: `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")` });
    }
  }
  // stale filehub projects (candidate for archive/<年>/) + unlinked projects
  // (asset dir exists but no hub record). The existing registry checks only go
  // registry -> disk ("is the registered path there?"); this is the reverse
  // direction, which is how the common drift actually happens: a project folder
  // gets created in the file hub and nothing ever registers it, so
  // weekly-report's project discovery silently misses it.
  // Compared against hub.projects[].asset_rel_path only — the domain README
  // project table is prose, and regex-parsing a markdown table would be fragile
  // and false-positive prone. That half is covered by the jspace-use 8.7
  // checklist; doctor guards the machine-decidable half.
  const now = Date.now();
  const registeredAssetPaths = new Set(
    (reads.hub.status === "ok" ? reads.hub.value.projects ?? [] : []).map((p) => p.asset_rel_path),
  );
  const projectsDir = join(fhRoot, "projects");
  if (existsSync(projectsDir) && statSync(projectsDir).isDirectory()) {
    for (const name of readdirSync(projectsDir)) {
      if (name.startsWith(".")) continue;
      const p = join(projectsDir, name);
      if (!statSync(p).isDirectory()) continue;
      if (!registeredAssetPaths.has(`projects/${name}`)) {
        diags.push({
          severity: "info",
          code: "registry.project_unlinked",
          path: `filehub.projects.${name}`,
          message: `filehub project ${name} is not registered in hub.json; weekly-report discovers projects from the registry and the domain README, so an unlinked project stays invisible — see jspace-use 8.7 (jspace project add <ascii-id> --asset-rel-path projects/${name})`,
        });
      }
      const last = lastActivityMs(p);
      if (last === 0) continue;
      const days = (now - last) / 86_400_000;
      if (days >= PROJECT_STALE_DAYS) {
        diags.push({
          severity: "info",
          code: "filehub.project_stale",
          path: `filehub.projects.${name}`,
          message: `filehub project ${name} untouched for ${Math.round(days)}d (≥${PROJECT_STALE_DAYS}d); archive to archive/<年>/ if closed — see jspace-use 8.7 (project lifecycle) / 8.6`,
        });
      }
    }
  }
  return diags;
}

/** Pending gbrain write envelopes: damaged files + actionable (staged /
 *  terminal_failed). Damaged envelopes surface as warnings (visible-degradation). */
function checkPending(reads: WorkbenchReads): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const fhRoot = resolveFhRoot(reads);
  if (!fhRoot) return diags;
  const envRead = readEnvelopes(fhRoot);
  for (const issue of envRead.issues) {
    diags.push({
      severity: "warning",
      code: "filehub.pending_decode",
      path: `filehub.${issue.path}`,
      message: `pending envelope unreadable: ${issue.message}`,
    });
  }
  // actionable pending gbrain writes (staged needs apply; terminal_failed needs
  // ack). applied/acked no longer alert.
  const actionable = envRead.records.filter((e) => e.status === "staged" || e.status === "terminal_failed");
  if (actionable.length > 0) {
    diags.push({ severity: "warning", code: "filehub.pending_applies", path: `filehub.${fhRoot}/.jspace-logs`, message: `filehub: ${actionable.length} actionable pending gbrain write(s); apply with "jspace pending apply", ack terminal_failed with "jspace pending ack"` });
  }
  return diags;
}

/** Ingest journal decode issues: damaged .jspace/state/ingest/*.json surface as
 *  warnings (same visible-degradation rule as damaged pending envelopes — decode
 *  failures must be forwarded, never silently dropped). readJournals already
 *  returns the issues; this is the workbench-root health check for them. */
function checkIngest(root: string): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  for (const issue of readJournals(root).issues) {
    diags.push({
      severity: "warning",
      code: "ingest.journal_decode",
      path: `ingest.${issue.path}`,
      message: `ingest journal unreadable: ${issue.message}`,
    });
  }
  return diags;
}

/** Skill materialization health: orphan dirs, harness projection drift, legacy
 *  root copies, and the claude harness pointer (CLAUDE.md + context hooks). */
function checkSkills(root: string, cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];

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
    for (const proj of skillProjections()) projRecorded.set(proj, new Set());
    try {
      const j = readMaterializedJournal(root);
      if (j) {
        for (const rel of Object.keys(j.files)) {
          for (const proj of skillProjections()) {
            const re = new RegExp(`^${proj.replace(/\./g, "\\.")}/([^/]+)(?:/|$)`);
            const m = re.exec(rel);
            if (m) projRecorded.get(proj)!.add(m[1]);
          }
        }
      }
    } catch {
      // damaged journal: nothing recorded as materialized; diff/upgrade report it
    }
    for (const proj of skillProjections()) {
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
    const official = new Set([...cron.officialSkillNames(), ...RETIRED_SKILL_NAMES]);
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

  // Materialized skills vs the running bundle. skills.projection_drift above
  // only compares workbench-internal copies against .jspace/skills/; nothing
  // told the user that .jspace/skills/ itself lags the installed binary. The
  // cron path already fails on this (compileSkillTarget -> "skill X is out of
  // date"), so a stale workbench surfaced only when a cron happened to run.
  // info, not warning: a locally edited skill legitimately shows as a conflict
  // under the ownership model — nagging about it would punish normal use.
  {
    const stale = cron.bundleStaleSkills?.(root) ?? [];
    if (stale.length > 0) {
      diags.push({
        severity: "info",
        code: "skills.bundle_stale",
        path: "skills",
        message: `official skill(s) differ from the running bundle: ${stale.join(", ")}; run jspace workspace upgrade (it refreshes unmodified copies here and in ~/.agents/skills, and preserves local edits as skip/conflict)`,
      });
    }
  }

  // Stale content OUTSIDE the JSPACE managed block. The block-outside region is
  // user-owned — upgrade never touches it — so a pre-block-era template dump
  // survives forever, injecting a second, contradictory copy of the rules into
  // every session. Only doctor can surface it. Zero-false-positive by design:
  // an AGENTS.md with no JSPACE block is a user-authored file and is not
  // scanned at all; inside a block-bearing file only machine-generated markers
  // and retired official skill names count (never a semantic judgement).
  {
    const agentsPath = join(root, "AGENTS.md");
    const body = isFile(agentsPath) ? readFileSync(agentsPath, "utf-8") : null;
    const endIdx = body?.indexOf(BLOCK_END) ?? -1;
    if (body !== null && endIdx !== -1) {
      const outside = body.slice(endIdx + BLOCK_END.length);
      const hits: string[] = [];
      for (const marker of ["TRELLIS-BRAIN-OPS:BEGIN", "TRELLIS-SKILL-GOV:BEGIN"]) {
        if (outside.includes(marker)) hits.push(`generated block ${marker}`);
      }
      for (const retired of RETIRED_SKILL_NAMES) {
        if (outside.includes(retired)) hits.push(`retired skill name ${retired}`);
      }
      if (hits.length > 0) {
        diags.push({
          severity: "warning",
          code: "agentsmd.stale_outside_block",
          path: "AGENTS.md",
          message: `AGENTS.md carries stale template residue outside the JSPACE block (${hits.join(", ")}); that region is yours — jspace never rewrites it, so a pre-block-era copy keeps injecting contradictory rules. Back the file up, then delete everything after ${BLOCK_END} that you did not write`,
        });
      }
    }
  }

  return diags;
}

/** Long-term-use health (info level, design §5): dormant domains. A "take a
 *  look" nudge, never an assertion — mtime is rewritten by git clone /
 *  cloud-sync, so the threshold stays conservative. Registered domains are
 *  scanned by their hub.json `path` (authority, supports custom --path); a
 *  workspace/* dir that is NOT a registered domain is flagged as residue
 *  (issue #8 #14). */
function checkDomains(root: string, hub: HubV1 | null): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const now = Date.now();
  const registered = new Set((hub?.domains ?? []).map((d) => d.path));
  for (const d of hub?.domains ?? []) {
    const p = join(root, d.path);
    if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    const last = lastActivityMs(p);
    if (last === 0) continue; // empty/unreadable: nothing to judge
    const days = (now - last) / 86_400_000;
    if (days >= DOMAIN_DORMANT_DAYS) {
      diags.push({
        severity: "info",
        code: "domain.dormant",
        path: `domain.${d.id}`,
        message: `domain ${d.path} has not been touched in ${Math.round(days)}d (≥${DOMAIN_DORMANT_DAYS}d); archive/merge or update it — see jspace-use 8.6`,
      });
    }
  }
  // unregistered workspace/* residue (not in hub.domains[].path, and not an
  // ancestor of a registered custom-path domain)
  const workspaceDir = join(root, "workspace");
  if (existsSync(workspaceDir) && statSync(workspaceDir).isDirectory()) {
    for (const name of readdirSync(workspaceDir)) {
      if (name.startsWith(".")) continue;
      const p = join(workspaceDir, name);
      if (!statSync(p).isDirectory()) continue;
      const dirRel = `workspace/${name}`;
      const registeredOrAncestor = [...registered].some((rp) => rp === dirRel || rp.startsWith(`${dirRel}/`));
      if (!registeredOrAncestor) {
        diags.push({
          severity: "warning",
          code: "domain.unregistered",
          path: `domain.${name}`,
          message: `${dirRel} is not a registered domain in hub.json; register it ("jspace domain add") or remove the stale directory`,
        });
      }
    }
  }
  return diags;
}

/** Is a TOML config's `<server_key>` section already pointing GBRAIN_SKILLS_DIR
 *  at the workbench skills dir? (grok's config.toml, issue #8 #16.) Scoped to
 *  the target section only — a sibling server section carrying the same env key
 *  must not mask a missing wire (issue #9 #9-07). */
function tomlSkillsDirWired(toml: string, serverKey: string, wbSkillsDir: string): boolean {
  const lines = toml.split("\n");
  const section = lines.findIndex((l) => l.trim() === `[${serverKey}]`);
  if (section === -1) return false;
  const rest = lines.slice(section + 1);
  const nextHeader = rest.findIndex((l) => /^\s*\[/.test(l));
  const body = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).join("\n");
  const m = body.match(/GBRAIN_SKILLS_DIR\s*=\s*["']([^"']*)["']/);
  return m !== null && m[1] === wbSkillsDir;
}

/** Resolve a dot-path `server_key` (`mcpServers.gbrain`, `mcp.gbrain`) through a
 *  JSON doc — the json branch of checkGBrain mirrors the wire backend instead of
 *  hard-coding the top-level `mcpServers.gbrain` shape (opencode's local servers
 *  live under `mcp.<name>`, issue #12). */
function serverAtKeyPath(doc: unknown, key: string): Record<string, unknown> | null {
  let cur = doc;
  for (const seg of key.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : null;
}

/** True when the server's env (field name per `env_key`, default "env";
 *  opencode uses "environment") already points GBRAIN_SKILLS_DIR at the dir. */
function serverEnvWired(server: Record<string, unknown>, envKey: string, dir: string): boolean {
  const env = server[envKey];
  if (!env || typeof env !== "object") return false;
  return (env as Record<string, unknown>).GBRAIN_SKILLS_DIR === dir;
}

/** gbrain skill-routing wiring (info), for EVERY native-MCP harness that has a
 *  declared config path (capabilities.mcp_config — single source, issue #8 #16).
 *  gbrain's resolver only auto-detects a root `skills/` dir; the wire commands
 *  inject GBRAIN_SKILLS_DIR=<wb>/.jspace/skills into each harness's gbrain MCP
 *  server env. Missing/invalid machine config is not a workbench health problem
 *  — the wire command handles it — so only report when we can read the config
 *  and the value is wrong. */
function checkGBrain(root: string, cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const wbSkillsDir = join(root, CONFIG_DIR, "skills");
  const home = homedir();
  for (const [name, cap] of Object.entries(loadCapabilities().harnesses)) {
    const cfg = cap.mcp_config;
    if (cfg === null) continue; // no wire path declared — nothing to verify
    if (cap.mcp === undefined || !("native" in cap.mcp) || !cap.mcp.native) continue; // adapter-MCP harnesses skip
    const cfgPath = cfg.path.replace("~", home);
    const raw = cron.readHarnessConfig?.(cfgPath);
    if (raw === null || raw === undefined) continue; // unreadable -> wire cmd guides
    const wired =
      cfg.format === "toml"
        ? tomlSkillsDirWired(raw, cfg.server_key, wbSkillsDir)
        : (() => {
            try {
              // Resolve the server via the declared server_key (dot-path) and read
              // the env under the declared env_key — mirrors the wire backend so an
              // already-wired harness is never misreported (issue #12: opencode's
              // local servers live under mcp.<name> with an `environment` field).
              const server = serverAtKeyPath(JSON.parse(raw), cfg.server_key);
              return server !== null && serverEnvWired(server, cfg.env_key ?? "env", wbSkillsDir);
            } catch {
              // unreadable machine config is not a workbench health problem; the
              // wire command repairs it. Report as info instead of crashing the
              // read-only diagnostics (same invariant as cron.file_unreadable).
              diags.push({
                severity: "info",
                code: "gbrain.config_invalid_json",
                path: "gbrain",
                message: `harness config for ${name} is not valid JSON; run ${name === "claude" ? "jspace gbrain wire" : `jspace harness wire --harness ${name}`} to re-wire GBRAIN_SKILLS_DIR`,
              });
              return true; // config unreadable — skip the unwired check below
            }
          })();
    if (!wired) {
      const cmd = name === "claude" ? "jspace gbrain wire" : `jspace harness wire --harness ${name}`;
      diags.push({
        severity: "info",
        code: "gbrain.skillsdir_unwired",
        path: "gbrain",
        message: `gbrain resolver for ${name} not pointed at this workbench's official skills (${wbSkillsDir}); run ${cmd} to wire GBRAIN_SKILLS_DIR`,
      });
    }
  }
  return diags;
}

/** Cursor user-level skills thin-links (issue #12): official skills should be
 *  linked into ~/.cursor/skills/ so the IDE sees them. Missing links are info
 *  (the wire command creates them; doctor only surfaces the gap). */
function checkCursorSkills(cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const linked = cron.cursorSkillsLinked;
  if (!linked) return diags; // not injected — check skipped silently
  const names = cron.officialSkillNames();
  if (names.length === 0) return diags;
  const missing = names.filter((n) => !linked(n));
  if (missing.length === 0) return diags;
  diags.push({
    severity: "info",
    code: "cursor.skills_unlinked",
    path: "cursor",
    message: `Cursor user-level skills missing jspace thin-links: ${missing.join(", ")} (run 'jspace harness wire --harness cursor' after 'jspace skills install')`,
  });
  return diags;
}

/** Cron configuration + scheduler health: schedule parse, linux daemon, enabled
 *  but not installed, stale installed tasks, open/damaged incidents. */
function checkCrons(root: string, cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  let crons: CronLike[];
  try {
    crons = cron.loadCrons(root).crons;
  } catch (e) {
    // schedule is now validated at decode (P2-5): a hand-edited cron.json with
    // a bad schedule fails decode, so doctor reports the file as unreadable
    // instead of crashing (read-only diagnostics must never throw).
    diags.push({ severity: "warning", code: "cron.file_unreadable", path: "cron", message: `cron.json unreadable: ${e instanceof Error ? e.message : String(e)}` });
    crons = [];
  }
  // crontab/daemon health. "missing"/"missing-cmd"/"stopped" = confirmed
  // faults on a verifiable host -> warning; "unverifiable" = detection may have
  // failed due to sandbox / namespace isolation (the host scheduler state is
  // hidden) -> info, never warning (issue #10).
  //
  // installed-state comparison: readable crontab ("ok") -> read installed ids;
  // confirmed empty ("missing" / "missing-cmd") -> treated as empty and still
  // comparable (an enabled cron really is not installed); "unverifiable" -> not
  // comparable (an empty read here proves nothing about the host).
  let installedCheckable = true; // non-linux adapters read their own scheduler
  let installedIds = new Set<string>();
  if ((cron.platform ?? process.platform) === "linux") {
    const health = cron.linuxCronHealth();
    if (health.crontab === "missing-cmd") {
      diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "crontab command not found on this system; jspace cron cannot install tasks" });
    } else if (health.crontab === "missing") {
      diags.push({ severity: "warning", code: "cron.crontab_missing", path: "cron", message: "no crontab installed for this user; jspace cron cannot install tasks (run crontab -e to create one)" });
    } else if (health.crontab === "unverifiable") {
      diags.push({ severity: "info", code: "cron.crontab_unverifiable", path: "cron", message: "cron install state cannot be verified here (sandbox/namespace isolation hides the host crontab); check crontab -l on the host" });
    }
    if (health.service === "stopped") {
      diags.push({ severity: "warning", code: "cron.daemon_stopped", path: "cron", message: "cron daemon not running; scheduled tasks won't fire until it starts" });
    } else if (health.service === "unverifiable") {
      diags.push({ severity: "info", code: "cron.daemon_unverifiable", path: "cron", message: "cron daemon status cannot be verified here (sandbox/namespace isolation hides the host process); check on the host" });
    }
    if (health.crontab === "ok") {
      installedIds = new Set(cron.installedCronIds(root));
    } else if (health.crontab === "missing" || health.crontab === "missing-cmd") {
      installedIds = new Set(); // confirmed no crontab -> installs are empty (comparable)
    }
    installedCheckable = health.crontab !== "unverifiable";
  } else {
    installedIds = new Set(cron.installedCronIds(root));
  }
  if (crons.length > 0) {
    // Legacy inline-prompt contract: cron.json is user data (upgrade never
    // overwrites it), so a contract written into `prompt` is frozen at the
    // version that shipped when the workbench was created. When the cron id
    // matches a bundled skill, the same contract lives in the upgrade-managed
    // skill layer — suggest the migration. Custom crons (ids that are not
    // official skill names) are the intended escape hatch and never match.
    const officialSkills = new Set(cron.officialSkillNames());
    for (const c of crons) {
      if (!c.target && officialSkills.has(c.id)) {
        diags.push({
          severity: "info",
          code: "cron.inline_prompt_legacy",
          path: `cron.${c.id}`,
          message: `cron ${c.id} carries an inline prompt while bundled skill ${c.id} owns the same contract; switch to target: {kind: "skill", skill: "${c.id}", entrypoint: "weekly"} so the contract follows jspace workspace upgrade`,
        });
      }
      if (c.tools && c.harness) {
        try {
          if (!getCapability(c.harness).supports_tool_restriction) {
            diags.push({
              severity: "warning",
              code: "cron.tools_unsupported_harness",
              path: `cron.${c.id}`,
              message: `cron ${c.id} sets tools but harness ${c.harness} does not support tool restriction; cron run will fail until tools is removed or harness is changed`,
            });
          }
        } catch {
          // unknown harness is reported by checkHarness
        }
      }
    }
    // enabled/installed + stale-task judgement requires a readable crontab;
    // when it is missing/unverifiable these checks cannot judge installs and
    // the health diagnostic above already reports the state (issue #10).
    if (installedCheckable) {
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
  return diags;
}

/** Harness support health for the ACTIVE harnesses (the cron.json harness values
 *  of this workbench). Active-only by design: a full matrix scan of every
 *  capability (grok/opencode/pi/cursor) would warn "not installed" for harnesses
 *  the user never selected — noise, not signal. The check surfaces (a) an
 *  unknown harness key (capabilities drift), (b) a missing binary for a headless
 *  harness the workbench actually schedules, and (c) the Pi adapter hint (honest boundary):
 *  pi has no native MCP — when the pi CLI is present we nudge the optional
 *  pi-mcp-adapter extension with an inline supply-chain warning (never auto-
 *  install; npm packages execute on install). */
function checkHarness(root: string, cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  let crons: CronLike[];
  try {
    crons = cron.loadCrons(root).crons;
  } catch {
    return diags; // cron.json unreadable -> checkCrons reports it (read-only, never throw)
  }
  const caps = loadCapabilities();
  const binOnPath = cron.harnessBinOnPath ?? ((name: string) => binaryOnPath(name, cron.platform ?? process.platform));
  const active = new Set<string>();
  // only ENABLED crons decide harness-bin health — a disabled cron whose harness
  // is missing must not alarm (issue #8 #22).
  for (const c of crons) if (c.harness && c.enabled) active.add(c.harness);
  for (const name of active) {
    const cap = caps.harnesses[name];
    if (!cap) {
      diags.push({ severity: "warning", code: "harness.unknown", path: `harness.${name}`, message: `cron harness ${name} is not in capabilities.yaml; run jspace update and check cron.json` });
      continue;
    }
    if (cap.headless !== null && !binOnPath(name)) {
      diags.push({ severity: "warning", code: "harness.bin_missing", path: `harness.${name}`, message: `cron harness ${name} binary not found on PATH; scheduled runs will fail (install the harness CLI)` });
    }
    // Pi adapter hint (honest boundary): install path only, never auto-install. Info-level (not a
    // health problem — CLI access to gbrain works without the extension), and
    // the supply-chain warning rides along so a copy-pasted install is checked.
    if (name === "pi" && binOnPath(name)) {
      diags.push({
        severity: "info",
        code: "harness.pi_mcp_adapter",
        path: "harness.pi",
        message: "Pi has no native MCP; gbrain works via the CLI. Optionally install pi-mcp-adapter for MCP access (MANUAL install, npm executes package code — verify source first; see harness-pi.md)",
      });
    }
  }
  return diags;
}

/** Session-start briefing behavior checks (issue #13): the file-level doctor
 *  checks were not enough — a workbench can be perfectly materialized while the
 *  hook that should run `jspace context session-start` is missing/stale. This
 *  check surfaces that gap plus the machine-side briefing timestamp. */
function checkSessionStartHooks(root: string, cron: CronHealthDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const caps = loadCapabilities();
  const home = homedir();

  // Active/selected harness signals. To avoid cross-harness noise, machine-level
  // Pi is only checked when this workbench actually uses Pi (enabled cron or a
  // project .pi directory); workbench-level seeds are checked only when the seed
  // file exists.
  const activeCron = new Set<string>();
  try {
    for (const c of cron.loadCrons(root).crons) {
      if (c.harness && c.enabled) activeCron.add(c.harness);
    }
  } catch {
    // cron.json unreadable -> checkCrons reports it; no active signal here.
  }
  const piActive = activeCron.has("pi") || existsSync(join(root, ".pi"));
  let anySessionStartSignal = false;

  for (const [name, cap] of Object.entries(caps.harnesses)) {
    const ss = cap.session_start;
    if (!ss) continue;
    const hasStart = cap.sessions.some((s) => /session.?start/i.test(s.name));
    if (!hasStart) continue;
    const isMachine = ss.path.startsWith("~/") || ss.path.startsWith("~\\") || ss.path.startsWith("/");
    const abs = isMachine
      ? ss.path.startsWith("~/") || ss.path.startsWith("~\\")
        ? join(home, ss.path.slice(2))
        : ss.path
      : join(root, ss.path);

    let raw: string | null;
    if (isMachine) {
      raw = cron.readHarnessConfig?.(abs) ?? null;
    } else {
      try {
        raw = isFile(abs) ? readFileSync(abs, "utf-8") : null;
      } catch {
        raw = null; // unreadable seed: not a session-start wiring signal
      }
    }
    if (raw !== null) anySessionStartSignal = true;
    if (raw !== null && raw.includes("jspace context session-start")) continue;

    if (isMachine) {
      // Pi: only warn when this workbench uses Pi and Pi itself is installed
      // (settings.json exists) but the jspace extension is missing/unwired.
      if (name === "pi") {
        const piSettings = join(home, ".pi", "agent", "settings.json");
        const piInstalled = cron.readHarnessConfig?.(piSettings) !== null;
        if (piInstalled && piActive) {
          diags.push({
            severity: "warning",
            code: "harness.session_start_not_wired",
            path: `harness.${name}`,
            message: `Pi is installed and active for this workbench, but the jspace session-start extension is missing or stale at ${abs}; run 'jspace harness wire --harness pi' to enable automatic briefing`,
          });
        }
      } else if (raw !== null) {
        diags.push({
          severity: "warning",
          code: "harness.session_start_not_wired",
          path: `harness.${name}`,
          message: `${name} session-start hook exists but is missing 'jspace context session-start' at ${abs}; run the harness's wire/upgrade command to repair it`,
        });
      }
    } else if (raw !== null) {
      // Workbench seed exists for this harness but no longer contains the hook.
      diags.push({
        severity: "warning",
        code: "harness.session_start_not_wired",
        path: `harness.${name}`,
        message: `${name} session-start seed exists but is missing 'jspace context session-start' at ${abs}; run 'jspace workspace upgrade' to restore the seed`,
      });
    }
  }

  // Briefing staleness: only meaningful once at least one session-start
  // mechanism is present/selected. On a brand-new workbench with no harness
  // wired yet, "no briefing" is expected, not a health problem.
  if (anySessionStartSignal) {
    const briefing = readBriefing(root);
    if (isBriefingStale(briefing.state)) {
      diags.push({
        severity: "warning",
        code: "briefing.stale",
        path: "briefing",
        message: briefing.state === null
          ? "no session-start briefing recorded yet; automatic briefing may not be running (run 'jspace harness wire --harness <your-harness>')"
          : `last session-start briefing is stale (${briefing.state.last_session_start_at}); session-start hooks may not be running (run 'jspace harness wire --harness <your-harness>')`,
      });
    }
  }
  return diags;
}

/** `jspace doctor` — orchestrate the read-only checks and aggregate by severity.
 *  `verbose` prints info-level diagnostics in human mode (default: only counted). */
export function doctorWorkbench(root: string, cron: CronHealthDeps, verbose = false): CmdResult {
  const reads = readWorkbenchState(root);
  const env: InspectEnv = {
    root,
    hub: reads.hub,
    marker: reads.marker,
    local: reads.local,
    pathExists: existsSync,
    isFile,
    readJson: (p) => {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        return INVALID_JSON; // never throw — caller converts to a diagnostic
      }
    },
  };
  const diags: RegistryDiagnostic[] = [
    ...inspectWorkbench(env),
    ...checkInbox(reads),
    ...checkPending(reads),
    ...checkIngest(root),
    ...checkSkills(root, cron),
    ...checkDomains(root, reads.hub.status === "ok" ? reads.hub.value : null),
    ...checkGBrain(root, cron),
    ...checkCursorSkills(cron),
    ...checkCrons(root, cron),
    ...checkHarness(root, cron),
    ...checkSessionStartHooks(root, cron),
  ];

  const errors = diags.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings = diags.filter((d) => d.severity === "warning").map((d) => d.message);
  const infos = diags.filter((d) => d.severity === "info").map((d) => d.message);
  const summary = `jspace: doctor ${errors.length > 0 ? "failed" : "ok"}: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`;
  return {
    exitCode: errors.length > 0 ? 1 : undefined,
    lines: verbose ? [summary, ...infos] : [summary],
    data: { diagnostics: diags, errors, warnings, infos },
    errors,
    warnings,
  };
}
