// application/diagnostics/checks/inbox.ts — filehub, pending, ingest, domains.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import type { readWorkbenchState } from "../../../adapters/fs/workbench-state.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../../core/registry/effective.ts";
import { countInbox } from "../../registry/inbox.ts";
import { readEnvelopes } from "../../pending/envelope.ts";
import { readJournals } from "../../ingest/journal.ts";
import type { HubV1 } from "../../../core/contracts/hub.ts";
import {
  DOMAIN_DORMANT_DAYS,
  lastActivityMs,
  ACTIVITY_SCAN_BUDGET,
  newActivityScanBudget,
  PROJECT_STALE_DAYS,
  pushCapped,
} from "./shared.ts";
import {
  FILEHUB_CONTRACT_VERSION,
  inspectFilehubContractBlock,
  parseFilehubContractVersion,
} from "../../registry/filehub-block.ts";

export type WorkbenchReads = ReturnType<typeof readWorkbenchState>;

/** Registered filehub root for a workbench, or null when unregistered/broken.
 *  Shared by the filehub resource-level, inbox and pending checks. */
export function resolveFhRoot(reads: WorkbenchReads): string | null {
  if (reads.hub.status !== "ok") return null;
  const local = reads.local.status === "ok" ? reads.local.value : null;
  const effective = resolveEffectiveRegistry(reads.hub.value, local, { pathExists: existsSync });
  return primaryPathForResourceType(effective, "filehub");
}

/** Non-throwing classification of a directory path. `existsSync` collapses
 *  EACCES into "missing" and a bare `statSync` throws, so diagnostics probe with
 *  lstat and distinguish "absent" from "present but unreadable" — doctor must
 *  degrade, never crash (a chmod 000 dir used to take the whole command down). */
type DirProbe = "dir" | "missing" | "unreadable" | "not-dir";

function probeDir(p: string): DirProbe {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
  }
  if (st.isSymbolicLink()) {
    try {
      st = statSync(p);
    } catch {
      return "unreadable"; // dangling or unreadable link target
    }
  }
  return st.isDirectory() ? "dir" : "not-dir";
}

/** readdir that returns null instead of throwing on EACCES / races. */
function safeReaddir(p: string): string[] | null {
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
}

/** filehub resource-level health: unregistered (info), _inbox state, stale
 *  projects (info nudge). Read-only; never throws. */
