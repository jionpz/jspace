// One-time migrations for data contracts retired from normal runtime reads.
// Every planner here is read-only. Workspace upgrade owns backups and writes so
// dry-runs can prove that no file, lock, or marker was touched.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { HubV1 } from "../../core/contracts/hub.ts";
import {
  decodeIngestJournal,
  decodeLegacyIngestJournal,
  type IngestJournalV1Legacy,
  type IngestJournalV2,
  type IngestStep,
} from "../../core/contracts/ingest.ts";
import {
  decodeLegacyPendingEnvelope,
  decodePendingEnvelope,
  ENVELOPE_EXT,
  type PendingWriteEnvelopeV2,
} from "../../core/contracts/pending.ts";
import { parseMemoryMarkdown } from "../../core/contracts/memory.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LEGACY_PENDING_DIR = ".jspace-logs";
const CURRENT_PENDING_DIR = join(CONFIG_DIR, "state", "pending");
const INGEST_DIR = join(CONFIG_DIR, "state", "ingest");

export interface WorkbenchMigrationOp {
  action: "migrate";
  rel: string;
  reason: string;
  expectedContent: string | null;
  content: string;
}

/** A legacy pending envelope moving from the shared filehub into the owning
 *  workbench. The old file is outside the workbench, so it is backed up and
 *  retired separately from the workbench-relative upgrade journal plan. */
export interface LegacyPendingMove {
  id: string;
  slug: string;
  sourceAbs: string;
  sourceLabel: string;
  sourceContent: string;
  targetRel: string;
  targetContent: string;
}

export interface LegacyMigrationNotice {
  code: string;
  subject: string;
  message: string;
}

export interface LegacyPendingMigrationPlan {
  moves: LegacyPendingMove[];
  notices: LegacyMigrationNotice[];
}

export interface LegacyIngestMigrationPlan {
  ops: WorkbenchMigrationOp[];
  notices: LegacyMigrationNotice[];
}

