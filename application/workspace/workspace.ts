// application/workspace/workspace.ts — `jspace workspace diff|upgrade` use cases.
// manifest + assets are injected so the layer stays free of the embedded-bundle
// cli module. Filesystem writes go through injected writeFile for testability
// (failure injection) and are preceded by backup + journal in .jspace/state/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { portabilityIssues } from "../../core/contracts/paths.ts";
import { decodeHub, type HubV1 } from "../../core/contracts/hub.ts";
import { readMarker, writeMarkerAtomic, writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { ENVELOPE_EXT } from "../../core/contracts/pending.ts";
import {
  decodeLegacyUpgradeJournal,
  decodeUpgradeJournal,
  type UpgradeJournalV1,
} from "../../core/contracts/upgrade.ts";
import { extractAgentsBlock, replaceAgentsBlock } from "./agents-block.ts";
import { diffBundle, materializedRels, skillProjections } from "./manifest.ts";
import {
  MATERIALIZED_FILE,
  migrateMaterializedJournalV1,
  readMaterializedJournal,
  readMaterializedJournalForUpgrade,
  serializeMaterializedJournal,
  writeJournalLinks,
  writeUpdatedMaterializedJournal,
} from "./journal.ts";
import { applyProjectionLinks, manifestSkillNames, planProjectionLinks } from "./projections.ts";
import { safeReadFile } from "./fs-helpers.ts";
import { migrateHubSchema, type HubTransform, type MigrationOutcome } from "../../core/registry/migrations.ts";
import { withWorkbenchMutationLock } from "../lock.ts";
import {
  planLegacyIngestMigrations,
  planLegacyPendingMigrationsForWorkbench,
  type LegacyMigrationNotice,
  type LegacyPendingMove,
} from "./legacy-data-migrations.ts";

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
 *  unified `schema_version: number` only (P2-2 dropped the legacy string
 *  `version: "4"` axis). Returns null when the numeric form is absent. */
function hubVersion(doc: Record<string, unknown>): string | null {
  if (typeof doc.schema_version === "number") return String(doc.schema_version);
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
  /** Current workbench filehub binding, used only by one-time data migrations.
   *  Kept injected so workspace logic never re-resolves registry ownership. */
  filehubRoot?: string | null;
}

export interface UpgradeOptions {
  dryRun: boolean;
  acceptConflicts: boolean;
  rollbackId?: string;
}

type UpgradeJournal = UpgradeJournalV1;

interface ExtraUpgradeOp {
  action: "create" | "migrate" | "remove";
  rel: string;
  reason: string;
  /** Schema/data migrations that must not be rolled back by restoring an
   *  unreadable predecessor shape. Recorded explicitly in the upgrade journal. */
  forwardOnly?: boolean;
  /** Rechecked immediately before a migration write. `null` means the target
   *  must still be absent; a string must match the exact planned predecessor. */
  expectedContent?: string | null;
  /**
   * Present for `create` / `migrate`. `remove` relies on the pre-upgrade backup
   * written under the upgrade id.
   */
  content?: string;
}

interface ExternalMoveRecord {
  id: string;
  slug: string;
  source: string;
  sha256: string;
  target: string;
}

const EXTERNAL_MOVE_MANIFEST = "external-moves.json";

function upgradeJournalPath(root: string, id: string): string {
  return join(root, CONFIG_DIR, "state", "upgrades", id, "journal.json");
}

function readCurrentHub(root: string, deps: UpgradeDeps): HubV1 | null {
  const raw = deps.readFile(join(root, ".jspace", "hub.json"));
  if (raw === null) return null;
  try {
    const decoded = decodeHub(JSON.parse(raw));
    return decoded.ok ? decoded.value : null;
  } catch {
    return null;
  }
}

function migrationWarnings(notices: readonly LegacyMigrationNotice[]): string[] {
  return notices.map((item) => `${item.code} ${item.subject}: ${item.message}`);
}

function writeExternalMoveManifest(
  root: string,
  upgradeId: string,
  moves: readonly LegacyPendingMove[],
): void {
  if (moves.length === 0) return;
  const records: ExternalMoveRecord[] = moves.map((move) => ({
    id: move.id,
    slug: move.slug,
    source: move.sourceLabel,
    sha256: createHash("sha256").update(move.sourceContent).digest("hex"),
    target: move.targetRel,
  }));
  writeBytesAtomic(
    join(root, CONFIG_DIR, "state", "upgrades", upgradeId, EXTERNAL_MOVE_MANIFEST),
    JSON.stringify({ schema_version: 1, moves: records }, null, 2) + "\n",
  );
}

function writeUpgradeJournal(root: string, id: string, journal: UpgradeJournal): void {
  const p = upgradeJournalPath(root, id);
  mkdirSync(dirname(p), { recursive: true });
  writeBytesAtomic(p, JSON.stringify({ ...journal, schema_version: 1 }, null, 2) + "\n");
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

/** A rollback id is a UUID and every journal plan rel is a safe portable path —
 *  `--rollback ../../..` or a tampered journal must never read/write outside the
 *  workbench (issue #8 #15). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local isWithin (mirrors application/registry/helpers.ts) — inlined to avoid
 *  a workspace↔registry import cycle (registry already imports workspace/state). */
function isWithin(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

function validateRollbackRels(root: string, journal: UpgradeJournalV1): void {
  const rootAbs = resolve(root);
  for (const step of journal.plan) {
    const issues = portabilityIssues(step.rel);
    if (issues.length) fail(`upgrade journal plan has an unsafe rel path "${step.rel}": ${issues.join("; ")}`);
    if (!isWithin(resolve(rootAbs, step.rel), rootAbs)) fail(`upgrade journal rel escapes the workbench: ${step.rel}`);
  }
}

function planLegacyUpgradeJournalMigrations(
  root: string,
  deps: UpgradeDeps,
): ExtraUpgradeOp[] {
  const dir = join(root, CONFIG_DIR, "state", "upgrades");
  if (!existsSync(dir)) return [];
  const ops: ExtraUpgradeOp[] = [];
  for (const id of readdirSync(dir).sort()) {
    const rel = join(CONFIG_DIR, "state", "upgrades", id, "journal.json").replace(/\\/g, "/");
    const raw = deps.readFile(join(root, rel));
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // readUpgradeJournal already reports this loudly on rollback
    }
    if (decodeUpgradeJournal(parsed).ok) continue;
    const legacy = decodeLegacyUpgradeJournal(parsed);
    if (!legacy.ok) continue;
    if (!legacy.value.plan.some((step) => step.action === "delete")) continue;
    const migrated: UpgradeJournalV1 = {
      ...legacy.value,
      plan: legacy.value.plan.map((step) => ({
        ...step,
        action: step.action === "delete" ? "remove" : step.action,
      })),
    };
    ops.push({
      action: "migrate",
      rel,
      reason: "upgrade journal action delete -> remove",
      content: JSON.stringify(migrated, null, 2) + "\n",
      forwardOnly: true,
      expectedContent: raw,
    });
  }
  return ops;
}

function rollbackUpgrade(root: string, id: string, deps: UpgradeDeps): CmdResult {
  // id must be a UUID before it is used to build a journal path (traversal)
  if (!UUID_RE.test(id)) fail(`invalid rollback id: ${id} (expected a UUID)`);
  const journal = readUpgradeJournal(root, id);
  validateRollbackRels(root, journal);
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  for (const step of journal.plan) {
    // Data-contract migrations are forward-only. Restoring an old schema makes
    // the current runtime unreadable, and the current journal writer rebuilds
    // materialized hashes after a content rollback.
    if (step.action === "migrate-forward") continue;
    if (step.rel === MATERIALIZED_FILE && step.action === "migrate") continue;
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

function rollbackUpgradePreview(root: string, id: string): CmdResult {
  if (!UUID_RE.test(id)) fail(`invalid rollback id: ${id} (expected a UUID)`);
  const journal = readUpgradeJournal(root, id);
  validateRollbackRels(root, journal);
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  const changes = journal.plan.map((step) => {
    if (step.action === "migrate-forward") return `[forward-only] ${step.rel}`;
    if (step.rel === MATERIALIZED_FILE && step.action === "migrate") return `[forward-only] ${step.rel}`;
    if (existsSync(join(backupDir, "before", step.rel))) return `[restore] ${step.rel}`;
    if (step.action === "create") return `[remove] ${step.rel}`;
    return `[leave] ${step.rel} (no backup recorded)`;
  });
  const externalManifest = join(backupDir, EXTERNAL_MOVE_MANIFEST);
  if (existsSync(externalManifest)) {
    try {
      const parsed = JSON.parse(readFileSync(externalManifest, "utf-8")) as {
        moves?: Array<{ id?: unknown; source?: unknown; target?: unknown }>;
      };
      for (const move of parsed.moves ?? []) {
        if (typeof move.source === "string" && typeof move.target === "string") {
          changes.push(`[forward-only] ${move.source} -> ${move.target}`);
        }
      }
    } catch {
      changes.push(`[leave] ${EXTERNAL_MOVE_MANIFEST} (unreadable; inspect backup manually)`);
    }
  }
  return {
    lines: [
      `jspace: dry-run: would roll back workspace upgrade ${id} (${changes.length} item(s)):`,
      ...changes,
      `jspace: dry-run: no files, journals, locks, or marker state were changed`,
    ],
  };
}

export function workspaceUpgrade(
  root: string,
  opts: UpgradeOptions,
  deps: UpgradeDeps,
): CmdResult {
  // Upgrade rewrites seeds/skills/hub.json in place: without the lock a
  // concurrent `domain add` can be silently overwritten by the hub migration.
  // Every dry-run path is strictly read-only, including rollback previews.
  if (opts.dryRun) {
    return workspaceUpgradeImpl(root, opts, deps);
  }
  return withWorkbenchMutationLock(root, () => workspaceUpgradeImpl(root, opts, deps));
}

function workspaceUpgradeImpl(
  root: string,
  opts: UpgradeOptions,
  deps: UpgradeDeps,
): CmdResult {
  if (opts.rollbackId !== undefined) {
    return opts.dryRun ? rollbackUpgradePreview(root, opts.rollbackId) : rollbackUpgrade(root, opts.rollbackId, deps);
  }

  const materialized = readMaterializedJournalForUpgrade(root);
  const recorded = materialized.journal?.files ?? materialized.legacyV1?.files ?? {};
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
  // Thin-link projection ops (issue #39): legacy per-file copies collapse into
  // directory links here. Planned independently of the per-file diff — a fresh
  // clone with no journal has an empty per-file plan but real projection work.
  const projectionOpts = {
    skillNames: manifestSkillNames(deps.manifest),
    projectionDirs: skillProjections(),
  };
  const projOps = planProjectionLinks(root, projectionOpts);
  const projPending = projOps.filter((o) => o.action !== "no-op");
  const hub = readCurrentHub(root, deps);
  const legacyPending = planLegacyPendingMigrationsForWorkbench(root, {
    hub,
    filehubRoot: deps.filehubRoot ?? null,
    readFile: deps.readFile,
  });
  const legacyIngest = planLegacyIngestMigrations(root, {
    hub,
    filehubRoot: deps.filehubRoot ?? null,
    readFile: deps.readFile,
  });
  const legacyNotices = [...legacyPending.notices, ...legacyIngest.notices];
  const legacyWarnings = migrationWarnings(legacyNotices);
  const extraOps: ExtraUpgradeOp[] = [
    ...legacyPending.ops.map((op) => ({ ...op, forwardOnly: true })),
    ...legacyIngest.ops.map((op) => ({ ...op, forwardOnly: true })),
    ...planLegacyUpgradeJournalMigrations(root, deps),
  ];
  if (materialized.legacyV1 !== null) {
    extraOps.push({
      action: "migrate",
      rel: MATERIALIZED_FILE,
      reason: "materialized journal v1 -> v2 (preserve recorded hashes)",
      content: serializeMaterializedJournal(migrateMaterializedJournalV1(materialized.legacyV1)),
      forwardOnly: true,
      expectedContent: deps.readFile(join(root, MATERIALIZED_FILE)),
    });
  }

  if (opts.dryRun) {
    const changes = entries.filter(
      (e) => e.action === "create" || e.action === "update" || e.action === "conflict" || e.action === "remove" || e.action === "block-update",
    );
    // mirror the real path: a registered migration is planned as [migrate]; a
    // schema gap with NO registered migration is [manual] (the real upgrade will
    // refuse) — never shown as an auto-migrate that would silently succeed.
    const mig = hubMigration !== null && hubMigration.outcome.status === "migrated";
    const manual = hubMigration !== null && hubMigration.outcome.status === "no-migration";
    const hasMigrations = projPending.length > 0 || extraOps.length > 0 || legacyPending.moves.length > 0;
    const lines = changes.length === 0 && !mig && !manual && !hasMigrations && legacyNotices.length === 0
      ? ["jspace: ok: would upgrade: nothing to do"]
      : [
          `jspace: ok: would upgrade ${changes.length + (mig ? 1 : 0) + projPending.length + extraOps.length + legacyPending.moves.length} item(s):`,
          ...changes.map((e) => `[${e.action}] ${e.rel}`),
          ...projPending.map((o) => `[${o.action}] ${o.rel} -> ${o.target}`),
          ...extraOps.map((op) => `[${op.action}] ${op.rel} (${op.reason})`),
          ...legacyPending.moves.map((move) => `[retire] ${move.sourceLabel} -> ${move.targetRel}`),
          ...(mig
            ? [`[migrate] ${hubMigration.rel} (hub schema ${hubMigration.outcome.from} -> ${hubMigration.outcome.to})`]
            : []),
          ...(manual
            ? [`[manual] ${hubMigration.rel} (hub schema ${hubMigration.outcome.from} -> ${hubMigration.outcome.to}; no registered migration — the real upgrade will refuse)`]
            : []),
          ...legacyNotices.map((item) => `[preserve] ${item.subject}: ${item.message}`),
        ];
    return { lines, ...(legacyWarnings.length > 0 ? { warnings: legacyWarnings } : {}) };
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
  if (
    plan.length === 0 &&
    hubMigration === null &&
    projPending.length === 0 &&
    extraOps.length === 0 &&
    legacyPending.moves.length === 0
  ) {
    return {
      lines: [
        legacyNotices.length === 0
          ? "jspace: ok: workspace is up to date"
          : `jspace: warn: workspace is up to date; ${legacyNotices.length} legacy record(s) were left in place (see warnings)`,
      ],
      ...(legacyWarnings.length > 0 ? { warnings: legacyWarnings } : {}),
    };
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
    schema_version: 1,
    id,
    from_version: marker.value.template_version,
    to_version: deps.manifest.bundle_version,
    plan: [
      ...plan.map((e) => ({ action: e.action, rel: e.rel })),
      ...extraOps.map((op) => ({
        action: op.forwardOnly === true ? "migrate-forward" : op.action,
        rel: op.rel,
      })),
    ],
    status: "pending",
  };
  writeUpgradeJournal(root, id, journal);
  for (const rel of [...plan.map((e) => e.rel), ...extraOps.map((op) => op.rel)]) {
    const cur = deps.readFile(join(root, rel));
    if (cur !== null) {
      // atomic backup (issue #9 #9-08): the upgrade rollback copy must not be
      // left half-written if the process dies mid-upgrade.
      writeBytesAtomic(join(backupDir, "before", rel), cur);
    }
  }
  writeExternalMoveManifest(root, id, legacyPending.moves);
  for (const move of legacyPending.moves) {
    writeBytesAtomic(
      join(backupDir, "before", "external", `${move.id}${ENVELOPE_EXT}`),
      move.sourceContent,
    );
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
    const extraByRel = new Map(extraOps.map((op) => [op.rel, op]));
    for (const op of extraOps) {
      if (op.action === "remove") {
        try {
          unlinkSync(join(root, op.rel));
        } catch {
          /* already absent */
        }
        continue;
      }
      if (op.content === undefined) throw new Error(`missing migration content for ${op.rel}`);
      if ("expectedContent" in op) {
        const current = deps.readFile(join(root, op.rel));
        if (current !== op.expectedContent) {
          throw new Error(`migration source changed before write: ${op.rel}; no overwrite was attempted`);
        }
      }
      deps.writeFile(join(root, op.rel), op.content);
    }
    for (const move of legacyPending.moves) {
      const source = deps.readFile(move.sourceAbs);
      if (source === null) continue; // already retired by an interrupted prior run
      if (source !== move.sourceContent) {
        throw new Error(`legacy pending source changed before retirement: ${move.sourceLabel}; source and migrated target were preserved`);
      }
      const target = deps.readFile(join(root, move.targetRel));
      if (target !== move.targetContent) {
        throw new Error(`migrated pending target is missing or changed: ${move.targetRel}; source was preserved`);
      }
      unlinkSync(move.sourceAbs);
    }
    for (const e of plan) {
      if (extraByRel.has(e.rel)) throw new Error(`duplicate upgrade operation for ${e.rel}`);
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
    // Thin-link pass (issue #39) AFTER the per-file loop: `remove` steps have
    // unlinked legacy projection copies, so content-equal dirs now collapse
    // into directory links. Links land in the journal's links section; fallback
    // and keep-divergent outcomes surface as info lines.
    const proj = applyProjectionLinks(root, projectionOpts);
    writeJournalLinks(root, deps.manifest.bundle_version, proj.links);
    const linkedCount = Object.values(proj.links).filter((l) => l.mode !== "copy").length;
    const copyCount = Object.values(proj.links).filter((l) => l.mode === "copy").length;
    const projSummary =
      linkedCount + copyCount > 0
        ? [`jspace: ok: skill projections: ${linkedCount} dir link(s) active${copyCount > 0 ? `, ${copyCount} copy fallback(s)` : ""} (thin-link, issue #39)`]
        : [];
    writeUpdatedMaterializedJournal(root, deps.manifest, new Set(plan.map((e) => e.rel)));
    setTemplateVersion(root, deps.manifest.bundle_version);
    writeUpgradeJournal(root, id, { ...journal, status: "applied" });
    return {
      lines: [
        `jspace: ok: upgraded workspace to ${deps.manifest.bundle_version} (${plan.length + extraOps.length + legacyPending.moves.length} item(s) changed)`,
        ...(legacyPending.moves.length > 0
          ? [`jspace: ok: retired ${legacyPending.moves.length} legacy pending envelope(s) into this workbench (backup: ${id})`]
          : []),
        ...projSummary,
        ...proj.lines,
        `Upgrade journal: ${id} (restore with: jspace workspace upgrade --rollback ${id})`,
        `Validate: jspace doctor --dir ${root}`,
      ],
      ...(legacyWarnings.length > 0 ? { warnings: legacyWarnings } : {}),
    };
  } catch (e) {
    writeUpgradeJournal(root, id, { ...journal, status: "failed" });
    fail(`workspace upgrade failed (recover with: jspace workspace upgrade --rollback ${id}): ${(e as Error).message}`);
  }
}