export function checkInbox(reads: WorkbenchReads): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const fhRoot = resolveFhRoot(reads);
  if (!fhRoot) {
    diags.push({
      severity: "info",
      code: "filehub.unregistered",
      path: "resources",
      message: "no filehub resource registered (type=filehub); asset-ingest falls back to the degraded staging area",
    });
    return diags;
  }
  // A bound-but-absent root means the drive is not mounted / the sync folder is
  // not materialised yet. The registry layer already reports that once as
  // binding.missing; every content check below would only restate "we cannot see
  // it", so stop here instead of emitting a cascade of misleading warnings.
  if (probeDir(fhRoot) !== "dir") return diags;

  const inboxDir = join(fhRoot, "_inbox");
  switch (probeDir(inboxDir)) {
    case "dir": {
      let unfiled: number;
      try {
        unfiled = countInbox(inboxDir);
      } catch {
        diags.push({ severity: "warning", code: "filehub.inbox_unreadable", path: `filehub.${fhRoot}`, message: `filehub: _inbox is not readable: ${inboxDir} (fix permissions to let inbox checks run)` });
        break;
      }
      if (unfiled > 0) {
        diags.push({ severity: "warning", code: "filehub.inbox_unfiled", path: `filehub.${fhRoot}`, message: `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")` });
      }
      break;
    }
    case "unreadable":
      diags.push({ severity: "warning", code: "filehub.inbox_unreadable", path: `filehub.${fhRoot}`, message: `filehub: _inbox is not readable: ${inboxDir} (fix permissions to let inbox checks run)` });
      break;
    default:
      diags.push({ severity: "warning", code: "filehub.inbox_missing", path: `filehub.${fhRoot}`, message: `filehub: _inbox missing: ${inboxDir}` });
  }
  const now = Date.now();
  const registeredAssetPaths = new Set(
    (reads.hub.status === "ok" ? reads.hub.value.projects ?? [] : []).map((p) => p.asset_rel_path),
  );
  const projectsDir = join(fhRoot, "projects");
  const projectNames = probeDir(projectsDir) === "dir" ? safeReaddir(projectsDir) : null;
  if (projectNames === null && probeDir(projectsDir) === "dir") {
    diags.push({
      severity: "warning",
      code: "filehub.projects_unreadable",
      path: `filehub.${fhRoot}`,
      message: `filehub: projects/ is not readable: ${projectsDir} (fix permissions to let project checks run)`,
    });
  }
  if (projectNames !== null) {
    const dirs = projectNames
      .filter((name) => !name.startsWith("."))
      .map((name) => ({ name, abs: join(projectsDir, name) }))
      .filter(({ abs }) => probeDir(abs) === "dir"); // vanished / unreadable / not a dir

    // Registration drift is a cheap set lookup over the project list, so it is
    // reported for every project; only the mtime walk below is budgeted.
    pushCapped(
      diags,
      dirs.filter(({ name }) => !registeredAssetPaths.has(`projects/${name}`)).map(({ name }) => name),
      (name) => ({
        severity: "info",
        code: "registry.project_unlinked",
        path: `filehub.projects.${name}`,
        message: `filehub project ${name} is not registered in hub.json; weekly-report discovers projects from the registry and the domain README, so an unlinked project stays invisible — see jspace-use 8.7 (jspace project add <ascii-id> --asset-rel-path projects/${name})`,
      }),
      (shown, total) => ({
        severity: "info",
        code: "registry.project_unlinked",
        path: "filehub.projects",
        message: `filehub: ${total} project(s) under projects/ are not registered in hub.json (the first ${shown} are listed above); register them in bulk — see jspace-use 8.7`,
      }),
    );

    // One budget for the whole staleness pass: doctor's cost must not scale with
    // the size of the asset tree, which is exactly where the command has to stay
    // usable. Exhaustion is reported, never silently turned into a wrong verdict.
    const budget = newActivityScanBudget();
    const stale: { name: string; days: number }[] = [];
    let scanned = 0;
    for (const { name, abs } of dirs) {
      if (budget.truncated) break;
      // Short-circuit on the stale cutoff: "was anything touched in the last
      // PROJECT_STALE_DAYS?" only needs the first recent entry it finds, so an
      // active project costs O(1) instead of O(its whole tree).
      const last = lastActivityMs(abs, {
        stopWhenNewerThan: now - PROJECT_STALE_DAYS * 86_400_000,
        budget,
      });
      scanned += 1;
      if (budget.truncated || last === 0) continue; // lower bound: never call it stale
      const days = (now - last) / 86_400_000;
      if (days >= PROJECT_STALE_DAYS) stale.push({ name, days });
    }
    // The count is a fact only about the projects actually walked; say so on the
    // line that makes the claim rather than leaving it to a line further down.
    const coverage = budget.truncated ? `, of the ${scanned}/${dirs.length} project(s) checked` : "";
    pushCapped(
      diags,
      stale,
      ({ name, days }) => ({
        severity: "info",
        code: "filehub.project_stale",
        path: `filehub.projects.${name}`,
        message: `filehub project ${name} untouched for ${Math.round(days)}d (≥${PROJECT_STALE_DAYS}d); archive to archive/<年>/ if closed — see jspace-use 8.7 (project lifecycle) / 8.6`,
      }),
      (shown, total) => ({
        severity: "info",
        code: "filehub.project_stale",
        path: "filehub.projects",
        message: `filehub: ${total} project(s) untouched for ≥${PROJECT_STALE_DAYS}d${coverage} (the first ${shown} are listed above); archive the closed ones to archive/<年>/ — see jspace-use 8.7 / 8.6`,
      }),
    );
    if (budget.truncated) {
      diags.push({
        severity: "info",
        code: "filehub.scan_truncated",
        path: `filehub.${fhRoot}`,
        message: `filehub: freshness scan hit its ${ACTIVITY_SCAN_BUDGET}-entry budget and covered ${scanned} of ${dirs.length} project(s); the remaining ones were not checked — rerun doctor later or archive in bulk (see jspace-use 8.6)`,
      });
    }
  }
  return diags;
}

