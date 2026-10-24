// application/ingest/bundle.ts — staged bundle copy, resume, completion and
// conservative rollback. Long scans/copies run outside the short ingest lock;
// the journal's `operation` token fences a live copier from a second worker.
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  bundleManifestRelPath,
  serializeAssetBundleManifest,
  type AssetBundleManifestV1,
  type BundleMember,
} from "../../core/contracts/asset-bundle.ts";
import type {
  IngestBundleGbrainEvidence,
  IngestBundleJournalV3,
  IngestIndexEvidence,
} from "../../core/contracts/ingest.ts";
import { isCurrentOwnershipLine } from "../filehub/index-parse.ts";
import {
  compareBundleTree,
  entryMember,
  manifestIdentityIssues,
  readBundleManifest,
  scanBundleTree,
  sha256FileNoFollow,
  type BundleTreeScan,
} from "../filehub/bundle.ts";
import { withIngestMutationLock } from "../lock.ts";
import { localStamp } from "../time.ts";
import { readJournal, readJournals, writeJournal, type IngestFileOps } from "./journal.ts";

export interface BundlePrepareInput {
  source: string;
  target: string;
  ownerRootRel: string;
  rootRelPath: string;
  entry: string;
  ownerKind: "project" | "area";
  ownerId: string;
  slug: string;
  indexPath: string;
  indexEntry: string;
}

export interface BundleIngestPlan {
  journal: Omit<IngestBundleJournalV3, "id" | "status" | "operation" | "createdAt" | "updatedAt">;
  manifest: AssetBundleManifestV1;
  manifestText: string;
}

function safeSourceLabel(source: string): string {
  return `inbox/${basename(source)}`;
}

