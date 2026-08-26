// application/diagnostics/checks/inbox.ts — filehub, pending, ingest, domains.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import type { readWorkbenchState } from "../../../adapters/fs/workbench-state.ts";
import { primaryPathForResourceType, resolveEffectiveRegistry } from "../../../core/registry/effective.ts";
import { countInbox } from "../../registry/inbox.ts";
import { readEnvelopes } from "../../pending/envelope.ts";
import { readJournals } from "../../ingest/journal.ts";
import type { HubV1 } from "../../../core/contracts/hub.ts";
import { DOMAIN_DORMANT_DAYS, lastActivityMs, PROJECT_STALE_DAYS } from "./shared.ts";

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