/** Legacy format vocabulary: directory names that describe file shape, not
 *  ownership/stage. Never recommended; detected read-only so a real migration
 *  can be planned (see asset-ingest/references/migration.md). */
export const LEGACY_TAXONOMY_DIRS: readonly string[] = ["docs", "decks", "data", "notes"];

const UPGRADE_HINT = "jspace filehub upgrade";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** One-level scan of `dir` for legacy format child directories. Permission /
 *  race errors degrade to "nothing found" — doctor must never throw. */
function legacyChildren(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
    const hits: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      if (!LEGACY_TAXONOMY_DIRS.includes(name)) continue;
      if (isDir(join(dir, name))) hits.push(name);
    }
    return hits.sort();
  } catch {
    return [];
  }
}

/** Read-only filehub content contract checks:
 *  - `filehub.contract_stale`: README missing / no managed block / damaged
 *    markers / missing or outdated contract version.
 *  - `filehub.legacy_taxonomy`: exact `docs|decks|data|notes` child dirs under a
 *    registered project asset root or an `areas/*` directory.
 *  Warning-level only (never blocks) and bounded: no recursive walk of the
 *  asset tree, so a large filehub stays cheap. */
export function checkFilehubContract(reads: WorkbenchReads): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const fhRoot = resolveFhRoot(reads);
  if (!fhRoot) return diags; // unregistered already reported by checkInbox

  // Root not materialised on this machine (unmounted drive, unsynced cloud
  // folder): binding.missing is the honest diagnostic. Reporting "README missing"
  // here would also suggest `filehub upgrade <path>`, a command that fails
  // immediately because the root does not exist.
  if (probeDir(fhRoot) !== "dir") return diags;

  const readme = join(fhRoot, "README.md");
  let readmeText: string | null = null;
  let readmeMissing = false;
  let readmeUnreadable = false;
  try {
    readmeText = readFileSync(readme, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") readmeMissing = true;
    else readmeUnreadable = true;
  }
  const readmeIsSymlink = (() => {
    try {
      return lstatSync(readme).isSymbolicLink();
    } catch {
      return false;
    }
  })();

  if (readmeMissing) {
    diags.push({
      severity: "warning",
      code: "filehub.contract_stale",
      path: `filehub.${fhRoot}`,
      message: `filehub README missing: ${readme}; run "${UPGRADE_HINT} ${fhRoot} --dry-run" to preview the contract file, then apply`,
    });
  } else if (readmeUnreadable || readmeText === null) {
    diags.push({
      severity: "warning",
      code: "filehub.contract_stale",
      path: `filehub.${fhRoot}`,
      message: `filehub README is not readable: ${readme}; fix file permissions first — "${UPGRADE_HINT}" cannot repair an unreadable file`,
    });
  } else if (readmeIsSymlink) {
    // `filehub upgrade` refuses symlinked READMEs by design, so pointing at it
    // would send the user into a command that always fails.
    diags.push({
      severity: "warning",
      code: "filehub.contract_stale",
      path: `filehub.${fhRoot}`,
      message: `filehub README is a symlink: ${readme}; replace it with a regular file first — "${UPGRADE_HINT}" refuses symlinks and will not touch its target`,
    });
  } else {
    let state: ReturnType<typeof inspectFilehubContractBlock>;
    try {
      state = inspectFilehubContractBlock(readmeText);
    } catch {
      state = { kind: "malformed", reason: "README unreadable" };
    }
    if (state.kind === "malformed") {
      diags.push({
        severity: "warning",
        code: "filehub.contract_stale",
        path: `filehub.${fhRoot}`,
        message: `filehub README contract block damaged (${state.reason}): ${readme}; fix the JSPACE:FILEHUB markers by hand, then run "${UPGRADE_HINT} ${fhRoot} --dry-run"`,
      });
    } else if (state.kind === "none") {
      diags.push({
        severity: "warning",
        code: "filehub.contract_stale",
        path: `filehub.${fhRoot}`,
        message: `filehub README has no JSPACE:FILEHUB contract block: ${readme}; run "${UPGRADE_HINT} ${fhRoot} --dry-run" to preview the insert`,
      });
    } else {
      const version = parseFilehubContractVersion(state.block);
      if (version === null) {
        diags.push({
          severity: "warning",
          code: "filehub.contract_stale",
          path: `filehub.${fhRoot}`,
          message: `filehub README contract block has no filehub-contract-version: ${readme}; run "${UPGRADE_HINT} ${fhRoot} --dry-run"`,
        });
      } else if (version < FILEHUB_CONTRACT_VERSION) {
        diags.push({
          severity: "warning",
          code: "filehub.contract_stale",
          path: `filehub.${fhRoot}`,
          message: `filehub README contract v${version} < v${FILEHUB_CONTRACT_VERSION}: ${readme}; run "${UPGRADE_HINT} ${fhRoot} --dry-run" then apply (README block only — assets are never moved)`,
        });
      }
    }
  }

  const hub = reads.hub.status === "ok" ? reads.hub.value : null;
  const scanRoots: { abs: string; rel: string }[] = [];
  for (const project of hub?.projects ?? []) {
    scanRoots.push({ abs: join(fhRoot, project.asset_rel_path), rel: project.asset_rel_path });
  }
  const areasDir = join(fhRoot, "areas");
  const areaNames = probeDir(areasDir) === "dir" ? safeReaddir(areasDir) : null;
  if (areaNames !== null) {
    for (const name of areaNames) {
      if (name.startsWith(".")) continue;
      const abs = join(areasDir, name);
      // Areas are discovered by name (nobody declared them), so a symlinked
      // entry must never widen the scan outside the filehub. Registered project
      // roots are explicitly declared and keep their follow-link behaviour.
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) scanRoots.push({ abs, rel: `areas/${name}` });
    }
  }

  const offenders = scanRoots
    .map(({ abs, rel }) => ({ rel, hits: legacyChildren(abs) }))
    .filter(({ hits }) => hits.length > 0);
  pushCapped(
    diags,
    offenders,
    ({ rel, hits }) => ({
      severity: "warning",
      code: "filehub.legacy_taxonomy",
      path: `filehub.${rel}`,
      message: `legacy format director${hits.length === 1 ? "y" : "ies"} under ${rel}: ${hits.join(", ")}; format names must not be archive directories — migrate per asset-ingest/references/migration.md (explicit, per-file, rollback-able)`,
    }),
    (shown, total) => ({
      severity: "warning",
      code: "filehub.legacy_taxonomy",
      path: "filehub",
      message: `filehub: ${total} location(s) still use legacy format directories docs/ decks/ data/ notes/ (the first ${shown} are listed above); migrate per asset-ingest/references/migration.md (explicit, per-file, rollback-able)`,
    }),
  );
  return diags;
}

