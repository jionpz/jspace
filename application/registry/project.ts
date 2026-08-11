// application/registry/project.ts — `jspace project` use cases.
// Registers projects in the hub `projects` array. Projects are the logical
// owning ids that `ingest begin --project` resolves against; registering one
// removes the "not registered" warning and keeps derived slugs stable.
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { normalizePortablePath } from "../../core/contracts/paths.ts";
import { decodeHub, type Project } from "../../core/contracts/hub.ts";
import { writeHubAtomic } from "../../adapters/fs/workbench-state.ts";
import { loadHub } from "../workspace/state.ts";
import { listProjectStates, type ProjectOverview } from "../context/project-states.ts";
import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts";

/** Default owning domain: `filehub init --register` creates this when missing. */
const DEFAULT_DOMAIN = "files";

export function projectList(root: string, json: boolean): CmdResult {
  const hub = loadHub(root);
  if (json) {
    return { lines: [], data: { projects: hub.projects } };
  }
  if (hub.projects.length === 0) return { lines: ["jspace: ok: no projects"] };
  return { lines: hub.projects.map((p) => `${p.id}  ${p.domain}  ${p.status}`) };
}

/** Overview view (`project list --status`): every gbrain project state card
 *  (including code projects not registered in the hub) + hub-registered projects
 *  without a state card, flagged. gbrain failure degrades to the hub-only list.
 */
export async function projectListStatus(root: string, json: boolean, gbrain: GbrainDeps): Promise<CmdResult> {
  const hub = loadHub(root);
  const states = await listProjectStates(gbrain);

  // Union: state cards first (recency-sorted by gbrain list), then hub projects
  // without a card. Code projects with a card but no hub entry appear via the
  // state-card set.
  const seen = new Set<string>();
  const cards: (ProjectOverview & { hubRegistered: boolean; hasStateCard: boolean })[] = [];
  for (const s of states) {
    seen.add(s.id);
    cards.push({ ...s, hubRegistered: hub.projects.some((p) => p.id === s.id), hasStateCard: true });
  }
  for (const p of hub.projects) {
    if (!seen.has(p.id)) cards.push({ id: p.id, what: "", now: "", next: "", related: [], updatedAt: "", hubRegistered: true, hasStateCard: false });
  }

  if (json) return { lines: [], data: { projects: cards } };

  if (cards.length === 0) return { lines: ["jspace: ok: no projects"] };
  const lines = cards.map((c) => {
    if (!c.hasStateCard) return `${c.id}  (无状态卡 — hub 已注册)`;
    const skeleton = [c.what, c.now].filter((s) => s !== "").join(" — ");
    const rel = c.related.length > 0 ? `  [相关: ${c.related.join(", ")}]` : "";
    return `${c.id}  ${skeleton || "(无摘要)"}${rel}`;
  });
  return { lines };
}

export function projectAdd(
  root: string,
  id: string,
  domainOpt: string | undefined,
  assetRelPathOpt: string | undefined,
  dryRun: boolean,
): CmdResult {
  if (!isId(id)) {
    fail(`invalid project id: ${id} (lowercase letters, digits, and hyphens)`);
  }
  const hub = loadHub(root);
  if (hub.projects.some((p) => p.id === id)) fail(`duplicate project id: ${id}`);

  const domain = (domainOpt ?? DEFAULT_DOMAIN).trim() || DEFAULT_DOMAIN;
  if (!hub.domains.some((d) => d.id === domain)) {
    fail(`no such domain: ${domain} (register one first: jspace domain add ${domain})`);
  }

  // The hub project contract requires asset_rel_path to begin with projects/ and
  // name a child path; default to the conventional project asset directory.
  const assetRelPath = normalizePortablePath(assetRelPathOpt?.trim() || `projects/${id}`);
  if (!assetRelPath.startsWith("projects/") || assetRelPath === "projects/") {
    fail(`--asset-rel-path must begin with projects/ and name a child path: ${assetRelPath}`);
  }

  const record: Project = { id, domain, asset_rel_path: assetRelPath, status: "active" };
  if (dryRun) {
    return {
      lines: [
        `jspace: ok: would add project: ${id} (domain=${domain}, asset_rel_path=${assetRelPath})`,
      ],
    };
  }
  hub.projects.push(record);
  // Re-encode + decode so the contract (id/domain ref/rel path/status) still holds
  // before writing disk — same invariant check the paired write performs.
  const check = decodeHub(hub);
  if (!check.ok) fail(check.issues.map((i) => i.message).join("; "));
  writeHubAtomic(root, hub);
  return { lines: [`jspace: ok: added project: ${id} (domain=${domain})`] };
}
