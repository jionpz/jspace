// application/registry/inbox.ts — `jspace inbox status|block|retry`.
//
// status is read-only and joins the local blocker snapshot with the current
// source fingerprint, routing digest and committed bundle journals. block and
// retry are short, explicit state edits: they never create an ingest journal,
// pending envelope, target file or index row, and retry never claims success.
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import type { IngestBundleJournalV3, IngestJournal } from "../../core/contracts/ingest.ts";
import {
  INBOX_BLOCKER_CODES,
  INBOX_RESIDENT_FILES,
  SKIP_INBOX_TIDY_MARKER,
  inboxCandidateIssue,
  inboxEntryNameIssue,
  sameInboxFingerprint,
  sameInboxRoutingDigest,
  type InboxBlocker,
  type InboxBlockerCode,
  type InboxBlockerEntry,
  type InboxBlockersV1,
  type InboxFingerprint,
  type InboxRoutingDigest,
} from "../../core/contracts/inbox-blockers.ts";
import { withWorkbenchMutationLock } from "../lock.ts";
import { resolveFilehubRoot } from "./filehub-lookup.ts";
import {
  computeInboxRoutingDigest,
  fingerprintInboxEntry,
} from "./inbox-fingerprint.ts";
import {
  committedBundleJournalsBySource,
  findArchivedBundle,
  type ArchivedLookup,
} from "./inbox-archive.ts";
import {
  mergeInboxBlockerEntry,
  readInboxBlockers,
  removeInboxBlockerEntry,
  writeInboxBlockers,
} from "./inbox-state.ts";

/** Locate the inbox: filehub root/_inbox if registered and bound, else the
 *  degraded staging dir (<workbench>-inbox/) next to the workbench. Mirrors the
 *  asset-ingest skill's front-matter lookup. Returns null when neither exists. */
export function locateInbox(root: string): string | null {
  const fhRoot = resolveFilehubRoot(root);
  if (fhRoot) return join(fhRoot, "_inbox");
  return join(dirname(root), `${basename(root)}-inbox`);
}

/** Resident contract files of a drop-zone inbox (top level, exact names): the
 *  STRUCTURE-contract README and an optional AGENTS.md routing note. Permanent
 *  fixtures by definition — counting them makes `filehub.inbox_unfiled` a
 *  warning that can never reach 0 (issue #38). */
const INBOX_RESIDENT = new Set<string>(INBOX_RESIDENT_FILES);

/** True when a top-level inbox entry is unfiled payload rather than structure
 *  (dot-entry, resident contract file, or a `.skip-inbox-tidy`-exempted dir).
 *  Single filter for counting, listing, doctor and the context hook so the
 *  consumers can never disagree about "how many". */
export function isInboxPayload(inbox: string, name: string): boolean {
  if (name.startsWith(".")) return false;
  if (INBOX_RESIDENT.has(name)) return false;
  // A non-directory can't contain the marker (ENOTDIR → existsSync false).
  return !existsSync(join(inbox, name, SKIP_INBOX_TIDY_MARKER));
}

/** Single source for inbox-entry counting. Top-level entries only — matches the
 *  asset-ingest semantics where a subdirectory is filed wholesale as one item;
 *  structure excluded via `isInboxPayload`; capped to avoid a pathological inbox
 *  stalling hooks. `jspace inbox status`, doctor and the context hook all call
 *  this so the three never disagree about "how many". */
export function countInbox(dir: string): number {
  const MAX_INBOX_ENTRIES = 10000;
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (n >= MAX_INBOX_ENTRIES) break;
    if (!isInboxPayload(dir, name)) continue;
    n += 1;
  }
  return n;
}

type Freshness = "current" | "stale" | "unknown";

interface InboxFileView {
  name: string;
  size: number;
  mtime: string;
  dir: boolean;
  blockers?: InboxBlocker[];
  freshness?: Freshness;
  freshnessReason?: string;
  archived?: { state: "source_retained"; journalId: string; target: string; manifestRelPath: string };
  archive?: { state: "unknown" | "conflict"; detail: string };
}

