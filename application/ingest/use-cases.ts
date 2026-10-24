// application/ingest/use-cases.ts — `jspace ingest` application surface.
//
// The skill supplies semantics (owner, semantic target, slug, index line);
// this layer proves the mechanical contract:
// - target belongs to the declared project/area;
// - index location is derived from the owner, never supplied ad hoc;
// - gbrain/index checkpoints require real readback before journal advance;
// - source cleanup is guarded by content hashes and exact index evidence.
import { createHash } from "node:crypto";
import { bundleMemberPathIssue } from "../../core/contracts/asset-bundle.ts";
import { isBundleMetadataPath, isRestrictedPath } from "../filehub/path-policy.ts";
import { isCurrentOwnershipLine } from "../filehub/index-parse.ts";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { realGbrain } from "../../adapters/gbrain/gbrain.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import type { CmdResult } from "../commands/command.ts";
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";
import type {
  IngestBundleGbrainEvidence,
  IngestBundleJournalV3,
  IngestGbrainEvidence,
  IngestIndexEvidence,
  IngestJournalV2,
  IngestOwnerKind,
  IngestStep,
} from "../../core/contracts/ingest.ts";
import { fail } from "../../core/shared/errors.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import { confinedWithin, resolveRealPath } from "../registry/helpers.ts";
import { localStamp } from "../time.ts";
import {
  advanceIngest,
  beginIngest,
  completeIngest,
  completeRetryCommand,
  failIngest,
  isCleanupPending,
  readJournal,
  readJournals,
  rollbackIngest,
  type IngestFileOps,
} from "./journal.ts";
import {
  beginBundleIngest,
  completeBundleIngest,
  failBundleIngest,
  prepareBundlePlan,
  recordBundleGbrainCheckpoint,
  recordBundleIndexCheckpoint,
  resumeBundleCopy,
  rollbackBundleIngest,
  runCreatedBundleCopy,
  type BundleBeginResult,
  type BundleCopyOutcome,
} from "./bundle.ts";

function filehubRoot(root: string): string {
  const configured = resolveFilehubRoot(root);
  if (!configured) fail(`no filehub registered for workbench ${root}; run "jspace filehub init" first`);
  if (!existsSync(configured)) fail(`registered filehub root does not exist: ${configured}`);
  try {
    return resolveRealPath(configured);
  } catch (error) {
    fail(`registered filehub root is unreadable: ${configured}: ${(error as Error).message}`);
  }
}

/** File operations are confined to the real filehub root. Target parents may be
 *  created for a semantic subdirectory, but the copy itself is exclusive. */
function filehubOps(root: string): IngestFileOps {
  const fh = filehubRoot(root);
  const confined = (path: string, verb: string): string => {
    const absolute = isAbsolute(path) ? path : resolve(path);
    const real = confinedWithin(absolute, fh);
    if (!real) fail(`refusing to ${verb} a file outside the filehub: ${path}`);
    return real;
  };
  return {
    copyFileExclusive: (source, target) => {
      const realSource = confined(source, "copy");
      const realTarget = confined(target, "copy");
      mkdirSync(dirname(realTarget), { recursive: true });
      copyFileSync(realSource, realTarget, fsConstants.COPYFILE_EXCL);
    },
    unlink: (path) => unlinkSync(confined(path, "remove")),
    readIndex: (relPath) => readFileSync(confined(join(fh, relPath), "read"), "utf-8"),
  };
}

export interface IngestBeginArgs {
  file: string;
  target: string;
  slug: string;
  ownerKind: IngestOwnerKind;
  ownerId: string;
  indexLine: string;
  bundle?: boolean;
  entry?: string;
}

function assertSingleSegment(value: string, label: string): void {
  if (value.length === 0 || value !== value.trim() || value === "." || value === ".." || /[\\/]/.test(value)) {
    fail(`${label} must be one non-empty path segment: ${value}`);
  }
}

function hasExactDirectoryPrefix(relPath: string, root: string): boolean {
  return relPath.startsWith(`${root}/`);
}