/** Pending gbrain write envelopes: damaged files + actionable (staged /
 *  terminal_failed). Damaged envelopes surface as warnings (visible-degradation). */
export function checkPending(reads: WorkbenchReads): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const fhRoot = resolveFhRoot(reads);
  if (!fhRoot) return diags;
  if (probeDir(fhRoot) !== "dir") return diags; // binding.missing covers this
  const envRead = readEnvelopes(fhRoot);
  for (const issue of envRead.issues) {
    diags.push({
      severity: "warning",
      code: "filehub.pending_decode",
      path: `filehub.${issue.path}`,
      message: `pending envelope unreadable: ${issue.message}`,
    });
  }
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
export function checkIngest(root: string): RegistryDiagnostic[] {
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

/** Long-term-use health (info level, design §5): dormant domains. A "take a
 *  look" nudge, never an assertion — mtime is rewritten by git clone /
 *  cloud-sync, so the threshold stays conservative. Registered domains are
 *  scanned by their hub.json `path` (authority, supports custom --path); a
 *  workspace/* dir that is NOT a registered domain is flagged as residue
 *  (issue #8 #14). */
export function checkDomains(root: string, hub: HubV1 | null): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  const now = Date.now();
  const registered = new Set((hub?.domains ?? []).map((d) => d.path));
  for (const d of hub?.domains ?? []) {
    const p = join(root, d.path);
    if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    // Short-circuit on the dormancy cutoff (same reasoning as the filehub
    // projects pass). No entry budget here: domains live inside the workbench
    // (git-managed, bounded by construction), unlike the asset layer.
    const last = lastActivityMs(p, { stopWhenNewerThan: now - DOMAIN_DORMANT_DAYS * 86_400_000 });
    if (last === 0) continue;
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