interface BlockerCoverage {
  state: "ok" | "missing" | "damaged" | "inbox_mismatch";
  detail?: string;
  orphaned?: string[];
}

function coverageFor(
  read: ReturnType<typeof readInboxBlockers>,
  inbox: string,
  listed: Set<string>,
): { coverage: BlockerCoverage; entries: Map<string, InboxBlockerEntry> } {
  const entries = new Map<string, InboxBlockerEntry>();
  if (read.state === "missing") return { coverage: { state: "missing" }, entries };
  if (read.state === "damaged") {
    return { coverage: { state: "damaged", detail: read.detail }, entries };
  }
  if (read.snapshot.inboxRoot !== inbox) {
    return {
      coverage: {
        state: "inbox_mismatch",
        detail: `snapshot belongs to another inbox root: ${read.snapshot.inboxRoot}`,
      },
      entries,
    };
  }
  const orphaned: string[] = [];
  for (const entry of read.snapshot.entries) {
    if (!listed.has(entry.name)) orphaned.push(entry.name);
    else entries.set(entry.name, entry);
  }
  return {
    coverage: {
      state: "ok",
      ...(orphaned.length > 0 ? { orphaned } : {}),
    },
    entries,
  };
}

function freshnessFor(
  root: string,
  entry: InboxBlockerEntry,
  inbox: string,
  stale: { routing?: InboxRoutingDigest; fingerprint?: InboxFingerprint },
): { freshness: Freshness; reason?: string } {
  if (entry.fingerprint.state !== "known") {
    return { freshness: "unknown", reason: entry.fingerprint.reason };
  }
  if (entry.routingDigest.state !== "known") {
    return { freshness: "unknown", reason: entry.routingDigest.reason };
  }
  stale.fingerprint ??= fingerprintInboxEntry(inbox, entry.name);
  const current = stale.fingerprint;
  if (current.state !== "known") {
    return { freshness: "unknown", reason: current.reason };
  }
  if (!sameInboxFingerprint(entry.fingerprint, current)) {
    return { freshness: "stale", reason: "source content changed since the blocker was recorded" };
  }
  stale.routing ??= computeInboxRoutingDigest(root, inbox);
  const routing = stale.routing;
  if (routing.state !== "known") {
    return { freshness: "unknown", reason: routing.reason };
  }
  if (!sameInboxRoutingDigest(entry.routingDigest, routing)) {
    return { freshness: "stale", reason: "registry/owner-index routing evidence changed" };
  }
  return { freshness: "current" };
}

function archivedView(lookup: ArchivedLookup): Pick<InboxFileView, "archived" | "archive"> {
  if (lookup.state === "archived") {
    return {
      archived: {
        state: "source_retained",
        journalId: lookup.journalId,
        target: lookup.target,
        manifestRelPath: lookup.manifestRelPath,
      },
    };
  }
  if (lookup.state === "unknown" || lookup.state === "conflict") {
    return { archive: { state: lookup.state, detail: lookup.detail } };
  }
  return {};
}

function archiveFor(
  root: string,
  inbox: string,
  name: string,
  fingerprint: InboxFingerprint,
  journals: Map<string, IngestBundleJournalV3[]>,
): ArchivedLookup | null {
  if (!journals.has(resolve(join(inbox, name)))) return null;
  const fh = resolveFilehubRoot(root);
  if (fh === null) return null;
  return findArchivedBundle(fh, join(inbox, name), fingerprint, journals);
}

/** Read-only inbox listing with blocker/routing freshness and retained-source
 *  reconciliation. Never creates a lock, mutates state, or hashes count/context
 *  paths — fingerprints run only for entries that need a decision check.
 *  `journals` is supplied by the caller (CLI reads ingest state) so the registry
 *  layer stays below the ingest use-case layer. It is required, not optional:
 *  archive evidence must be passed explicitly rather than silently omitted. */
