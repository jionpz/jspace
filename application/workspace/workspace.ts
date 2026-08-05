// application/workspace/workspace.ts — `jspace workspace diff|upgrade` use cases.
// manifest + assets are injected so the layer stays free of the embedded-bundle
// cli module. Filesystem writes go through injected writeFile for testability
// (failure injection) and are preceded by backup + journal in .jspace/state/.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { readMarker, writeMarkerAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { diffBundle, materializedRel } from "./manifest.ts";
import { readMaterializedJournal, writeUpdatedMaterializedJournal } from "./journal.ts";
import { migrateHubSchema, type HubTransform, type MigrationOutcome } from "../../core/registry/migrations.ts";

function safeReadFile(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function setTemplateVersion(root: string, version: string): void {
  const marker = readMarker(root);
  if (marker.status !== "ok") fail("not an initialized JSpace workbench (missing .jspace/marker.json)");
  writeMarkerAtomic(root, { ...marker.value, template_version: version });
}

// ---- hub.json schema migration --------------------------------------------

interface HubMigrationPlan {
  rel: string;
  outcome: MigrationOutcome;
}

/** Parse a hub.json document, or null when absent/malformed. */
function parseHubJson(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as unknown;
    return typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Compare the bundle's hub.json template schema against the installed hub.json
 *  and run the migration chain. Returns null when nothing to migrate (installed
 *  absent/malformed, same version, or installed ahead of the bundle). */
function planHubMigration(root: string, deps: UpgradeDeps): HubMigrationPlan | null {
  const hubKey = deps.manifest.files.find((f) => materializedRel(f.path) === ".jspace/hub.json")?.path;
  if (hubKey === undefined) return null;
  const bundleDoc = parseHubJson(deps.assets[hubKey] ?? null);
  const installedDoc = parseHubJson(deps.readFile(join(root, ".jspace/hub.json")));
  if (bundleDoc === null || installedDoc === null) return null;
  const from = String(installedDoc.version);
  const to = String(bundleDoc.version);
  const fromNum = Number(from);
  const toNum = Number(to);
  if (Number.isNaN(fromNum) || Number.isNaN(toNum) || fromNum >= toNum) return null;
  const outcome = migrateHubSchema(installedDoc, from, to, deps.migrations);
  return outcome.status === "unchanged" ? null : { rel: ".jspace/hub.json", outcome };
}

// ---- workspace diff --------------------------------------------------------

export function workspaceDiff(
  root: string,
  manifest: DistributionManifestV1,
  json: boolean,
): CmdResult {
  const recorded = readMaterializedJournal(root)?.files ?? {};
  const entries = diffBundle(root, manifest, { readFile: safeReadFile, recorded });
  if (json) {
    return { lines: [], data: { bundle_version: manifest.bundle_version, entries } };
  }
  return {
    lines: entries.length === 0
      ? ["jspace: ok: workspace is up to date"]
      : entries.map((e) => `[${e.action}] ${e.rel} (${e.reason})`),
  };
}

// ---- workspace upgrade -----------------------------------------------------

export interface UpgradeDeps {
  manifest: DistributionManifestV1;
  /** bundle key -> raw content (from the embedded ASSETS map) */
  assets: Record<string, string>;
  readFile: (p: string) => string | null;
  writeFile: (p: string, content: string) => void;
  /** Registered hub.json schema migrations (from-version -> next transform).
   *  Defaults to the empty module table; injectable for tests. */
  migrations?: Record<string, HubTransform>;
}

export interface UpgradeOptions {
  dryRun: boolean;
  acceptConflicts: boolean;
  rollbackId?: string;
}

interface UpgradeJournal {
  id: string;
  from_version: string;
  to_version: string;
  plan: { action: string; rel: string }[];
  status: "pending" | "applied" | "failed" | "rolled_back";
}

function upgradeJournalPath(root: string, id: string): string {
  return join(root, CONFIG_DIR, "state", "upgrades", id, "journal.json");
}

function writeUpgradeJournal(root: string, id: string, journal: UpgradeJournal): void {
  const p = upgradeJournalPath(root, id);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(journal, null, 2) + "\n", "utf-8");
}

function rollbackUpgrade(root: string, id: string, deps: UpgradeDeps): CmdResult {
  const journalPath = upgradeJournalPath(root, id);
  if (!existsSync(journalPath)) fail(`no upgrade journal: ${id}`);
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as UpgradeJournal;
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  for (const step of journal.plan) {
    const beforePath = join(backupDir, "before", step.rel);
    if (existsSync(beforePath)) {
      deps.writeFile(join(root, step.rel), readFileSync(beforePath, "utf-8"));
    } else if (step.action === "create") {
      // created during the failed/applied upgrade and never backed up -> remove
      try {
        unlinkSync(join(root, step.rel));
      } catch {
        /* best-effort */
      }
    }
  }
  writeUpdatedMaterializedJournal(root, deps.manifest, new Set(journal.plan.map((s) => s.rel)));
  setTemplateVersion(root, journal.from_version);
  writeUpgradeJournal(root, id, { ...journal, status: "rolled_back" });
  return { lines: [`jspace: ok: rolled back workspace upgrade ${id}`] };
}

export function workspaceUpgrade(
  root: string,
  opts: UpgradeOptions,
  deps: UpgradeDeps,
): CmdResult {
  if (opts.rollbackId !== undefined) return rollbackUpgrade(root, opts.rollbackId, deps);

  const recorded = readMaterializedJournal(root)?.files ?? {};
  const entries = diffBundle(root, deps.manifest, { readFile: deps.readFile, recorded });
  const conflicts = entries.filter((e) => e.action === "conflict");
  const plan = entries.filter(
    (e) =>
      e.action === "create" ||
      e.action === "update" ||
      // --accept-conflicts force-overwrites locally modified files, but only
      // the reserved `managed` class. seed/user edits (AGENTS.md, README,
      // .claude settings, skills, hub.json, cron.json) are always preserved —
      // reported as skip in diff, never force-overwritten.
      (e.action === "conflict" && opts.acceptConflicts && e.ownership === "managed"),
  );
  const hubMigration = planHubMigration(root, deps);

  if (opts.dryRun) {
    const changes = entries.filter(
      (e) => e.action === "create" || e.action === "update" || e.action === "conflict",
    );
    // mirror the real path: a registered migration is planned as [migrate]; a
    // schema gap with NO registered migration is [manual] (the real upgrade will
    // refuse) — never shown as an auto-migrate that would silently succeed.
    const mig = hubMigration !== null && hubMigration.outcome.status === "migrated";
    const manual = hubMigration !== null && hubMigration.outcome.status === "no-migration";
    const lines = changes.length === 0 && !mig && !manual
      ? ["jspace: ok: would upgrade: nothing to do"]
      : [
          `jspace: ok: would upgrade ${changes.length + (mig ? 1 : 0)} file(s):`,
          ...changes.map((e) => `[${e.action}] ${e.rel}`),
          ...(mig
            ? [`[migrate] ${hubMigration.rel} (hub schema ${hubMigration.outcome.from} -> ${hubMigration.outcome.to})`]
            : []),
          ...(manual
            ? [`[manual] ${hubMigration.rel} (hub schema ${hubMigration.outcome.from} -> ${hubMigration.outcome.to}; no registered migration — the real upgrade will refuse)`]
            : []),
        ];
    return { lines };
  }
  if (hubMigration !== null && hubMigration.outcome.status === "no-migration") {
    fail(
      `workspace upgrade: hub.json schema ${hubMigration.outcome.from} -> ${hubMigration.outcome.to} has no registered migration; manual upgrade required (hub.json not modified)`,
    );
  }
  if (conflicts.length > 0 && !opts.acceptConflicts) {
    fail(
      `workspace upgrade: ${conflicts.length} conflict(s) in: ${conflicts.map((e) => e.rel).join(", ")} (use --accept-conflicts to override)`,
    );
  }
  if (plan.length === 0 && hubMigration === null) {
    return { lines: ["jspace: ok: workspace is up to date"] };
  }
  if (hubMigration !== null && hubMigration.outcome.status === "migrated") {
    plan.push({ action: "migrate", rel: hubMigration.rel, ownership: "user", reason: "hub schema migration" });
  }

  // backup + journal before any mutation
  const marker = readMarker(root);
  if (marker.status !== "ok") fail("not an initialized JSpace workbench (missing .jspace/marker.json)");
  const id = crypto.randomUUID();
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  const journal: UpgradeJournal = {
    id,
    from_version: marker.value.template_version,
    to_version: deps.manifest.bundle_version,
    plan: plan.map((e) => ({ action: e.action, rel: e.rel })),
    status: "pending",
  };
  writeUpgradeJournal(root, id, journal);
  for (const e of plan) {
    const cur = deps.readFile(join(root, e.rel));
    if (cur !== null) {
      const p = join(backupDir, "before", e.rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, cur, "utf-8");
    }
  }

  const pathByRel = new Map<string, string>();
  for (const f of deps.manifest.files) {
    const rel = materializedRel(f.path);
    if (rel !== null) pathByRel.set(rel, f.path);
  }

  try {
    for (const e of plan) {
      if (e.action === "migrate") {
        // migrated user data, not a bundle asset; write the transformed document
        const doc = hubMigration?.outcome.document;
        if (doc === undefined) throw new Error(`missing migrated document for ${e.rel}`);
        deps.writeFile(join(root, e.rel), JSON.stringify(doc, null, 2) + "\n");
        continue;
      }
      const key = pathByRel.get(e.rel);
      const content = key !== undefined ? deps.assets[key] : undefined;
      if (content === undefined) throw new Error(`missing bundle asset for ${e.rel}`);
      deps.writeFile(join(root, e.rel), content);
    }
    writeUpdatedMaterializedJournal(root, deps.manifest, new Set(plan.map((e) => e.rel)));
    setTemplateVersion(root, deps.manifest.bundle_version);
    writeUpgradeJournal(root, id, { ...journal, status: "applied" });
  } catch (e) {
    writeUpgradeJournal(root, id, { ...journal, status: "failed" });
    fail(`workspace upgrade failed (recover with: jspace workspace upgrade --rollback ${id}): ${(e as Error).message}`);
  }

  return {
    lines: [
      `jspace: ok: upgraded workspace to ${deps.manifest.bundle_version} (${plan.length} file(s) changed)`,
      `Upgrade journal: ${id} (restore with: jspace workspace upgrade --rollback ${id})`,
      `Validate: jspace doctor --dir ${root}`,
    ],
  };
}