function resolveOwner(
  root: string,
  fh: string,
  ownerKind: IngestOwnerKind,
  ownerId: string,
): { ownerRootRel: string; indexPath: string } {
  assertSingleSegment(ownerId, "--owner-id");
  if (ownerKind === "project") {
    const reads = readWorkbenchState(root);
    if (reads.hub.status !== "ok") fail(`cannot read hub.json for workbench ${root}`);
    const project = reads.hub.value.projects.find((candidate) => candidate.id === ownerId);
    if (!project) fail(`no registered project: ${ownerId}; run "jspace project add ${ownerId}" first`);
    if (project.status !== "active") fail(`project ${ownerId} is ${project.status}; choose an active owner`);
    return {
      ownerRootRel: project.asset_rel_path,
      indexPath: `${project.asset_rel_path}/index.md`,
    };
  }

  const ownerRootRel = `areas/${ownerId}`;
  const ownerRootPath = join(fh, ownerRootRel);
  const ownerRoot = confinedWithin(ownerRootPath, fh);
  if (!ownerRoot) fail(`area root escapes the filehub: ${ownerRootRel}`);
  let rootStat: ReturnType<typeof lstatSync>;
  try {
    rootStat = lstatSync(ownerRootPath);
  } catch {
    fail(`no existing area: ${ownerRootRel}; create/confirm the area before filing into it`);
  }
  if (rootStat.isSymbolicLink()) fail(`area root must not be a symlink: ${ownerRootRel}`);
  if (!rootStat.isDirectory()) fail(`area root is not a directory: ${ownerRootRel}`);

  // The owner index is the area's write prerequisite: without a readable,
  // regular, non-symlinked index there is nowhere to register the asset, so we
  // fail before the target or a journal exists.
  const indexPath = `${ownerRootRel}/index.md`;
  const indexAbs = join(fh, indexPath);
  let indexStat: ReturnType<typeof lstatSync>;
  try {
    indexStat = lstatSync(indexAbs);
  } catch {
    fail(`area index is missing: ${indexPath}; create it before filing into ${ownerRootRel}`);
  }
  if (indexStat.isSymbolicLink()) fail(`area index must not be a symlink: ${indexPath}`);
  if (!indexStat.isFile()) fail(`area index is not a regular file: ${indexPath}`);
  let indexRaw: string;
  try {
    indexRaw = readFileSync(indexAbs, "utf-8");
  } catch (error) {
    fail(`area index is unreadable: ${indexPath}: ${(error as Error).message}`);
  }
  const fields = parseFrontmatter(indexRaw);
  const declaredType = (fields.get("type") ?? "").trim();
  if (declaredType !== "" && declaredType !== "area-index") {
    fail(`area index type must be "area-index" or omitted: ${indexPath} declares ${declaredType}`);
  }
  const declaredOwner = (fields.get("owner") ?? fields.get("area") ?? "").trim();
  if (declaredOwner !== "" && declaredOwner !== ownerId) {
    fail(`area index owner must be ${ownerId}: ${indexPath} declares ${declaredOwner}`);
  }
  return { ownerRootRel, indexPath };
}

function validateSlug(slug: string, ownerId: string, bundle: boolean): void {
  const segments = slug.split("/");
  const semantic = bundle ? segments.length === 3 : segments.length >= 3;
  if (
    !semantic ||
    segments[0] !== "assets" ||
    segments[1] !== ownerId ||
    segments.some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(
      bundle
        ? `bundle slug must match assets/${ownerId}/<semantic>: ${slug}`
        : `slug must begin with assets/${ownerId}/ and name a semantic page: ${slug}`,
    );
  }
}

function validateIndexLine(indexLine: string, slug: string): void {
  if (/[\r\n]/.test(indexLine) || indexLine.trim() === "") {
    fail("--index-line must be one non-empty physical line");
  }
  if (!indexLine.includes(slug)) {
    fail(`--index-line must contain the exact gbrain slug ${slug}`);
  }
}