export function inboxStatus(
  root: string,
  json: boolean,
  journals: readonly IngestJournal[],
): CmdResult {
  const inbox = locateInbox(root);
  if (!inbox || !existsSync(inbox)) {
    if (json) {
      return { lines: [], data: { inbox: null, count: 0, files: [] } };
    }
    return {
      lines: ["jspace: ok: no inbox to process (filehub not registered and no degraded staging dir)"],
    };
  }

  // Stat each entry defensively: a dangling symlink (or an entry racing with a
  // sync client) must not take the whole listing down — skip what cannot be read.
  const files: InboxFileView[] = [];
  const listed = new Set<string>();
  for (const n of readdirSync(inbox)) {
    if (!isInboxPayload(inbox, n)) continue;
    const p = join(inbox, n);
    try {
      const st = statSync(p);
      listed.add(n);
      files.push({ name: n, size: st.size, mtime: st.mtime.toISOString(), dir: st.isDirectory() });
    } catch {
      continue;
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  const stateRead = readInboxBlockers(root);
  const { coverage, entries } = coverageFor(stateRead, inbox, listed);
  const journalMap = files.some((file) => file.dir)
    ? committedBundleJournalsBySource(journals)
    : new Map();
  const stale: { routing?: InboxRoutingDigest; fingerprint?: InboxFingerprint } = {};

  for (const file of files) {
    const blockedEntry = entries.get(file.name);
    const archiveCandidate = file.dir && journalMap.has(resolve(join(inbox, file.name)));
    const shouldFingerprint = blockedEntry !== undefined || archiveCandidate;
    if (!shouldFingerprint) continue;
    const fingerprint = fingerprintInboxEntry(inbox, file.name);

    const archive = archiveCandidate ? archiveFor(root, inbox, file.name, fingerprint, journalMap) : null;
    if (archive !== null && archive.state !== "none") {
      Object.assign(file, archivedView(archive));
      // A proven retained archive overrides any old blocker record; it is not
      // owner ambiguity and must never be re-filed.
      if (archive.state === "archived") continue;
    }
    if (blockedEntry !== undefined) {
      file.blockers = blockedEntry.blockers;
      stale.fingerprint = fingerprint;
      const freshness = freshnessFor(root, blockedEntry, inbox, stale);
      file.freshness = freshness.freshness;
      if (freshness.reason !== undefined) file.freshnessReason = freshness.reason;
    }
  }

  const blockedCount = files.filter((file) => file.blockers !== undefined).length;
  const archivedCount = files.filter((file) => file.archived !== undefined).length;
  const warnings: string[] = [];
  if (coverage.state === "damaged") {
    warnings.push(`inbox blocker state is damaged: ${coverage.detail ?? "decode failed"}`);
  } else if (coverage.state === "inbox_mismatch") {
    warnings.push(
      `inbox blocker state belongs to another inbox (${coverage.detail ?? "binding changed"}); cached decisions are not applied`,
    );
  }

  if (json) {
    return {
      lines: [],
      data: {
        inbox,
        count: files.length,
        files,
        blockerCoverage: coverage,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  if (files.length === 0) {
    const lines = ["jspace: ok: inbox is empty (nothing to do)"];
    for (const warning of warnings) lines.push(`jspace: warning: ${warning}`);
    return { lines, ...(warnings.length > 0 ? { warnings } : {}) };
  }
  const lines = [`jspace: inbox (${inbox}): ${files.length} file(s)`];
  for (const f of files) {
    lines.push(`  ${f.name}${f.dir ? "/" : ""}  ${f.size} B  ${f.mtime.slice(0, 10)}`);
    if (f.archived !== undefined) {
      lines.push(
        `    archived/source_retained (journal ${f.archived.journalId}): not an owner ambiguity; the inbox copy is cleanup-pending, not filed again`,
      );
    } else if (f.archive !== undefined) {
      lines.push(`    archive identity ${f.archive.state}: ${f.archive.detail}`);
    }
    if (f.blockers !== undefined) {
      const label = f.freshness ?? "unknown";
      for (const blocker of f.blockers) {
        const candidates =
          blocker.candidates !== undefined ? ` (candidates: ${blocker.candidates.join(", ")})` : "";
        lines.push(`    blocked (${label}): ${blocker.code} — ${blocker.missing}${candidates}`);
      }
      if (f.freshness !== "current") {
        lines.push(`    reason: ${f.freshnessReason ?? "evidence is not fully verifiable"}`);
      }
      lines.push(
        `    next: gather the missing evidence, then "jspace inbox retry ${f.name}" and decide again`,
      );
    }
  }
  if (blockedCount > 0 || archivedCount > 0) {
    lines.push(
      `jspace: ${blockedCount} blocked, ${archivedCount} archived/source_retained, ${files.length - blockedCount - archivedCount} undecided`,
    );
  }
  if (coverage.orphaned !== undefined) {
    lines.push(
      `jspace: info: ${coverage.orphaned.length} cached blocker(s) no longer match an inbox payload; the next write may clean them`,
    );
  }
  for (const warning of warnings) lines.push(`jspace: warning: ${warning}`);
  return { lines, ...(warnings.length > 0 ? { warnings } : {}) };
}

function validateEntryName(name: string): string | null {
  const issue = inboxEntryNameIssue(name);
  if (issue !== null) return issue;
  return null;
}

function blockerFromArgs(
  reason: string,
  missing: string,
  candidates: string[] | undefined,
): { blocker: InboxBlocker } | { error: string } {
  if (!(INBOX_BLOCKER_CODES as readonly string[]).includes(reason)) {
    return { error: `--reason must be one of ${INBOX_BLOCKER_CODES.join(", ")}` };
  }
  if (missing.trim().length === 0) return { error: "--missing must be a non-empty evidence gap" };
  if (candidates !== undefined) {
    if (reason !== "owner_ambiguous") {
      return { error: "--candidates is only valid for --reason owner_ambiguous" };
    }
    if (candidates.length === 0) return { error: "--candidates must name at least one project/area" };
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const issue = inboxCandidateIssue(candidate);
      if (issue !== null) return { error: `--candidates: ${candidate}: ${issue}` };
      if (seen.has(candidate)) return { error: `--candidates: duplicate ${candidate}` };
      seen.add(candidate);
    }
  }
  return {
    blocker: {
      code: reason as InboxBlockerCode,
      missing,
      ...(candidates !== undefined ? { candidates } : {}),
    },
  };
}

function emptySnapshot(inbox: string): InboxBlockersV1 {
  return { schema_version: 1, inboxRoot: inbox, entries: [] };
}

function cleanupHint(name: string, archived: { journalId: string }): string {
  return (
    `"${name}" is already archived as a committed bundle (journal ${archived.journalId}); ` +
    "the source is retained for cleanup, not blocked. Confirm the registered target, then remove the inbox copy " +
    "using your normal file workflow — this CLI does not delete retained sources."
  );
}

/** Record an explicit blocker reason. Deep fingerprint/routing work happens
 *  outside the short mutation lock; no target/ingest/pending side effect exists. */
export function inboxBlock(
  root: string,
  name: string,
  reason: string,
  missing: string,
  candidates: string[] | undefined,
  dryRun: boolean,
  json: boolean,
  journals: readonly IngestJournal[],
): CmdResult {
  const inbox = locateInbox(root);
  if (inbox === null || !existsSync(inbox)) {
    return {
      exitCode: 1,
      errors: ["no inbox is available to block (filehub not registered and no degraded staging dir)"],
      lines: [],
    };
  }
  const nameIssue = validateEntryName(name);
  if (nameIssue !== null) {
    return { exitCode: 1, errors: [`inbox entry name is invalid: ${nameIssue}`], lines: [] };
  }
  if (!isInboxPayload(inbox, name)) {
    return {
      exitCode: 1,
      errors: [`inbox entry is structure, not payload: ${name}`],
      lines: [],
    };
  }
  const parsed = blockerFromArgs(reason, missing, candidates);
  if ("error" in parsed) return { exitCode: 1, errors: [parsed.error], lines: [] };

  const abs = join(inbox, name);
  let stat: ReturnType<typeof statSync>;
  try {
    lstatSync(abs);
    stat = statSync(abs);
  } catch {
    return { exitCode: 1, errors: [`inbox entry does not exist or cannot be inspected: ${name}`], lines: [] };
  }

  const fingerprint = fingerprintInboxEntry(inbox, name);
  const routingDigest = computeInboxRoutingDigest(root, inbox);
  const journalMap = stat.isDirectory() ? committedBundleJournalsBySource(journals) : new Map();
  const archive = stat.isDirectory()
    ? (() => {
        const fh = resolveFilehubRoot(root);
        return fh === null ? null : findArchivedBundle(fh, abs, fingerprint, journalMap);
      })()
    : null;
  if (archive !== null && archive.state === "archived") {
    return {
      exitCode: 1,
      errors: [cleanupHint(name, archive)],
      lines: [],
    };
  }

  const entry: InboxBlockerEntry = {
    name,
    kind: stat.isDirectory() ? "dir" : "file",
    fingerprint,
    routingDigest,
    observedAt: new Date().toISOString(),
    blockers: [parsed.blocker],
  };

  let changed = true;
  let supersededRoot: string | null = null;
  if (dryRun) {
    const read = readInboxBlockers(root);
    if (read.state === "damaged") {
      return {
        exitCode: 1,
        errors: [`inbox blocker state is damaged; refusing to overwrite it: ${read.detail}`],
        lines: [],
      };
    }
    if (read.state === "ok" && read.snapshot.inboxRoot !== inbox) supersededRoot = read.snapshot.inboxRoot;
    const base =
      read.state === "ok" && read.snapshot.inboxRoot === inbox
        ? read.snapshot
        : emptySnapshot(inbox);
    changed = mergeInboxBlockerEntry(base, entry).changed;
  } else {
    try {
      withWorkbenchMutationLock(root, () => {
        const read = readInboxBlockers(root);
        if (read.state === "damaged") {
          throw new Error(`inbox blocker state is damaged; refusing to overwrite it: ${read.detail}`);
        }
        if (read.state === "ok" && read.snapshot.inboxRoot !== inbox) {
          supersededRoot = read.snapshot.inboxRoot;
        }
        const base =
          read.state === "ok" && read.snapshot.inboxRoot === inbox
            ? read.snapshot
            : emptySnapshot(inbox);
        const merged = mergeInboxBlockerEntry(base, entry);
        changed = merged.changed;
        if (merged.changed) writeInboxBlockers(root, merged.snapshot);
      });
    } catch (error) {
      return {
        exitCode: 1,
        errors: [`inbox block failed: ${(error as Error).message}`],
        lines: [],
      };
    }
  }

  const reuse =
    fingerprint.state === "known" && routingDigest.state === "known"
      ? "status must prove both fingerprints still match before reusing this decision"
      : "will stay freshness=unknown until the unsafe/unreadable evidence is re-observed";
  const lines = [
    `jspace: ok: ${changed ? "recorded" : "already recorded"} blocker for "${name}" (${parsed.blocker.code})${dryRun ? " (dry-run)" : ""}`,
    `  fingerprint: ${fingerprint.state === "known" ? `${fingerprint.algorithm}:${fingerprint.value.slice(0, 12)}…` : `unknown (${fingerprint.reason})`}`,
    `  routing: ${routingDigest.state === "known" ? `sha256:${routingDigest.value.slice(0, 12)}…` : `unknown (${routingDigest.reason})`}`,
    `  reuse: ${reuse}`,
    "  no ingest journal, pending envelope, target file or index row was created",
    `  next: jspace inbox status`,
  ];
  if (supersededRoot !== null) {
    lines.push(
      `  note: the previous snapshot for another inbox was superseded after the binding changed (${supersededRoot})`,
    );
  }
  return {
    lines,
    ...(json ? { data: { entry, changed, dryRun } } : {}),
  };
}

/** Clear one cached decision. This is not ingestion, filing, cleanup or a
 *  completion claim; it only makes the next pass judge the entry again. */
export function inboxRetry(
  root: string,
  name: string,
  dryRun: boolean,
  json: boolean,
  journals: readonly IngestJournal[],
): CmdResult {
  const nameIssue = validateEntryName(name);
  if (nameIssue !== null) {
    return { exitCode: 1, errors: [`inbox entry name is invalid: ${nameIssue}`], lines: [] };
  }
  const inbox = locateInbox(root);
  const inboxExists = inbox !== null && existsSync(inbox);
  if (inboxExists && !isInboxPayload(inbox, name)) {
    return { exitCode: 1, errors: [`inbox entry is structure, not payload: ${name}`], lines: [] };
  }

  const pre = readInboxBlockers(root);
  if (pre.state === "damaged") {
    return {
      exitCode: 1,
      errors: [`inbox blocker state is damaged; refusing to rewrite it: ${pre.detail}`],
      lines: [],
    };
  }
  if (pre.state === "ok" && inbox !== null && pre.snapshot.inboxRoot !== inbox) {
    return {
      lines: [
        `jspace: ok: no cached decision for "${name}" in this inbox (snapshot belongs to ${pre.snapshot.inboxRoot})`,
      ],
      ...(json ? { data: { entry: name, removed: false, inbox } } : {}),
    };
  }

  const existing = pre.state === "ok" ? pre.snapshot.entries.find((entry) => entry.name === name) : undefined;
  if (existing !== undefined && inbox !== null && inboxExists && existing.kind === "dir") {
    const fingerprint = fingerprintInboxEntry(inbox, name);
    const fh = resolveFilehubRoot(root);
    if (fh !== null) {
      const archive = findArchivedBundle(
        fh,
        join(inbox, name),
        fingerprint,
        committedBundleJournalsBySource(journals),
      );
      if (archive.state === "archived") {
        return { exitCode: 1, errors: [cleanupHint(name, archive)], lines: [] };
      }
    }
  }

  let removed = false;
  if (pre.state === "ok" && existing !== undefined) {
    if (dryRun) {
      removed = true;
    } else {
      try {
        withWorkbenchMutationLock(root, () => {
          const read = readInboxBlockers(root);
          if (read.state === "damaged") {
            throw new Error(`inbox blocker state is damaged; refusing to rewrite it: ${read.detail}`);
          }
          if (read.state !== "ok") return;
          if (inbox !== null && read.snapshot.inboxRoot !== inbox) return;
          const result = removeInboxBlockerEntry(read.snapshot, name);
          removed = result.changed;
          if (result.changed) writeInboxBlockers(root, result.snapshot);
        });
      } catch (error) {
        return {
          exitCode: 1,
          errors: [`inbox retry failed: ${(error as Error).message}`],
          lines: [],
        };
      }
    }
  }

  const lines = [
    removed
      ? `jspace: ok: cleared cached decision for "${name}"${dryRun ? " (dry-run)" : ""}`
      : `jspace: ok: no cached decision for "${name}"`,
    "  this does not file, move, ingest or verify the asset; the next pass must decide again",
  ];
  return {
    lines,
    ...(json ? { data: { entry: name, removed, dryRun, inbox } } : {}),
  };
}
