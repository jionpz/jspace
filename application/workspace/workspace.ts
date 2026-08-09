// application/workspace/workspace.ts — `jspace workspace diff|upgrade` use cases.
// manifest + assets are injected so the layer stays free of the embedded-bundle
// cli module. Filesystem writes go through injected writeFile for testability
// (failure injection) and are preceded by backup + journal in .jspace/state/.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { readMarker, writeMarkerAtomic, writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { decodeUpgradeJournal, type UpgradeJournalV1 } from "../../core/contracts/upgrade.ts";
import { extractAgentsBlock, replaceAgentsBlock } from "./agents-block.ts";
import { diffBundle, materializedRels } from "./manifest.ts";
import { readMaterializedJournal, writeUpdatedMaterializedJournal } from "./journal.ts";
import { safeReadFile } from "./fs-helpers.ts";
import { migrateHubSchema, type HubTransform, type MigrationOutcome } from "../../core/registry/migrations.ts";

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

/** Hub schema version as a numeric string for migration comparisons: the
 *  unified `schema_version: number`, or legacy `schema_version: 1` (same schema,
 *  == schema_version 1). Returns null when neither form is present. */
function hubVersion(doc: Record<string, unknown>): string | null {
  if (typeof doc.schema_version === "number") return String(doc.schema_version);
  if (doc.version === "4") return "1";
  return null;
}

/** Compare the bundle's hub.json template schema against the installed hub.json
 *  and run the migration chain. Returns null when nothing to migrate (installed
 *  absent/malformed, same version, or installed ahead of the bundle). */
function planHubMigration(root: string, deps: UpgradeDeps): HubMigrationPlan | null {
  const hubKey = deps.manifest.files.find((f) => materializedRels(f.path).includes(".jspace/hub.json"))?.path;
  if (hubKey === undefined) return null;
  const bundleDoc = parseHubJson(deps.assets[hubKey] ?? null);
  const installedDoc = parseHubJson(deps.readFile(join(root, ".jspace/hub.json")));
  if (bundleDoc === null || installedDoc === null) return null;
  const from = hubVersion(installedDoc);
  const to = hubVersion(bundleDoc);
  if (from === null || to === null) return null;
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
  assets?: Record<string, string>,
): CmdResult {
  const recorded = readMaterializedJournal(root)?.files ?? {};
  const entries = diffBundle(root, manifest, {
    readFile: safeReadFile,
    recorded,
    bundleContent: assets === undefined ? undefined : (key) => assets[key] ?? null,
  });
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

type UpgradeJournal = UpgradeJournalV1;

function upgradeJournalPath(root: string, id: string): string {
  return join(root, CONFIG_DIR, "state", "upgrades", id, "journal.json");
}

function writeUpgradeJournal(root: string, id: string, journal: UpgradeJournal): void {
  const p = upgradeJournalPath(root, id);
  mkdirSync(dirname(p), { recursive: true });
  writeBytesAtomic(p, JSON.stringify({ ...journal, version: 1 }, null, 2) + "\n");
}

/** Read an upgrade journal; fail loud on a damaged journal — a rollback must
 *  never silently treat an unreadable journal as "nothing to do". */
function readUpgradeJournal(root: string, id: string): UpgradeJournal {
  const journalPath = upgradeJournalPath(root, id);
  let raw: string;
  try {
    raw = readFileSync(journalPath, "utf-8");
  } catch {
    fail(`no upgrade journal: ${id} (${journalPath})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`upgrade journal ${journalPath} is not valid JSON (${(e as Error).message}); fix it before rolling back`);
  }
  const d = decodeUpgradeJournal(parsed);
  if (!d.ok) {
    fail(`upgrade journal ${journalPath} is damaged: ${d.issues.map((i) => i.message).join("; ")}; fix it before rolling back`);
  }
  return d.value;
}

function rollbackUpgrade(root: string, id: string, deps: UpgradeDeps): CmdResult {
  const journal = readUpgradeJournal(root, id);
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
  const entries = diffBundle(root, deps.manifest, {
    readFile: deps.readFile,
    recorded,
    bundleContent: (key) => deps.assets[key] ?? null,
  });
  const conflicts = entries.filter((e) => e.action === "conflict");
  const plan = entries.filter(
    (e) =>
      e.action === "create" ||
      e.action === "update" ||
      e.action === "remove" ||
      e.action === "block-update" ||
      // --accept-conflicts force-overwrites locally modified files, but only
      // the reserved `managed` class. seed/user edits (AGENTS.md, README,
      // .claude settings, skills, hub.json, cron.json) are always preserved —
      // reported as skip in diff, never force-overwritten.
      (e.action === "conflict" && opts.acceptConflicts && e.ownership === "managed"),
  );
  const hubMigration = planHubMigration(root, deps);

  if (opts.dryRun) {
    const changes = entries.filter(
      (e) => e.action === "create" || e.action === "update" || e.action === "conflict" || e.action === "remove" || e.action === "block-update",
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
    version: 1,
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
    // Each manifest file may project to several rels (official skills → harness
    // dirs); every projection maps back to the same bundle key so block-update
    // and asset lookups resolve regardless of which copy is being written.
    for (const rel of materializedRels(f.path)) {
      pathByRel.set(rel, f.path);
    }
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
      if (e.action === "block-update") {
        // AGENTS.md: refresh only the JSPACE block; everything outside the
        // block belongs to the user and is preserved verbatim.
        const key = pathByRel.get(e.rel);
        const content = key !== undefined ? deps.assets[key] : undefined;
        if (content === undefined) throw new Error(`missing bundle asset for ${e.rel}`);
        const bundleBlock = extractAgentsBlock(content);
        if (bundleBlock === null) throw new Error(`bundle AGENTS.md has no JSPACE block for ${e.rel}`);
        const cur = deps.readFile(join(root, e.rel));
        if (cur === null) throw new Error(`missing AGENTS.md for block update: ${e.rel}`);
        deps.writeFile(join(root, e.rel), replaceAgentsBlock(cur, bundleBlock));
        continue;
      }
      if (e.action === "remove") {
        // recorded copy no longer in bundle (unchanged since applied); remove
        // with backup so rollback can restore it.
        try {
          unlinkSync(join(root, e.rel));
        } catch {
          /* best-effort: file already gone */
        }
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