function membersFromScan(scan: BundleTreeScan): BundleMember[] {
  return [
    ...scan.directories.map((path): BundleMember => ({ path, kind: "dir" })),
    ...scan.files.map(
      (file): BundleMember => ({
        path: file.path,
        kind: "file",
        size: file.size,
        sha256: file.sha256,
        executable: file.executable,
      }),
    ),
  ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

export function buildBundleManifest(input: {
  scan: BundleTreeScan;
  ownerKind: "project" | "area";
  ownerId: string;
  slug: string;
  rootRelPath: string;
  entry: string;
  sourceLabel: string;
  sourceVersion?: string;
}): AssetBundleManifestV1 {
  if (input.scan.state !== "ok" || input.scan.aggregateSha256 === undefined) {
    throw new Error(`bundle preflight failed: ${input.scan.detail ?? "source tree is not readable"}`);
  }
  const members = membersFromScan(input.scan);
  if (!members.some((member) => member.kind === "file" && member.path === input.entry)) {
    throw new Error(`bundle entry is not a regular member file: ${input.entry}`);
  }
  return {
    schema_version: 1,
    kind: "asset-bundle",
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    slug: input.slug,
    rootRelPath: input.rootRelPath,
    entry: input.entry,
    source: {
      label: input.sourceLabel,
      ...(input.sourceVersion !== undefined ? { version: input.sourceVersion } : {}),
    },
    members,
    aggregateSha256: input.scan.aggregateSha256,
  };
}

/** Preflight is entirely outside the ingest lock. It proves the source tree,
 *  entry and deterministic manifest identity before any target exists. */
export function prepareBundlePlan(input: BundlePrepareInput): BundleIngestPlan {
  let sourceStat: ReturnType<typeof lstatSync>;
  try {
    sourceStat = lstatSync(input.source);
  } catch {
    throw new Error(`ingest: bundle source not found: ${input.source}`);
  }
  if (sourceStat.isSymbolicLink()) throw new Error("ingest: bundle source must not be a symlink");
  if (!sourceStat.isDirectory()) throw new Error("ingest: --bundle requires the positional source to be a directory");

  if (input.rootRelPath === input.ownerRootRel) {
    throw new Error("ingest: the owner root cannot itself be a bundle root");
  }
  if (
    input.target === input.ownerRootRel ||
    input.target.includes("/.jspace/") ||
    input.target.endsWith("/.jspace")
  ) {
    throw new Error("ingest: bundle target must not overlap the managed .jspace metadata directory");
  }

  const scan = scanBundleTree(input.source);
  if (scan.state !== "ok") {
    throw new Error(`ingest: bundle preflight refused: ${scan.detail}`);
  }
  const label = safeSourceLabel(input.source);
  const manifest = buildBundleManifest({
    scan,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    slug: input.slug,
    rootRelPath: input.rootRelPath,
    entry: input.entry,
    sourceLabel: label,
  });
  const manifestText = serializeAssetBundleManifest(manifest);
  const entry = entryMember(manifest);
  if (entry === null) throw new Error("ingest: bundle entry is not a regular member file");
  return {
    manifest,
    manifestText,
    journal: {
      schema_version: 3,
      kind: "bundle",
      source: input.source,
      target: input.target,
      relPath: input.entry,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      slug: input.slug,
      indexPath: input.indexPath,
      indexEntry: input.indexEntry,
      sourcePolicy: "retain",
      manifestRelPath: bundleManifestRelPath(input.ownerRootRel, input.slug),
      manifestSha256: createHash("sha256").update(manifestText, "utf-8").digest("hex"),
      aggregateSha256: manifest.aggregateSha256,
      sourceHash: entry.sha256,
    },
  };
}

export type BundleBeginResult =
  | { kind: "created" | "duplicate" | "resume" | "resume-required" | "busy" | "failed" | "target-exists" | "conflict"; journal?: IngestBundleJournalV3; message?: string };

function sameBundleIdentity(
  journal: IngestBundleJournalV3,
  plan: {
    source: string;
    target: string;
    relPath: string;
    ownerKind: string;
    ownerId: string;
    slug: string;
    indexPath: string;
    indexEntry: string;
    manifestSha256: string;
    aggregateSha256: string;
  },
): boolean {
  return (
    journal.source === plan.source &&
    journal.target === plan.target &&
    journal.relPath === plan.relPath &&
    journal.ownerKind === plan.ownerKind &&
    journal.ownerId === plan.ownerId &&
    journal.slug === plan.slug &&
    journal.indexPath === plan.indexPath &&
    journal.indexEntry === plan.indexEntry &&
    journal.manifestSha256 === plan.manifestSha256 &&
    journal.aggregateSha256 === plan.aggregateSha256
  );
}

function pathsOverlap(left: string, right: string): boolean {
  const a = left.replace(/\/+$/, "");
  const b = right.replace(/\/+$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function processState(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

function operationState(journal: IngestBundleJournalV3): "alive" | "dead" | "unknown" | "none" {
  if (journal.operation === undefined) return "none";
  return processState(journal.operation.pid);
}

function bundleJournals(root: string): IngestBundleJournalV3[] {
  return readJournals(root).records.filter(
    (journal): journal is IngestBundleJournalV3 => journal.schema_version === 3,
  );
}

function failEmptyTarget(target: string): void {
  try {
    if (lstatSync(target).isDirectory() && readdirSync(target).length === 0) rmdirSync(target);
  } catch {
    // Preserve anything we cannot prove empty.
  }
}

export function beginBundleIngest(
  root: string,
  plan: BundleIngestPlan,
  filehubRoot: string,
): BundleBeginResult {
  return withIngestMutationLock(root, () => {
    const journals = bundleJournals(root);
    for (const journal of journals) {
      if (sameBundleIdentity(journal, plan.journal)) {
        if (journal.status === "committed") return { kind: "duplicate", journal };
        if (journal.status === "copying") {
          const state = operationState(journal);
          return state === "dead"
            ? { kind: "resume-required", journal, message: `run "jspace ingest advance ${journal.id} --resume-copy"` }
            : { kind: "busy", journal, message: "another copier owns this bundle operation" };
        }
        if (journal.status === "failed") {
          if (journal.failedStep === "copying") {
            const state = operationState(journal);
            return state === "dead"
              ? { kind: "resume-required", journal, message: `run "jspace ingest advance ${journal.id} --resume-copy"` }
              : { kind: "busy", journal, message: "the failed copier may still be alive" };
          }
          return { kind: "failed", journal };
        }
        return { kind: "resume", journal };
      }
      if (
        journal.source === plan.journal.source ||
        journal.slug === plan.journal.slug ||
        pathsOverlap(journal.target, plan.journal.target)
      ) {
        return {
          kind: "conflict",
          journal,
          message: `bundle overlaps an existing ${journal.status} journal (same source, slug or target root)`,
        };
      }
    }

    if (existsSync(plan.journal.target)) return { kind: "target-exists" };
    const manifestAbs = resolve(filehubRoot, plan.journal.manifestRelPath);
    if (existsSync(manifestAbs)) {
      return {
        kind: "conflict",
        message: `bundle manifest already exists without a matching journal: ${plan.journal.manifestRelPath}`,
      };
    }

    try {
      mkdirSync(dirname(plan.journal.target), { recursive: true });
      mkdirSync(plan.journal.target);
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") return { kind: "target-exists" };
      throw error;
    }

    const now = localStamp();
    const journal: IngestBundleJournalV3 = {
      ...plan.journal,
      id: crypto.randomUUID(),
      status: "copying",
      operation: { token: crypto.randomUUID(), pid: process.pid },
      createdAt: now,
      updatedAt: now,
    };
    try {
      writeJournal(root, journal);
    } catch (error) {
      failEmptyTarget(plan.journal.target);
      throw error;
    }
    return { kind: "created", journal };
  });
}

export interface BundleCopyHooks {
  /** Test seam: throw to simulate an interrupted copy. The journal remains a
   *  resumable `copying` failure and no checkpoint evidence is synthesized. */
  afterFile?: (path: string, copiedCount: number) => void;
}

function throwIfScanFailed(scan: BundleTreeScan, stage: string): void {
  if (scan.state !== "ok") {
    throw new Error(`bundle ${stage} failed: ${scan.detail ?? "tree is not readable"}`);
  }
}

function ensureDirectory(path: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    mkdirSync(path);
    return;
  }
  if (stat.isSymbolicLink()) throw new Error(`bundle target path is a symlink: ${path}`);
  if (!stat.isDirectory()) throw new Error(`bundle target path is not a directory: ${path}`);
}

function writeFileExclusive(
  sourcePath: string,
  targetPath: string,
  member: { size: number; sha256: string; executable: boolean },
): void {
  const sourceFd = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let targetFd: number | null = null;
  let createdTarget = false;
  try {
    const sourceStat = fstatSync(sourceFd);
    if (!sourceStat.isFile() || sourceStat.size !== member.size) {
      throw new Error(`bundle source member changed during copy: ${member.size} bytes expected`);
    }
    targetFd = openSync(targetPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    createdTarget = true;
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let read = 0;
    while ((read = readSync(sourceFd, chunk, 0, chunk.length, null)) > 0) {
      let offset = 0;
      while (offset < read) {
        offset += writeSync(targetFd, chunk, offset, read - offset);
      }
    }
    closeSync(targetFd);
    targetFd = null;
    if (process.platform !== "win32") chmodSync(targetPath, member.executable ? 0o755 : 0o644);
    const actual = sha256FileNoFollow(targetPath);
    if (actual !== member.sha256) {
      throw new Error(`bundle target member bytes do not match the source plan: ${member.sha256.slice(0, 12)}…`);
    }
  } catch (error) {
    // A partial target this call created is not a user edit; remove it so a
    // resume can re-copy the member instead of reporting a false conflict.
    if (createdTarget) {
      try {
        unlinkSync(targetPath);
      } catch {
        // Preserve anything we cannot remove.
      }
    }
    throw error;
  } finally {
    closeSync(sourceFd);
    if (targetFd !== null) closeSync(targetFd);
  }
}

function writeManifestExclusive(path: string, text: string, expectedSha: string): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, text, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    let existing: Buffer;
    try {
      existing = readFileSync(path);
    } catch {
      throw new Error("bundle manifest already exists and could not be read");
    }
    const actual = createHash("sha256").update(existing).digest("hex");
    if (actual !== expectedSha || existing.toString("utf-8") !== text) {
      throw new Error("bundle manifest already exists with different bytes; refusing to overwrite it");
    }
  }
}

function expectedEntryHash(scan: BundleTreeScan, entry: string): string {
  const file = scan.files.find((candidate) => candidate.path === entry);
  if (file === undefined) throw new Error(`bundle entry is missing from the target tree: ${entry}`);
  return file.sha256;
}

/** Copy/resume against a deterministic manifest. The target root already exists
 *  (created exclusively by begin); existing identical members are skipped. */
export function copyBundleTree(
  sourceRoot: string,
  targetRoot: string,
  manifest: AssetBundleManifestV1,
  hooks: BundleCopyHooks = {},
): { targetScan: BundleTreeScan; targetHash: string } {
  const before = scanBundleTree(sourceRoot);
  throwIfScanFailed(before, "source preflight");
  if (before.aggregateSha256 !== manifest.aggregateSha256) {
    throw new Error("bundle source changed after begin; source and target were preserved");
  }
  const targetStat = lstatSync(targetRoot);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error("bundle target root disappeared or is no longer a directory");
  }

  let copiedCount = 0;
  for (const member of manifest.members) {
    const sourcePath = resolve(sourceRoot, member.path);
    const targetPath = resolve(targetRoot, member.path);
    if (member.kind === "dir") {
      ensureDirectory(targetPath);
      continue;
    }
    ensureDirectory(dirname(targetPath));
    if (existsSync(targetPath)) {
      const stat = lstatSync(targetPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`bundle target member conflicts with the plan: ${member.path}`);
      }
      if (stat.size === member.size && sha256FileNoFollow(targetPath) === member.sha256) continue;
      throw new Error(`bundle target member changed or is extra; refusing to overwrite it: ${member.path}`);
    }
    writeFileExclusive(sourcePath, targetPath, member);
    copiedCount += 1;
    hooks.afterFile?.(member.path, copiedCount);
  }

  const after = scanBundleTree(sourceRoot);
  throwIfScanFailed(after, "source recheck");
  if (after.aggregateSha256 !== manifest.aggregateSha256) {
    throw new Error("bundle source changed during copy; source and target were preserved");
  }
  const targetScan = scanBundleTree(targetRoot);
  throwIfScanFailed(targetScan, "target verification");
  const comparison = compareBundleTree(manifest, targetScan);
  if (
    targetScan.aggregateSha256 !== manifest.aggregateSha256 ||
    comparison.missing.length > 0 ||
    comparison.extra.length > 0 ||
    comparison.changed.length > 0
  ) {
    throw new Error(
      `bundle target does not match the plan (missing ${comparison.missing.length}, extra ${comparison.extra.length}, changed ${comparison.changed.length}); nothing was overwritten`,
    );
  }
  return { targetScan, targetHash: expectedEntryHash(targetScan, manifest.entry) };
}

function recordCopyFailure(root: string, id: string, token: string, reason: string): void {
  withIngestMutationLock(root, () => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3 || journal.status !== "copying") return;
    if (journal.operation?.token !== token) return;
    writeJournal(root, {
      ...journal,
      status: "failed",
      failedStep: "copying",
      failureReason: reason,
      updatedAt: localStamp(),
    });
  });
}