export interface LegacyMigrationReadDeps {
  hub: HubV1 | null;
  filehubRoot: string | null;
  readFile: (path: string) => string | null;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = new Uint8Array(65536);
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count <= 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function parseJson(raw: string | null): unknown | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function notice(code: string, subject: string, message: string): LegacyMigrationNotice {
  return { code, subject, message };
}

function projectIdFromSlug(slug: string): string | null {
  const match = slug.match(/^(?:project|assets|records\/project)\/([^/]+)\//);
  return match?.[1] ?? null;
}

function provenanceSafe(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

function pendingTargetRel(id: string): string {
  return join(CURRENT_PENDING_DIR, `${id}${ENVELOPE_EXT}`).replace(/\\/g, "/");
}

function samePendingEnvelope(a: unknown, b: PendingWriteEnvelopeV2): boolean {
  const decoded = decodePendingEnvelope(a);
  return decoded.ok && JSON.stringify(decoded.value) === JSON.stringify(b);
}

/** Only records that can be tied independently to this workbench's registry are
 *  moved. Slug-root + frontmatter project + (for assets) rel_path ownership must
 *  all agree; anything else stays in the shared filehub for manual mapping. */
export function planLegacyPendingMigrations(
  deps: LegacyMigrationReadDeps,
): LegacyPendingMigrationPlan {
  const moves: LegacyPendingMove[] = [];
  const notices: LegacyMigrationNotice[] = [];
  if (deps.filehubRoot === null) return { moves, notices };
  const legacyDir = join(deps.filehubRoot, LEGACY_PENDING_DIR);
  if (!existsSync(legacyDir)) return { moves, notices };
  if (deps.hub === null) {
    notices.push(notice(
      "pending.legacy.hub",
      LEGACY_PENDING_DIR,
      "legacy pending envelopes were left in place because hub.json is unavailable",
    ));
    return { moves, notices };
  }

  const projects = new Map(deps.hub.projects.map((project) => [project.id, project]));
  for (const name of readDir(legacyDir)) {
    if (!name.endsWith(ENVELOPE_EXT)) continue;
    const sourceAbs = join(legacyDir, name);
    const raw = deps.readFile(sourceAbs);
    const parsed = parseJson(raw);
    if (raw === null || parsed === undefined) {
      notices.push(notice("pending.legacy.parse", name, "legacy pending file is unreadable or not valid JSON; left in place"));
      continue;
    }
    const legacy = decodeLegacyPendingEnvelope(parsed);
    if (!legacy.ok) {
      notices.push(notice(
        "pending.legacy.decode",
        name,
        `legacy pending file does not match schema 1: ${legacy.issues.map((issue) => issue.message).join("; ")}`,
      ));
      continue;
    }
    const envelope = legacy.value;
    if (basename(name, ENVELOPE_EXT) !== envelope.id) {
      notices.push(notice("pending.legacy.id", name, `filename does not match envelope id ${envelope.id}; left in place`));
      continue;
    }
    if (!provenanceSafe(envelope.idempotencyKey)) {
      notices.push(notice("pending.legacy.hash", envelope.id, "idempotencyKey is not a sha256 digest; left in place"));
      continue;
    }
    if (sha256Text(envelope.content) !== envelope.idempotencyKey) {
      notices.push(notice("pending.legacy.hash", envelope.id, "content does not match idempotencyKey; left in place"));
      continue;
    }

    const projectId = projectIdFromSlug(envelope.slug);
    if (projectId === null) {
      notices.push(notice("pending.legacy.owner", envelope.id, "slug has no project owner; left in shared filehub"));
      continue;
    }
    const project = projects.get(projectId);
    if (!project) {
      notices.push(notice("pending.legacy.owner", envelope.id, `project ${projectId} is not registered in this workbench; left in place`));
      continue;
    }
    const content = parseMemoryMarkdown(envelope.content);
    if (content.fields.project !== projectId) {
      notices.push(notice("pending.legacy.owner", envelope.id, "frontmatter project does not prove this workbench owns the write; left in place"));
      continue;
    }
    if (envelope.slug.startsWith("assets/")) {
      const relPath = content.fields.rel_path;
      if (
        relPath === undefined ||
        !relPath.startsWith(`${project.asset_rel_path}/`) ||
        relPath.split("/").some((part) => part === "." || part === "..")
      ) {
        notices.push(notice("pending.legacy.owner", envelope.id, "asset rel_path is missing or outside the registered project; left in place"));
        continue;
      }
    }

    const targetRel = pendingTargetRel(envelope.id);
    const target: PendingWriteEnvelopeV2 = {
      schema_version: 2,
      id: envelope.id,
      requestId: envelope.id,
      intent: "create",
      contentHash: envelope.idempotencyKey,
      contentOrigin: "inferred",
      sourceId: `jspace:legacy-pending:${envelope.producer}:${envelope.id}`,
      producer: envelope.producer,
      slug: envelope.slug,
      content: envelope.content,
      status: envelope.status,
      retryCount: envelope.retryCount,
      createdAt: envelope.createdAt,
      ...(envelope.appliedAt !== undefined ? { appliedAt: envelope.appliedAt } : {}),
      ...(envelope.error !== undefined ? { error: envelope.error } : {}),
    };
    const decodedTarget = decodePendingEnvelope(target);
    if (!decodedTarget.ok) {
      notices.push(notice(
        "pending.legacy.target",
        envelope.id,
        `migrated envelope would be invalid: ${decodedTarget.issues.map((issue) => issue.message).join("; ")}`,
      ));
      continue;
    }

    const targetContent = JSON.stringify(decodedTarget.value, null, 2) + "\n";
    moves.push({
      id: envelope.id,
      slug: envelope.slug,
      sourceAbs,
      sourceLabel: `${LEGACY_PENDING_DIR}/${name}`,
      sourceContent: raw,
      targetRel,
      targetContent,
    });
  }
  return { moves, notices };
}

export interface LegacyPendingWorkbenchPlan extends LegacyPendingMigrationPlan {
  ops: WorkbenchMigrationOp[];
}

/** Complete the pending plan with workbench-root target checks. */
export function planLegacyPendingMigrationsForWorkbench(
  root: string,
  deps: LegacyMigrationReadDeps,
): LegacyPendingWorkbenchPlan {
  const base = planLegacyPendingMigrations(deps);
  const ops: WorkbenchMigrationOp[] = [];
  const moves: LegacyPendingMove[] = [];
  const notices = [...base.notices];
  for (const move of base.moves) {
    const currentRaw = deps.readFile(join(root, move.targetRel));
    if (currentRaw !== null) {
      const current = parseJson(currentRaw);
      if (current === undefined || !samePendingEnvelope(current, JSON.parse(move.targetContent))) {
        notices.push(notice(
          "pending.legacy.target_conflict",
          move.id,
          `canonical pending target already exists with different content: ${move.targetRel}; source left in place`,
        ));
        continue;
      }
    } else {
      ops.push({
        action: "migrate",
        rel: move.targetRel,
        reason: "legacy pending schema 1 -> schema 2 (ownership proven)",
        expectedContent: null,
        content: move.targetContent,
      });
    }
    moves.push(move);
  }
  return { ops, moves, notices };
}

function insideProject(relPath: string, projectRoot: string): boolean {
  return relPath.startsWith(`${projectRoot}/`) &&
    !relPath.split("/").some((part) => part === "." || part === "..");
}

function isWithinAbsolute(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function blockedLegacyStatus(
  legacy: IngestJournalV1Legacy,
): { status: "staged" | "failed"; failedStep?: IngestStep; failureReason?: string } {
  if (legacy.status === "staged") return { status: "staged" };
  if (legacy.status === "failed") {
    if (legacy.failedStep === "staged") {
      return {
        status: "failed",
        failedStep: "staged",
        failureReason: legacy.failureReason ?? "legacy schema-1 failure (reason was not recorded)",
      };
    }
    return {
      status: "failed",
      failedStep: "staged",
      failureReason:
        `legacy schema-1 journal failed at ${legacy.failedStep ?? "an unrecorded checkpoint"} ` +
        "without verifiable current evidence; downgraded to staged so it cannot be treated as cleanup-pending",
    };
  }
  return {
    status: "failed",
    failedStep: "staged",
    failureReason:
      `legacy schema-1 journal claimed ${legacy.status} without verifiable evidence; ` +
      "migrated as blocked at staged so no checkpoint is treated as proven",
  };
}

/** Migrate schema-1 ingest journals only when the owner/index plan can be derived
 *  from the current registry and the staged target still preserves the original
 *  content hash. Old checkpoint claims without evidence become blocked journals;
 *  they are never promoted to gbrain/index/committed. */
export function planLegacyIngestMigrations(
  root: string,
  deps: LegacyMigrationReadDeps,
): LegacyIngestMigrationPlan {
  const ops: WorkbenchMigrationOp[] = [];
  const notices: LegacyMigrationNotice[] = [];
  const dir = join(root, INGEST_DIR);
  if (!existsSync(dir)) return { ops, notices };
  if (deps.filehubRoot === null) {
    notices.push(notice(
      "ingest.legacy.filehub",
      INGEST_DIR,
      "legacy ingest journals were left in place because the workbench filehub binding is unavailable",
    ));
    return { ops, notices };
  }
  const filehubRoot = resolve(deps.filehubRoot);
  let realFilehubRoot: string;
  try {
    realFilehubRoot = realpathSync(filehubRoot);
  } catch (error) {
    notices.push(notice(
      "ingest.legacy.filehub",
      INGEST_DIR,
      `legacy ingest journals were left in place because the filehub root is unreadable: ${(error as Error).message}`,
    ));
    return { ops, notices };
  }

  const projects = new Map((deps.hub?.projects ?? []).map((project) => [project.id, project]));
  for (const name of readDir(dir)) {
    if (!name.endsWith(".json")) continue;
    const abs = join(dir, name);
    const raw = deps.readFile(abs);
    const parsed = parseJson(raw);
    if (raw === null || parsed === undefined) {
      notices.push(notice("ingest.legacy.parse", name, "ingest journal is unreadable or not valid JSON; left in place"));
      continue;
    }
    if (decodeIngestJournal(parsed).ok) continue;
    const legacy = decodeLegacyIngestJournal(parsed);
    if (!legacy.ok) {
      notices.push(notice(
        "ingest.legacy.decode",
        name,
        `journal is neither schema 2 nor a valid schema-1 migration input: ${legacy.issues.map((issue) => issue.message).join("; ")}`,
      ));
      continue;
    }
    const journal = legacy.value;
    if (name !== `${journal.id}.json`) {
      notices.push(notice("ingest.legacy.id", journal.id, "filename does not match journal id; left in place"));
      continue;
    }
    if (!provenanceSafe(journal.contentHash)) {
      notices.push(notice("ingest.legacy.hash", journal.id, "contentHash is not a sha256 digest; left in place"));
      continue;
    }
    const project = projects.get(journal.projectId);
    if (!project) {
      notices.push(notice("ingest.legacy.owner", journal.id, `project ${journal.projectId} is not registered; left in place`));
      continue;
    }
    if (!insideProject(journal.relPath, project.asset_rel_path)) {
      notices.push(notice("ingest.legacy.target", journal.id, "target relPath is outside the registered project; left in place"));
      continue;
    }
    if (!journal.slug.startsWith(`assets/${journal.projectId}/`)) {
      notices.push(notice("ingest.legacy.slug", journal.id, "slug does not belong to the registered project; left in place"));
      continue;
    }
    if (journal.indexEntry === undefined || !journal.indexEntry.includes(journal.slug)) {
      notices.push(notice(
        "ingest.legacy.index",
        journal.id,
        "indexEntry is missing or does not name the asset slug; cannot construct the schema-2 index plan without fabricating it",
      ));
      continue;
    }

    const expectedTarget = resolve(filehubRoot, journal.relPath);
    if (resolve(journal.target) !== expectedTarget || !isWithinAbsolute(expectedTarget, filehubRoot)) {
      notices.push(notice(
        "ingest.legacy.target",
        journal.id,
        "absolute target does not match relPath inside the registered filehub; left in place",
      ));
      continue;
    }

    if (existsSync(journal.target)) {
      let targetHash: string;
      try {
        const realTarget = realpathSync(journal.target);
        if (!isWithinAbsolute(realTarget, realFilehubRoot)) {
          throw new Error("target resolves outside the filehub root");
        }
        if (!statSync(journal.target).isFile()) throw new Error("not a regular file");
        targetHash = sha256File(journal.target);
      } catch (error) {
        notices.push(notice("ingest.legacy.target", journal.id, `staged target is unreadable: ${(error as Error).message}`));
        continue;
      }
      if (targetHash !== journal.contentHash) {
        notices.push(notice("ingest.legacy.target", journal.id, "staged target no longer matches the historical contentHash; left in place"));
        continue;
      }
    } else if (journal.status !== "failed") {
      notices.push(notice("ingest.legacy.target", journal.id, "staged target is missing before a terminal checkpoint; left in place"));
      continue;
    }

    const mapped = blockedLegacyStatus(journal);
    const migrated: IngestJournalV2 = {
      schema_version: 2,
      id: journal.id,
      source: journal.source,
      target: journal.target,
      relPath: journal.relPath,
      ownerKind: "project",
      ownerId: journal.projectId,
      slug: journal.slug,
      indexPath: `${project.asset_rel_path}/index.md`,
      indexEntry: journal.indexEntry,
      sourceHash: journal.contentHash,
      targetHash: journal.contentHash,
      status: mapped.status,
      ...(mapped.failedStep !== undefined ? { failedStep: mapped.failedStep } : {}),
      ...(mapped.failureReason !== undefined ? { failureReason: mapped.failureReason } : {}),
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
    };
    const decoded = decodeIngestJournal(migrated);
    if (!decoded.ok) {
      notices.push(notice(
        "ingest.legacy.migrate",
        journal.id,
        `migrated journal would be invalid: ${decoded.issues.map((issue) => issue.message).join("; ")}`,
      ));
      continue;
    }
    ops.push({
      action: "migrate",
      rel: join(INGEST_DIR, name).replace(/\\/g, "/"),
      reason:
        journal.status === mapped.status
          ? "ingest journal schema 1 -> 2 (preserve recorded hashes)"
          : `ingest journal schema 1 -> 2 (${journal.status} -> blocked; preserve recorded hash)`,
      expectedContent: raw,
      content: JSON.stringify(decoded.value, null, 2) + "\n",
    });
  }
  return { ops, notices };
}