function bundleBeginResult(
  root: string,
  fh: string,
  target: string,
  args: IngestBeginArgs,
  entry: string,
  plan: ReturnType<typeof prepareBundlePlan>,
  result: BundleBeginResult,
): CmdResult {
  if (result.kind === "duplicate") {
    return {
      lines: [
        `jspace: ok: already archived as a verified bundle (id ${result.journal?.id}); source retained`,
        `  source_retained: ${result.journal?.source}`,
      ],
    };
  }
  if (result.kind === "resume") {
    const nextStep =
      result.journal?.status === "staged"
        ? "--gbrain"
        : result.journal?.status === "gbrain"
          ? "--index"
          : result.journal?.status === "index"
            ? "--complete"
            : undefined;
    return {
      lines: [
        `jspace: ok: bundle ingest already in progress (id ${result.journal?.id}, ${result.journal?.status}); continuing`,
        ...(nextStep !== undefined
          ? [`  next: jspace ingest advance ${result.journal?.id} ${nextStep}`]
          : []),
      ],
    };
  }
  if (result.kind === "resume-required") {
    return {
      exitCode: 1,
      errors: [`ingest ${result.journal?.id}: bundle copy was interrupted; resume it`],
      lines: [
        `jspace: ingest ${result.journal?.id}: copying did not finish; source and partial target retained`,
        `  resume: ${result.message}`,
      ],
    };
  }
  if (result.kind === "busy") {
    return {
      exitCode: 1,
      errors: [`ingest ${result.journal?.id}: ${result.message}`],
      lines: [`jspace: ingest ${result.journal?.id}: ${result.message}`],
    };
  }
  if (result.kind === "failed") {
    return {
      exitCode: 1,
      errors: [`ingest ${result.journal?.id} is already failed`],
      lines: [
        `jspace: ingest ${result.journal?.id}: failed at ${result.journal?.failedStep}: ${result.journal?.failureReason}`,
        result.journal?.failedStep === "copying"
          ? `  resume: jspace ingest advance ${result.journal?.id} --resume-copy`
          : "  resolve the journal before starting a new identical bundle",
      ],
    };
  }
  if (result.kind === "target-exists" || result.kind === "conflict") {
    return {
      exitCode: 1,
      errors: [result.message ?? `bundle target already exists; no bytes were overwritten: ${target}`],
      lines: [`jspace: ingest bundle conflict: ${result.message ?? `target already exists: ${target}`}`],
    };
  }
  const journal = result.journal!;
  const outcome: BundleCopyOutcome = runCreatedBundleCopy(root, journal, fh);
  if (outcome.kind === "failed") {
    return {
      exitCode: 1,
      errors: [`ingest ${journal.id}: bundle copy failed: ${outcome.error?.message ?? "unknown error"}`],
      lines: [
        `jspace: ingest ${journal.id}: bundle copy did not finish; source and target retained`,
        `  resume: jspace ingest advance ${journal.id} --resume-copy`,
        `  manifest: ${journal.manifestRelPath}`,
      ],
    };
  }
  return {
    lines: [
      `jspace: ok: bundle staged (id ${journal.id}): ${args.file}/ -> ${target}`,
      `  entry=${entry} members=${plan.manifest.members.length} aggregate=${journal.aggregateSha256.slice(0, 12)}…`,
      `  manifest=${journal.manifestRelPath}`,
      `  owner=${args.ownerKind}:${args.ownerId} index=${journal.indexPath}`,
      "  source_retained: the inbox directory is kept by design",
      `  next: write the gbrain bundle page, then: jspace ingest advance ${journal.id} --gbrain`,
      `  journal id: ${journal.id}`,
    ],
  };
}