function finalizeCopy(root: string, id: string, token: string, targetHash: string): IngestBundleJournalV3 {
  return withIngestMutationLock(root, () => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
    if (journal.status !== "copying" || journal.operation?.token !== token) {
      throw new Error(`ingest ${id}: the copying operation was taken over by another worker`);
    }
    const staged: IngestBundleJournalV3 = {
      ...journal,
      status: "staged",
      targetHash,
      updatedAt: localStamp(),
    };
    delete (staged as { operation?: unknown }).operation;
    writeJournal(root, staged);
    return staged;
  });
}

export interface BundleCopyOutcome {
  kind: "staged" | "failed";
  journal: IngestBundleJournalV3;
  error?: Error;
}

function executeBundleCopy(
  root: string,
  journal: IngestBundleJournalV3,
  filehubRoot: string,
  hooks: BundleCopyHooks = {},
): BundleCopyOutcome {
  const token = journal.operation?.token;
  if (token === undefined) throw new Error(`ingest ${journal.id}: copying journal has no operation token`);
  try {
    // The manifest's rootRelPath is filehub-relative. Reconstruct it from the
    // absolute target and the registered root that the caller already verified.
    const rootRelPath = relative(filehubRoot, journal.target).replace(/\\/g, "/");
    const scan = scanBundleTree(journal.source);
    throwIfScanFailed(scan, "source preflight");
    const manifest = buildBundleManifest({
      scan,
      ownerKind: journal.ownerKind,
      ownerId: journal.ownerId,
      slug: journal.slug,
      rootRelPath,
      entry: journal.relPath,
      sourceLabel: safeSourceLabel(journal.source),
    });
    const manifestText = serializeAssetBundleManifest(manifest);
    const manifestSha = createHash("sha256").update(manifestText, "utf-8").digest("hex");
    if (
      manifest.aggregateSha256 !== journal.aggregateSha256 ||
      manifestSha !== journal.manifestSha256
    ) {
      throw new Error("bundle source members changed after the copying plan; resolve the conflict explicitly");
    }
    const copied = copyBundleTree(journal.source, journal.target, manifest, hooks);
    writeManifestExclusive(resolve(filehubRoot, journal.manifestRelPath), manifestText, journal.manifestSha256);
    const result = finalizeCopy(root, journal.id, token, copied.targetHash);
    return { kind: "staged", journal: result };
  } catch (error) {
    const reason = (error as Error).message;
    try {
      recordCopyFailure(root, journal.id, token, reason);
    } catch {
      // The journal remains copying; resume can still verify the target.
    }
    return {
      kind: "failed",
      journal: readJournal(root, journal.id) as IngestBundleJournalV3,
      error: error as Error,
    };
  }
}

