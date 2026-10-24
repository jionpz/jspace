// application/registry/inbox-archive.ts — reconcile a retained inbox source
// with committed v3 bundle journals.
//
// `sourcePolicy: retain` means a fully committed bundle intentionally leaves
// its inbox directory behind. That source is not an owner ambiguity and must not
// be re-filed; it is "archived, source retained, cleanup pending". Matching uses
// the full identity — source path + journal plan + manifest digest + current
// whole-tree aggregate — never basename, size or mtime.
import { resolve } from "node:path";
import type { IngestBundleJournalV3, IngestJournal } from "../../core/contracts/ingest.ts";
import type { InboxFingerprint } from "../../core/contracts/inbox-blockers.ts";
import { entryMember, manifestIdentityIssues, readBundleManifest, scanBundleTree } from "../filehub/bundle.ts";
import { filehubRelativePath, treeAggregateOf } from "./inbox-fingerprint.ts";

export interface ArchivedBundle {
  state: "archived";
  journalId: string;
  target: string;
  manifestRelPath: string;
}

export type ArchivedLookup =
  | { state: "none" }
  | ArchivedBundle
  | { state: "unknown"; detail: string }
  | { state: "conflict"; detail: string };

/** Committed bundle journals indexed by normalized source path. Journals are
 *  supplied by the caller (the registry layer must not import the ingest
 *  use-case layer); a missing list means "no archive evidence", never a guess. */
export function committedBundleJournalsBySource(
  records: readonly IngestJournal[],
): Map<string, IngestBundleJournalV3[]> {
  const bySource = new Map<string, IngestBundleJournalV3[]>();
  for (const journal of records) {
    if (journal.schema_version !== 3 || journal.status !== "committed") continue;
    const key = resolve(journal.source);
    const list = bySource.get(key) ?? [];
    list.push(journal);
    bySource.set(key, list);
  }
  return bySource;
}

function verifyJournal(
  filehubRoot: string,
  journal: IngestBundleJournalV3,
  aggregate: string,
): { ok: true } | { ok: false; state: "unknown" | "conflict"; detail: string } {
  if (journal.aggregateSha256 !== aggregate) {
    // A committed journal for another version of the same source is not this
    // source's archive identity.
    return { ok: false, state: "conflict", detail: "source tree differs from the committed journal plan" };
  }
  const rootRelPath = filehubRelativePath(filehubRoot, journal.target);
  if (rootRelPath === null) {
    return { ok: false, state: "unknown", detail: "committed target is outside the filehub" };
  }
  const read = readBundleManifest(filehubRoot, journal.manifestRelPath);
  if (read.state !== "ok" || read.manifest === undefined || read.manifestSha256 === undefined) {
    return {
      ok: false,
      state: "unknown",
      detail: `bundle manifest is not verifiable (${read.state})`,
    };
  }
  if (read.manifestSha256 !== journal.manifestSha256) {
    return { ok: false, state: "conflict", detail: "bundle manifest bytes no longer match the journal" };
  }
  if (read.manifest.aggregateSha256 !== journal.aggregateSha256) {
    return { ok: false, state: "conflict", detail: "bundle manifest aggregate no longer matches the journal" };
  }
  const issues = manifestIdentityIssues(read.manifest, {
    ownerKind: journal.ownerKind,
    ownerId: journal.ownerId,
    slug: journal.slug,
    rootRelPath,
    entry: journal.relPath,
  });
  if (issues.length > 0) {
    return { ok: false, state: "conflict", detail: issues.join("; ") };
  }
  const entry = entryMember(read.manifest);
  if (entry === null || entry.sha256 !== journal.sourceHash) {
    return { ok: false, state: "conflict", detail: "bundle manifest entry no longer matches the journal" };
  }
  // The business copy is the registered target; a retained source is only
  // "archived" while that target still matches the same manifest.
  const targetScan = scanBundleTree(journal.target);
  if (
    targetScan.state !== "ok" ||
    targetScan.aggregateSha256 !== read.manifest.aggregateSha256
  ) {
    return {
      ok: false,
      state: "unknown",
      detail: "committed bundle target is missing or no longer matches its manifest",
    };
  }
  return { ok: true };
}

/** Resolve one inbox source against committed bundle journals. Unknown beats a
 *  false "archived" claim; conflicting full identities are reported, not guessed. */
export function findArchivedBundle(
  filehubRoot: string,
  sourceAbs: string,
  fingerprint: InboxFingerprint,
  journals: Map<string, IngestBundleJournalV3[]>,
): ArchivedLookup {
  const aggregate = treeAggregateOf(fingerprint);
  if (aggregate === null) return { state: "unknown", detail: "source tree fingerprint is unavailable" };
  const candidates = journals.get(resolve(sourceAbs)) ?? [];
  if (candidates.length === 0) return { state: "none" };

  const matches: ArchivedBundle[] = [];
  let unknown: string | null = null;
  let conflict: string | null = null;
  for (const journal of candidates) {
    const verified = verifyJournal(filehubRoot, journal, aggregate);
    if (verified.ok) {
      matches.push({
        state: "archived",
        journalId: journal.id,
        target: journal.target,
        manifestRelPath: journal.manifestRelPath,
      });
      continue;
    }
    if (verified.state === "unknown") unknown = verified.detail;
    else conflict = verified.detail;
  }

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const identities = new Set(matches.map((m) => `${m.target}\0${m.manifestRelPath}`));
    if (identities.size === 1) return matches[0]!;
    return {
      state: "conflict",
      detail: "multiple committed bundle journals match this retained source",
    };
  }
  if (conflict !== null) return { state: "conflict", detail: conflict };
  if (unknown !== null) return { state: "unknown", detail: unknown };
  return { state: "none" };
}