export function ingestBegin(root: string, args: IngestBeginArgs): CmdResult {
  const fh = filehubRoot(root);
  const inbox = confinedWithin(join(fh, "_inbox"), fh);
  if (!inbox) fail(`filehub inbox is missing or escapes the filehub: ${join(fh, "_inbox")}`);
  const source = confinedWithin(resolve(args.file), inbox);
  if (!source) fail(`source must be inside the filehub inbox (${join(fh, "_inbox")}): ${args.file}`);

  const owner = resolveOwner(root, fh, args.ownerKind, args.ownerId);

  if (args.bundle === true) {
    if (args.entry === undefined || args.entry.trim() === "") {
      fail("--bundle requires --entry <bundle-relative-regular-file>");
    }
    const entry = args.entry.replace(/\\/g, "/").replace(/^\.\//, "");
    const entryIssue = bundleMemberPathIssue(entry);
    if (entryIssue !== null) fail(`--entry is not a portable bundle-relative path: ${entryIssue}`);
    if (isRestrictedPath(entry)) fail("--entry points at a restricted path; the whole bundle was refused");
    if (isBundleMetadataPath(entry)) fail("--entry must not point into .jspace/bundles");

    validateSlug(args.slug, args.ownerId, true);
    validateIndexLine(args.indexLine, args.slug);

    const targetCandidate = isAbsolute(args.target) ? args.target : join(fh, args.target);
    const target = confinedWithin(targetCandidate, fh);
    if (!target) fail(`bundle target must be under the filehub root (${fh})`);
    if (target === fh) fail("the filehub root itself cannot be a bundle root");
    const rootRelPath = relative(fh, target).replace(/\\/g, "/");
    if (!hasExactDirectoryPrefix(rootRelPath, owner.ownerRootRel) || rootRelPath === owner.ownerRootRel) {
      fail(`bundle target must be a directory inside ${owner.ownerRootRel}/, not the owner root: ${rootRelPath}`);
    }
    if (rootRelPath === owner.indexPath || basename(rootRelPath) === "index.md") {
      fail(`bundle root must not replace an owner index file: ${rootRelPath}`);
    }
    if (rootRelPath.includes("/.jspace/") || rootRelPath.endsWith("/.jspace")) {
      fail("bundle root must not overlap the managed .jspace metadata directory");
    }
    const plan = prepareBundlePlan({
      source,
      target,
      ownerRootRel: owner.ownerRootRel,
      rootRelPath,
      entry,
      ownerKind: args.ownerKind,
      ownerId: args.ownerId,
      slug: args.slug,
      indexPath: owner.indexPath,
      indexEntry: args.indexLine,
    });
    const result = beginBundleIngest(root, plan, fh);
    return bundleBeginResult(root, fh, target, args, entry, plan, result);
  }
  if (args.entry !== undefined) fail("--entry is only valid together with --bundle");
  const targetCandidate = isAbsolute(args.target) ? args.target : join(fh, args.target);
  const target = confinedWithin(targetCandidate, fh);
  if (!target) fail(`target must be under the filehub root (${fh})`);
  const relPath = relative(fh, target).replace(/\\/g, "/");
  if (!hasExactDirectoryPrefix(relPath, owner.ownerRootRel)) {
    fail(`target must be inside ${owner.ownerRootRel}/ for ${args.ownerKind}:${args.ownerId}: ${relPath}`);
  }
  if (relPath === owner.indexPath || basename(relPath) === "index.md") {
    fail(`asset target must not replace an owner index file: ${relPath}`);
  }
  if (!args.slug.startsWith(`assets/${args.ownerId}/`) || args.slug.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(`slug must begin with assets/${args.ownerId}/ and name a semantic page: ${args.slug}`);
  }
  if (/[\r\n]/.test(args.indexLine) || args.indexLine.trim() === "") {
    fail("--index-line must be one non-empty physical line");
  }
  if (!args.indexLine.includes(args.slug)) {
    fail(`--index-line must contain the exact gbrain slug ${args.slug}`);
  }
  const result = beginIngest(
    root,
    {
      source,
      target,
      relPath,
      ownerKind: args.ownerKind,
      ownerId: args.ownerId,
      slug: args.slug,
      indexPath: owner.indexPath,
      indexEntry: args.indexLine,
    },
    filehubOps(root),
  );

  if (result.kind === "target-exists") {
    return {
      exitCode: 1,
      errors: [`ingest target already exists; no bytes were overwritten: ${target}`],
      lines: [`jspace: ingest conflict: target already exists: ${target}`],
    };
  }
  if (result.kind === "duplicate") {
    return { lines: [`jspace: ok: already ingested (id ${result.journal.id}); skipping duplicate`] };
  }
  if (result.kind === "cleanup-pending") {
    return {
      exitCode: 1,
      errors: [`ingest ${result.journal.id}: source cleanup pending from a previous commit; finish it first`],
      lines: [
        `jspace: ingest ${result.journal.id}: source cleanup pending (failedStep=committed); source NOT removed`,
        `  retry: ${completeRetryCommand(result.journal.id)}`,
      ],
    };
  }
  if (result.kind === "failed") {
    return {
      exitCode: 1,
      errors: [`ingest ${result.journal.id} is already failed; resolve or roll back that journal first`],
      lines: [`jspace: ingest ${result.journal.id}: failed at ${result.journal.failedStep}: ${result.journal.failureReason}`],
    };
  }
  if (result.kind === "resume") {
    return {
      lines: [
        `jspace: ok: ingest already in progress (id ${result.journal.id}, ${result.journal.status}); continuing`,
        `  owner=${result.journal.ownerKind}:${result.journal.ownerId} target=${result.journal.relPath}`,
      ],
    };
  }
  return {
    lines: [
      `jspace: ok: ingest staged (id ${result.journal.id}): ${args.file} -> ${target}`,
      `  owner=${args.ownerKind}:${args.ownerId} index=${owner.indexPath}`,
      `  next: write the gbrain page, then: jspace ingest advance ${result.journal.id} --gbrain`,
      `  journal id: ${result.journal.id}`,
    ],
  };
}

function parseFrontmatter(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  if (!content.startsWith("---")) return fields;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return fields;
  for (const raw of content.slice(3, end).split(/\r?\n/)) {
    const match = raw.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    fields.set(match[1], value);
  }
  return fields;
}

function parseTags(content: string): string[] {
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  if (end < 0) return [];
  const frontmatter = content.slice(3, end);
  const inline = frontmatter.match(/^tags:[ \t]*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1].split(",").map((tag) => tag.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  const block = frontmatter.match(/^tags:[ \t]*\n((?:[ \t]+-[^\n]*\n?)*)/m);
  if (!block) return [];
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1).trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

interface AssetPageMetadata {
  tags: string[];
  sourceSha256?: string;
  bundle?: Omit<IngestBundleGbrainEvidence, "verifiedAt" | "revision" | "contentHash" | "slug" | "ownerKind" | "ownerId" | "relPath" | "tags" | "sourceSha256">;
}

function requireAssetMetadata(
  journal: IngestJournalV2 | IngestBundleJournalV3,
  content: string,
  fh: string,
): AssetPageMetadata {
  const fields = parseFrontmatter(content);
  const tags = parseTags(content);
  if (fields.get("project") !== journal.ownerId) {
    fail(`gbrain page project must be ${journal.ownerId}`);
  }
  if (fields.get("rel_path") !== journal.relPath) {
    fail(`gbrain page rel_path must be ${journal.relPath}`);
  }
  const declaredOwnerKind = fields.get("owner_kind");
  if (declaredOwnerKind !== undefined && declaredOwnerKind !== journal.ownerKind) {
    fail(`gbrain page owner_kind must be ${journal.ownerKind}`);
  }
  const declaredDigest = fields.get("source_sha256");
  if (declaredDigest !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(declaredDigest)) {
      fail("gbrain page source_sha256 must be a 64-character lowercase sha256 digest");
    }
    if (declaredDigest !== journal.targetHash) {
      fail("gbrain page source_sha256 must equal the journal targetHash");
    }
  }
  const priorDigest = journal.gbrainEvidence?.sourceSha256;
  if (priorDigest !== undefined) {
    if (declaredDigest === undefined) {
      fail("gbrain page dropped source_sha256 after the gbrain checkpoint");
    }
    if (declaredDigest !== priorDigest) {
      fail("gbrain page source_sha256 changed after the gbrain checkpoint");
    }
  }
  if (!tags.includes("asset")) fail("gbrain asset page tags must include asset");
  const provenance = tags.filter((tag) => tag === "source:session" || tag === "source:cron");
  if (provenance.length !== 1) {
    fail("gbrain asset page tags must include exactly one of source:session or source:cron");
  }

  let bundle: AssetPageMetadata["bundle"];
  if (journal.schema_version === 3) {
    const assetKind = fields.get("asset_kind");
    if (assetKind !== "bundle") fail("gbrain bundle page asset_kind must be bundle");
    const rootRelPath = relative(fh, journal.target).replace(/\\/g, "/");
    const expected: Array<[string, string]> = [
      ["bundle_root", rootRelPath],
      ["bundle_manifest", journal.manifestRelPath],
      ["bundle_sha256", journal.aggregateSha256],
      ["bundle_manifest_sha256", journal.manifestSha256],
    ];
    for (const [field, value] of expected) {
      const actual = fields.get(field);
      if (actual === undefined) fail(`gbrain bundle page requires ${field}`);
      if (actual !== value) fail(`gbrain bundle page ${field} must equal ${value}`);
    }
    if (declaredDigest === undefined) {
      fail("gbrain bundle page requires source_sha256 (the entry file digest)");
    }
    bundle = {
      assetKind: "bundle",
      bundleRoot: rootRelPath,
      bundleManifest: journal.manifestRelPath,
      bundleSha256: journal.aggregateSha256,
      bundleManifestSha256: journal.manifestSha256,
    };
  } else if (fields.get("asset_kind") === "bundle") {
    fail("asset_kind bundle is only valid for a schema-3 bundle ingest journal");
  }
  return {
    tags,
    ...(declaredDigest !== undefined ? { sourceSha256: declaredDigest } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  };
}

async function verifyGbrainPage(
  journal: IngestJournalV2 | IngestBundleJournalV3,
  gbrain: GbrainDeps,
  fh: string,
): Promise<IngestGbrainEvidence | IngestBundleGbrainEvidence> {
  const result = await gbrain.getPage(journal.slug);
  if (!result.ok) fail(`gbrain readback failed for ${journal.slug}: ${result.code}: ${result.message}`);
  const page = result.page;
  if (page.slug !== journal.slug) fail(`gbrain readback returned ${page.slug}, expected ${journal.slug}`);
  const contentTags = requireAssetMetadata(journal, page.content, fh);
  if (!page.tags.includes("asset")) fail("gbrain metadata tags must include asset");
  const provenance = page.tags.filter((tag) => tag === "source:session" || tag === "source:cron");
  if (provenance.length !== 1) {
    fail("gbrain metadata tags must include exactly one of source:session or source:cron");
  }
  if (journal.ownerKind === "project" && !journal.relPath.startsWith("projects/")) {
    fail(`project asset rel_path must begin with projects/: ${journal.relPath}`);
  }
  if (journal.ownerKind === "area" && !journal.relPath.startsWith(`areas/${journal.ownerId}/`)) {
    fail(`area asset rel_path must begin with areas/${journal.ownerId}/: ${journal.relPath}`);
  }
  return {
    verifiedAt: localStamp(),
    revision: page.revision,
    contentHash: page.contentHash,
    slug: page.slug,
    ownerKind: journal.ownerKind,
    ownerId: journal.ownerId,
    relPath: journal.relPath,
    tags: [...new Set([...page.tags, ...contentTags.tags])],
    ...(contentTags.sourceSha256 !== undefined ? { sourceSha256: contentTags.sourceSha256 } : {}),
    ...(contentTags.bundle ?? {}),
  };
}

function verifyIndex(
  journal: IngestJournalV2 | IngestBundleJournalV3,
  ops: IngestFileOps,
): IngestIndexEvidence {
  let content: string;
  try {
    content = ops.readIndex(journal.indexPath);
  } catch (error) {
    fail(`index readback failed for ${journal.indexPath}: ${(error as Error).message}`);
  }
  if (!isCurrentOwnershipLine(content, journal.indexEntry)) {
    fail(
      `index ${journal.indexPath} does not contain the exact planned line as a current ownership row: ${journal.indexEntry}`,
    );
  }
  return {
    verifiedAt: localStamp(),
    path: journal.indexPath,
    contentHash: createHash("sha256").update(content).digest("hex"),
    line: journal.indexEntry,
  };
}

function bundleBlocked(id: string, reason: string, sourceRetained: boolean): CmdResult {
  return {
    exitCode: 1,
    errors: [`ingest ${id}: ${reason}`],
    lines: [
      `jspace: ingest ${id}: completion blocked; source and target were preserved`,
      `  reason: ${reason}`,
      ...(sourceRetained ? ["  source_retained: the inbox directory was not modified"] : []),
    ],
  };
}

export async function ingestAdvance(
  root: string,
  id: string,
  step: IngestStep | "resume-copy",
  gbrain: GbrainDeps = realGbrain(),
): Promise<CmdResult> {
  const fh = filehubRoot(root);

  if (step === "resume-copy") {
    const result = resumeBundleCopy(root, id, fh);
    if (result.kind === "busy") {
      return {
        exitCode: 1,
        errors: [`ingest ${id}: the previous copier may still be alive; refusing to take over`],
        lines: [`jspace: ingest ${id}: busy (operation pid ${result.journal.operation?.pid ?? "?"})`],
      };
    }
    if (result.journal.status === "staged") {
      return {
        lines: [
          `jspace: ok: bundle copy resumed and staged (id ${id})`,
          `  next: write the gbrain bundle page, then: jspace ingest advance ${id} --gbrain`,
        ],
      };
    }
    return {
      exitCode: 1,
      errors: [`ingest ${id}: copy resume failed: ${result.error?.message ?? "unknown error"}`],
      lines: [
        `jspace: ingest ${id}: bundle copy did not finish; source and target retained`,
        `  retry: jspace ingest advance ${id} --resume-copy`,
      ],
    };
  }

  const journal = readJournal(root, id);
  if (journal.schema_version === 3) {
    if (step === "committed") {
      if (journal.status !== "index") {
        fail(`ingest ${id}: cannot complete from ${journal.status}; only index may be completed`);
      }
      const refreshed = await verifyGbrainPage(journal, gbrain, fh);
      if (!("assetKind" in refreshed) || refreshed.assetKind !== "bundle") {
        fail(`ingest ${id}: internal error: bundle readback lost its bundle fields`);
      }
      const result = completeBundleIngest(root, id, fh, filehubOps(root).readIndex, refreshed);
      if (result.kind === "blocked") return bundleBlocked(id, result.error.message, true);
      return {
        lines: [
          `jspace: ok: ingest ${id} -> committed`,
          `  source_retained: ${result.journal.source}`,
          "  next: remove the inbox copy only through an explicit, separately reviewed cleanup",
        ],
      };
    }
    if (step === "staged") fail(`ingest ${id}: staged is a starting state, not an advance target`);
    if (step === "gbrain") {
      if (journal.status !== "staged") {
        fail(`ingest ${id}: cannot advance to gbrain from ${journal.status}`);
      }
      const evidence = await verifyGbrainPage(journal, gbrain, fh);
      if (!("assetKind" in evidence) || evidence.assetKind !== "bundle") {
        fail(`ingest ${id}: bundle page readback is missing bundle fields`);
      }
      recordBundleGbrainCheckpoint(root, id, evidence);
    } else {
      if (journal.status !== "gbrain") {
        fail(`ingest ${id}: cannot advance to index from ${journal.status}`);
      }
      recordBundleIndexCheckpoint(root, id, verifyIndex(journal, filehubOps(root)));
    }
    return {
      lines: [
        `jspace: ok: ingest ${id} -> ${step}`,
        "  source_retained: bundle sources are never removed automatically",
      ],
    };
  }

  if (step === "committed") {
    if (journal.status !== "index" && !isCleanupPending(journal)) {
      throw new Error(
        `ingest ${id}: cannot complete from ${journal.status}; only index or cleanup-pending may be completed`,
      );
    }
    const refreshed = await verifyGbrainPage(journal, gbrain, fh);
    if ("assetKind" in refreshed) fail(`ingest ${id}: a schema-2 journal cannot carry bundle evidence`);
    const result = completeIngest(root, id, filehubOps(root), undefined, refreshed);
    if (result.kind === "blocked") {
      return {
        exitCode: 1,
        errors: [`ingest ${id}: ${result.error.message}`],
        lines: [`jspace: ingest ${id}: completion blocked; source and target were preserved`, `  reason: ${result.error.message}`],
      };
    }
    if (result.kind === "cleanup-pending") {
      return {
        exitCode: 1,
        errors: [`ingest ${id}: source cleanup failed: ${result.error.message}`],
        lines: [
          `jspace: ingest ${id}: source cleanup pending; source NOT removed`,
          `  retry: ${completeRetryCommand(id)}`,
        ],
      };
    }
    return { lines: [`jspace: ok: ingest ${id} -> committed (source removed)`] };
  }
  if (step === "staged") fail(`ingest ${id}: staged is a starting state, not an advance target`);

  if (step === "gbrain") {
    await advanceIngest(root, id, "gbrain", (record) => verifyGbrainPage(record, gbrain, fh));
  } else {
    await advanceIngest(root, id, "index", (record) => Promise.resolve(verifyIndex(record, filehubOps(root))));
  }
  return { lines: [`jspace: ok: ingest ${id} -> ${step}`] };
}

export function ingestFail(root: string, id: string, reason: string): CmdResult {
  const current = readJournal(root, id);
  if (current.schema_version === 3) {
    const journal = failBundleIngest(root, id, reason);
    return {
      exitCode: 1,
      lines: [
        `jspace: ingest ${id} failed at ${journal.failedStep ?? "?"}: ${reason}`,
        "  source_retained: the inbox directory remains",
        journal.failedStep === "copying" ? `  resume: jspace ingest advance ${id} --resume-copy` : "",
      ].filter((line) => line !== ""),
    };
  }
  const journal = failIngest(root, id, reason, filehubOps(root));
  const lines = [`jspace: ingest ${id} failed at ${journal.failedStep ?? "?"}: ${reason}`];
  if (journal.failureReason?.includes("preserved")) {
    lines.push("  preserved: staged target changed; source and target both remain for inspection");
  } else if (journal.failedStep === "staged") {
    lines.push("  compensated: removed staged target copy; source stays in inbox (no orphan)");
  }
  return { exitCode: 1, lines };
}

export function ingestRollback(root: string, id: string): CmdResult {
  const current = readJournal(root, id);
  if (current.schema_version === 3) {
    const result = rollbackBundleIngest(root, id, filehubRoot(root));
    if (result.retained > 0) {
      return {
        exitCode: 1,
        errors: [`ingest ${id}: rollback preserved ${result.retained} changed/extra object(s)`],
        lines: [
          `jspace: ingest ${id}: rollback incomplete; removed ${result.removed}, preserved ${result.retained}`,
          "  source_retained: the inbox directory was not modified",
        ],
      };
    }
    return {
      lines: [
        `jspace: ok: ingest ${id} rolled back (verified copied members removed, manifest removed)`,
        "  source_retained: the inbox directory stays",
      ],
    };
  }
  const journal = rollbackIngest(root, id, filehubOps(root));
  if (journal.failureReason?.includes("preserved")) {
    return {
      exitCode: 1,
      errors: [`ingest ${id}: rollback blocked because the staged target changed`],
      lines: [`jspace: ingest ${id}: rollback blocked; source and changed target were preserved`],
    };
  }
  return { lines: [`jspace: ok: ingest ${id} rolled back (staged copy removed, source stays in inbox)`] };
}

export function ingestStatus(root: string, id: string, json: boolean): CmdResult {
  const journal = readJournal(root, id);
  if (json) return { lines: [], data: journal };
  const status = `jspace: ingest ${id}: status=${journal.status}` +
    (journal.failedStep ? ` failedStep=${journal.failedStep}` : "") +
    (journal.failureReason ? ` reason=${journal.failureReason}` : "");
  const lines = [
    status,
    `  owner=${journal.ownerKind}:${journal.ownerId}`,
    `  ${journal.source} -> ${journal.target}`,
    `  slug=${journal.slug} index=${journal.indexPath} hash=${journal.sourceHash.slice(0, 8)}`,
  ];
  if (journal.schema_version === 3) {
    lines.push(
      `  entry=${journal.relPath} manifest=${journal.manifestRelPath}`,
      `  aggregate=${journal.aggregateSha256.slice(0, 12)}… source_policy=${journal.sourcePolicy}`,
    );
    if (journal.operation !== undefined) {
      lines.push(`  copier pid=${journal.operation.pid} token=${journal.operation.token.slice(0, 8)}…`);
    }
  }
  if (journal.gbrainEvidence) {
    lines.push(`  gbrain=${journal.gbrainEvidence.slug}@${journal.gbrainEvidence.revision}`);
  }
  if (journal.indexEvidence) {
    lines.push(`  index-evidence=${journal.indexEvidence.path}`);
  }
  if (isCleanupPending(journal)) {
    lines.push(`  cleanup pending: source not yet removed; finish cleanup: ${completeRetryCommand(id)}`);
  }
  return { lines };
}

export function ingestList(root: string, json: boolean): CmdResult {
  const { records: journals, issues } = readJournals(root);
  if (json) return { lines: [], data: issues.length > 0 ? { journals, issues } : { journals } };
  if (journals.length === 0) return { lines: ["jspace: ok: no ingest journals"] };
  return {
    lines: journals.map((journal) => {
      const status = isCleanupPending(journal) ? "failed/cleanup-pending" : journal.status;
      return `${journal.id}  ${status}  ${journal.ownerKind}:${journal.ownerId}  ${journal.relPath}`;
    }),
  };
}