export function runCreatedBundleCopy(
  root: string,
  journal: IngestBundleJournalV3,
  filehubRoot: string,
  hooks: BundleCopyHooks = {},
): BundleCopyOutcome {
  return executeBundleCopy(root, journal, filehubRoot, hooks);
}

export type BundleResumeResult =
  | { kind: "busy" | "not-resumable" | "staged"; journal: IngestBundleJournalV3; error?: Error };

export function resumeBundleCopy(
  root: string,
  id: string,
  filehubRoot: string,
  hooks: BundleCopyHooks = {},
): BundleResumeResult {
  const claimed = withIngestMutationLock(root, (): IngestBundleJournalV3 | null => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
    const resumable =
      journal.status === "copying" ||
      (journal.status === "failed" && journal.failedStep === "copying");
    if (!resumable) throw new Error(`ingest ${id}: only copying or failed-copying bundles can resume`);
    const state = operationState(journal);
    if (state === "alive" || state === "unknown") return null;
    const claimed: IngestBundleJournalV3 = {
      ...journal,
      status: "copying",
      operation: { token: crypto.randomUUID(), pid: process.pid },
      updatedAt: localStamp(),
    };
    delete (claimed as { failedStep?: unknown }).failedStep;
    delete (claimed as { failureReason?: unknown }).failureReason;
    writeJournal(root, claimed);
    return claimed;
  });
  if (claimed === null) {
    return { kind: "busy", journal: readJournal(root, id) as IngestBundleJournalV3 };
  }
  const outcome = executeBundleCopy(root, claimed, filehubRoot, hooks);
  return {
    kind: outcome.kind === "staged" ? "staged" : "not-resumable",
    journal: outcome.journal,
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };
}

