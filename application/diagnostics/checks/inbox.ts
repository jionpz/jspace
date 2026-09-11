// application/diagnostics/checks/inbox.ts — filehub, pending, ingest, domains.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import type { readWorkbenchState } from "../../../adapters/fs/workbench-state.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../../core/registry/effective.ts";
import { countInbox } from "../../registry/inbox.ts";
import { readEnvelopes } from "../../pending/envelope.ts";
import { readJournals } from "../../ingest/journal.ts";
import type { HubV1 } from "../../../core/contracts/hub.ts";
import { DOMAIN_DORMANT_DAYS, lastActivityMs, PROJECT_STALE_DAYS } from "./shared.ts";
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
  const inboxDir = join(fhRoot, "_inbox");
  if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) {
    diags.push({ severity: "warning", code: "filehub.inbox_missing", path: `filehub.${fhRoot}`, message: `filehub: _inbox missing: ${inboxDir}` });
  } else {
    const unfiled = countInbox(inboxDir);
    if (unfiled > 0) {
      diags.push({ severity: "warning", code: "filehub.inbox_unfiled", path: `filehub.${fhRoot}`, message: `filehub: _inbox has ${unfiled} unfiled file(s); run asset-ingest ("整理一下 inbox")` });
    }
  }
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

  const readme = join(fhRoot, "README.md");
  if (!existsSync(readme)) {
    diags.push({
      severity: "warning",
      code: "filehub.contract_stale",
      path: `filehub.${fhRoot}`,
      message: `filehub README missing: ${readme}; run "${UPGRADE_HINT} ${fhRoot} --dry-run" to preview the contract file, then apply`,
    });
  } else {
    let state: ReturnType<typeof inspectFilehubContractBlock>;
    try {
      state = inspectFilehubContractBlock(readFileSync(readme, "utf-8"));
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
  try {
    if (statSync(areasDir).isDirectory()) {
      for (const name of readdirSync(areasDir)) {
        if (name.startsWith(".")) continue;
        if (isDir(join(areasDir, name))) scanRoots.push({ abs: join(areasDir, name), rel: `areas/${name}` });
      }
    }
  } catch {
    // missing/unreadable areas/ is not a contract problem
  }

  for (const { abs, rel } of scanRoots) {
    const hits = legacyChildren(abs);
    if (hits.length === 0) continue;
    diags.push({
      severity: "warning",
      code: "filehub.legacy_taxonomy",
      path: `filehub.${rel}`,
      message: `legacy format director${hits.length === 1 ? "y" : "ies"} under ${rel}: ${hits.join(", ")}; format names must not be archive directories — migrate per asset-ingest/references/migration.md (explicit, per-file, rollback-able)`,
    });
  }
  return diags;
}

/** Pending gbrain write envelopes: damaged files + actionable (staged /
 *  terminal_failed). Damaged envelopes surface as warnings (visible-degradation). */
export function checkPending(reads: WorkbenchReads): RegistryDiagnostic[] {
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
    const last = lastActivityMs(p);
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