function manifestForJournal(
  filehubRoot: string,
  journal: IngestBundleJournalV3,
): { manifest: AssetBundleManifestV1; targetScan: BundleTreeScan } | { error: string } {
  const read = readBundleManifest(filehubRoot, journal.manifestRelPath);
  if (read.state !== "ok" || read.manifest === undefined || read.manifestSha256 === undefined) {
    return { error: `bundle manifest is not readable (${read.state}): ${read.detail ?? ""}`.trim() };
  }
  if (read.manifestSha256 !== journal.manifestSha256) {
    return { error: "bundle manifest bytes changed after staging" };
  }
  if (read.manifest.aggregateSha256 !== journal.aggregateSha256) {
    return { error: "bundle manifest aggregate changed after staging" };
  }
  const rootRelPath = relative(filehubRoot, journal.target).replace(/\\/g, "/");
  const identity = manifestIdentityIssues(read.manifest, {
    ownerKind: journal.ownerKind,
    ownerId: journal.ownerId,
    slug: journal.slug,
    rootRelPath,
    entry: journal.relPath,
  });
  if (identity.length > 0) return { error: identity.join("; ") };
  const targetScan = scanBundleTree(journal.target);
  if (targetScan.state !== "ok") {
    return { error: `bundle target is not verifiable: ${targetScan.detail ?? "unreadable"}` };
  }
  const comparison = compareBundleTree(read.manifest, targetScan);
  if (
    targetScan.aggregateSha256 !== read.manifest.aggregateSha256 ||
    comparison.missing.length > 0 ||
    comparison.extra.length > 0 ||
    comparison.changed.length > 0
  ) {
    return { error: "bundle target no longer matches its manifest" };
  }
  return { manifest: read.manifest, targetScan };
}

export function recordBundleGbrainCheckpoint(
  root: string,
  id: string,
  evidence: IngestBundleGbrainEvidence,
): IngestBundleJournalV3 {
  return withIngestMutationLock(root, () => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
    if (journal.status !== "staged") {
      throw new Error(`ingest ${id}: cannot advance to gbrain from ${journal.status}`);
    }
    if (
      evidence.slug !== journal.slug ||
      evidence.ownerKind !== journal.ownerKind ||
      evidence.ownerId !== journal.ownerId ||
      evidence.relPath !== journal.relPath ||
      evidence.assetKind !== "bundle" ||
      evidence.bundleManifest !== journal.manifestRelPath ||
      evidence.bundleSha256 !== journal.aggregateSha256 ||
      evidence.bundleManifestSha256 !== journal.manifestSha256 ||
      (evidence.sourceSha256 !== undefined && evidence.sourceSha256 !== journal.targetHash)
    ) {
      throw new Error(`ingest ${id}: gbrain evidence does not match the bundle plan`);
    }
    const updated: IngestBundleJournalV3 = {
      ...journal,
      status: "gbrain",
      gbrainEvidence: evidence,
      updatedAt: localStamp(),
    };
    writeJournal(root, updated);
    return updated;
  });
}

export function recordBundleIndexCheckpoint(
  root: string,
  id: string,
  evidence: IngestIndexEvidence,
): IngestBundleJournalV3 {
  return withIngestMutationLock(root, () => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
    if (journal.status !== "gbrain") {
      throw new Error(`ingest ${id}: cannot advance to index from ${journal.status}`);
    }
    const updated: IngestBundleJournalV3 = {
      ...journal,
      status: "index",
      indexEvidence: evidence,
      updatedAt: localStamp(),
    };
    writeJournal(root, updated);
    return updated;
  });
}

export type BundleCompleteResult =
  | { kind: "committed"; journal: IngestBundleJournalV3 }
  | { kind: "blocked"; journal: IngestBundleJournalV3; error: Error };

export function completeBundleIngest(
  root: string,
  id: string,
  filehubRoot: string,
  readIndex: IngestFileOps["readIndex"],
  refreshedGbrainEvidence?: IngestBundleGbrainEvidence,
): BundleCompleteResult {
  const journal = readJournal(root, id);
  if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
  if (journal.status !== "index") {
    throw new Error(`ingest ${id}: cannot complete from ${journal.status}; only index may complete`);
  }
  const gbrainEvidence = refreshedGbrainEvidence ?? journal.gbrainEvidence;
  if (gbrainEvidence === undefined || journal.indexEvidence === undefined) {
    throw new Error(`ingest ${id}: completion requires verified gbrain and index evidence`);
  }
  if (
    gbrainEvidence.slug !== journal.slug ||
    gbrainEvidence.ownerKind !== journal.ownerKind ||
    gbrainEvidence.ownerId !== journal.ownerId ||
    gbrainEvidence.relPath !== journal.relPath ||
    gbrainEvidence.assetKind !== "bundle" ||
    gbrainEvidence.bundleManifest !== journal.manifestRelPath ||
    gbrainEvidence.bundleSha256 !== journal.aggregateSha256 ||
    gbrainEvidence.bundleManifestSha256 !== journal.manifestSha256
  ) {
    throw new Error(`ingest ${id}: refreshed gbrain evidence does not match the bundle plan`);
  }

  const block = (reason: string): BundleCompleteResult => {
    const blocked: IngestBundleJournalV3 = {
      ...journal,
      status: "failed",
      failedStep: "index",
      failureReason: reason,
      updatedAt: localStamp(),
    };
    try {
      writeJournal(root, blocked);
    } catch {
      // Keep the durable index checkpoint; the next completion retries.
    }
    return { kind: "blocked", journal: blocked, error: new Error(reason) };
  };

  const verified = manifestForJournal(filehubRoot, journal);
  if ("error" in verified) return block(verified.error);
  const entry = expectedEntryHash(verified.targetScan, journal.relPath);
  if (entry !== journal.targetHash || entry !== journal.sourceHash) {
    return block("bundle entry bytes no longer match the staged copy identity");
  }

  let indexContent: string;
  try {
    indexContent = readIndex(journal.indexPath);
  } catch (error) {
    return block(`index ${journal.indexPath} is not readable: ${(error as Error).message}`);
  }
  if (!isCurrentOwnershipLine(indexContent, journal.indexEntry)) {
    return block(`index ${journal.indexPath} does not contain the exact planned line as a current ownership row`);
  }

  return withIngestMutationLock(root, () => {
    const current = readJournal(root, id);
    if (current.schema_version !== 3 || current.status !== "index") {
      return block(`ingest ${id}: journal changed before completion`);
    }
    const committed: IngestBundleJournalV3 = {
      ...current,
      status: "committed",
      gbrainEvidence,
      updatedAt: localStamp(),
    };
    delete (committed as { failedStep?: unknown }).failedStep;
    delete (committed as { failureReason?: unknown }).failureReason;
    delete (committed as { operation?: unknown }).operation;
    try {
      writeJournal(root, committed);
    } catch (error) {
      return block(`could not persist committed state: ${(error as Error).message}`);
    }
    return { kind: "committed", journal: committed };
  });
}

export function failBundleIngest(root: string, id: string, reason: string): IngestBundleJournalV3 {
  return withIngestMutationLock(root, () => {
    const journal = readJournal(root, id);
    if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
    if (journal.status === "committed") throw new Error(`ingest ${id} is already committed`);
    if (journal.status === "failed") throw new Error(`ingest ${id} is already failed`);
    if (journal.status === "copying") {
      const state = operationState(journal);
      if (state !== "dead") {
        throw new Error(`ingest ${id}: the copier process is ${state}; it must be dead before failure is recorded`);
      }
    }
    const failedStep =
      journal.status === "copying"
        ? "copying"
        : journal.status === "staged"
          ? "staged"
          : journal.status === "gbrain"
            ? "gbrain"
            : "index";
    const failed: IngestBundleJournalV3 = {
      ...journal,
      status: "failed",
      failedStep,
      failureReason: reason,
      updatedAt: localStamp(),
    };
    writeJournal(root, failed);
    return failed;
  });
}

export interface BundleRollbackResult {
  journal: IngestBundleJournalV3;
  removed: number;
  retained: number;
}

/** Roll back only bytes this journal can prove it created: target files whose
 *  digest still matches the manifest, then empty directories. Extra/changed
 *  content is preserved, and the inbox source is never touched. */
export function rollbackBundleIngest(
  root: string,
  id: string,
  filehubRoot: string,
): BundleRollbackResult {
  const journal = readJournal(root, id);
  if (journal.schema_version !== 3) throw new Error(`ingest ${id}: not a bundle journal`);
  if (journal.status !== "copying" && journal.status !== "staged") {
    throw new Error(`ingest ${id}: rollback is only allowed before the gbrain checkpoint`);
  }
  if (journal.status === "copying" && operationState(journal) !== "dead") {
    throw new Error(`ingest ${id}: the copier process is still alive or unknown`);
  }
  const read = readBundleManifest(filehubRoot, journal.manifestRelPath);
  let removed = 0;
  let retained = 0;
  if (read.state === "ok" && read.manifest !== undefined) {
    for (const member of read.manifest.members) {
      const path = resolve(journal.target, member.path);
      if (member.kind === "dir") continue;
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          retained += 1;
          continue;
        }
        if (stat.size === member.size && sha256FileNoFollow(path) === member.sha256) {
          unlinkSync(path);
          removed += 1;
        } else {
          retained += 1;
        }
      } catch {
        // Missing is fine; anything else is not provably ours.
      }
    }
    const directories = read.manifest.members
      .filter((member): member is Extract<BundleMember, { kind: "dir" }> => member.kind === "dir")
      .map((member) => member.path)
      .sort((a, b) => b.split("/").length - a.split("/").length);
    for (const dir of directories) {
      try {
        rmdirSync(resolve(journal.target, dir));
      } catch {
        // Non-empty (extra/changed content) stays.
      }
    }
  } else {
    retained += 1;
  }

  const manifestAbs = resolve(filehubRoot, journal.manifestRelPath);
  try {
    const bytes = readFileSync(manifestAbs);
    if (createHash("sha256").update(bytes).digest("hex") === journal.manifestSha256) {
      unlinkSync(manifestAbs);
      removed += 1;
    } else {
      retained += 1;
    }
  } catch {
    // Missing manifest is acceptable; an unreadable one is retained.
  }
  try {
    rmdirSync(journal.target);
  } catch {
    // Extra content keeps the root in place.
  }

  const failed: IngestBundleJournalV3 = {
    ...journal,
    status: "failed",
    failedStep: journal.status === "copying" ? "copying" : "staged",
    failureReason:
      retained === 0
        ? "rolled back"
        : `rollback incomplete: ${retained} changed/extra object(s) were preserved; inbox source remains`,
    updatedAt: localStamp(),
  };
  writeJournal(root, failed);
  return { journal: failed, removed, retained };
}
