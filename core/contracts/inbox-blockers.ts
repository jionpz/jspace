// core/contracts/inbox-blockers.ts — durable "not yet decided" inbox snapshot.
//
// An inbox entry can be genuinely blocked before any ingest journal may exist:
// nobody can prove a unique owner, or the source itself is unverified. Pending,
// runs and ingest journals all describe later stages, so they cannot represent
// that state without lying about it. This contract is deliberately just one
// local JSON snapshot — no queue, no worker, no second journal.
//
// The snapshot is useful only while both its content fingerprint and its
// routing digest are known and unchanged. `stat` size/mtime is a cheap hint,
// never proof: same-size, same-mtime content changes must invalidate it.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { isAbsolutePath } from "./paths.ts";

export const INBOX_BLOCKERS_SCHEMA_VERSION = 1;
export const INBOX_BLOCKERS_STATE_REL = ".jspace/state/inbox-blockers.json";

/** Top-level resident contract files of an inbox; never payload, never blocked. */
export const INBOX_RESIDENT_FILES = ["README.md", "AGENTS.md"] as const;
/** Marks a directory (and its contents) as intentionally exempt from tidying. */
export const SKIP_INBOX_TIDY_MARKER = ".skip-inbox-tidy";

export const INBOX_BLOCKER_CODES = ["owner_ambiguous", "source_unverified"] as const;
export type InboxBlockerCode = (typeof INBOX_BLOCKER_CODES)[number];

export const INBOX_FINGERPRINT_ALGORITHMS = ["sha256", "tree-sha256-v1"] as const;
export type InboxFingerprintAlgorithm = (typeof INBOX_FINGERPRINT_ALGORITHMS)[number];

export interface InboxFingerprintKnown {
  state: "known";
  algorithm: InboxFingerprintAlgorithm;
  value: string;
}

export interface InboxFingerprintUnknown {
  state: "unknown";
  /** Why a complete, safe fingerprint could not be produced. Never a member
   *  path that the security policy refused to inspect. */
  reason: string;
}

export type InboxFingerprint = InboxFingerprintKnown | InboxFingerprintUnknown;

export interface InboxRoutingDigestKnown {
  state: "known";
  algorithm: "sha256";
  value: string;
}

export interface InboxRoutingDigestUnknown {
  state: "unknown";
  reason: string;
}

export type InboxRoutingDigest = InboxRoutingDigestKnown | InboxRoutingDigestUnknown;

export interface InboxBlocker {
  code: InboxBlockerCode;
  /** Short, human-readable evidence gap. */
  missing: string;
  /** Optional possible owners, formatted project:<id> / area:<id>. */
  candidates?: string[];
}

export interface InboxBlockerEntry {
  /** Exact top-level basename inside the inbox. */
  name: string;
  kind: "file" | "dir";
  fingerprint: InboxFingerprint;
  routingDigest: InboxRoutingDigest;
  /** When this observation was actually captured (ISO 8601). */
  observedAt: string;
  blockers: InboxBlocker[];
}

export interface InboxBlockersV1 {
  schema_version: 1;
  /** Absolute inbox root these entries apply to. A binding change makes the
   *  whole snapshot non-applicable instead of matching same-named strangers. */
  inboxRoot: string;
  entries: InboxBlockerEntry[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_REASON_CHARS = 500;
const MAX_MISSING_CHARS = 500;

const ROOT_FIELDS = ["schema_version", "inboxRoot", "entries"] as const;
const ENTRY_FIELDS = ["name", "kind", "fingerprint", "routingDigest", "observedAt", "blockers"] as const;
const BLOCKER_FIELDS = ["code", "missing", "candidates"] as const;

/** Single-segment inbox entry name. Dot entries are not payload by contract. */
export function inboxEntryNameIssue(name: string): string | null {
  if (name.length === 0) return "must be a non-empty basename";
  if (name !== name.trim()) return "must not have leading or trailing whitespace";
  if (name === "." || name === "..") return "must not be . or ..";
  if (/[\\/]/.test(name)) return "must be one top-level basename";
  if (name.startsWith(".")) return "dot entries are not inbox payload";
  if ((INBOX_RESIDENT_FILES as readonly string[]).includes(name)) {
    return "resident inbox contract files are not payload";
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) return "must not contain control characters";
  return null;
}

export function inboxCandidateIssue(candidate: string): string | null {
  const match = /^(project|area):(.+)$/.exec(candidate);
  if (match === null) return "must be project:<id> or area:<id>";
  const id = match[2] ?? "";
  if (id.length === 0) return "candidate id must not be empty";
  if (id !== id.trim()) return "candidate id must not have surrounding whitespace";
  if (/[\\/\s:]/.test(id)) return "candidate id must be one non-empty segment";
  if (id === "." || id === "..") return "candidate id must not be . or ..";
  return null;
}

/** Read the `reason` of an unknown fingerprint/routing digest. The caller has
 *  already checked the object shape and that `state` is `"unknown"`. */
function readUnknownReason(
  value: Record<string, unknown>,
  prefix: string,
  code: string,
  issues: IssueCollector,
): string | undefined {
  const reason = value.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    issues.add(code, `${prefix}.reason`, "unknown requires a non-empty reason");
    return undefined;
  }
  if (reason.length > MAX_REASON_CHARS) {
    issues.add(code, `${prefix}.reason`, `reason exceeds ${MAX_REASON_CHARS} characters`);
    return undefined;
  }
  return reason;
}

function decodeFingerprint(value: unknown, prefix: string, issues: IssueCollector): InboxFingerprint | undefined {
  if (!isRecord(value)) {
    issues.add("inbox.fingerprint.type", prefix, "fingerprint must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  if (value.state === "unknown") {
    checkNoUnknownFields(value, ["state", "reason"], prefix, "inbox.fingerprint.unknown-field", issues);
    const reason = readUnknownReason(value, prefix, "inbox.fingerprint.reason.invalid", issues);
    return issues.issues.length === before && reason !== undefined
      ? { state: "unknown", reason }
      : undefined;
  }
  checkNoUnknownFields(
    value,
    ["state", "algorithm", "value"],
    prefix,
    "inbox.fingerprint.unknown-field",
    issues,
  );
  if (value.state !== "known") {
    issues.add("inbox.fingerprint.state.invalid", `${prefix}.state`, 'must be "known" or "unknown"');
    return undefined;
  }
  if (typeof value.algorithm !== "string" || !(INBOX_FINGERPRINT_ALGORITHMS as readonly string[]).includes(value.algorithm)) {
    issues.add(
      "inbox.fingerprint.algorithm.invalid",
      `${prefix}.algorithm`,
      `algorithm must be one of ${INBOX_FINGERPRINT_ALGORITHMS.join(", ")}`,
    );
  }
  if (typeof value.value !== "string" || !SHA256_RE.test(value.value)) {
    issues.add(
      "inbox.fingerprint.value.invalid",
      `${prefix}.value`,
      "must be a 64-character lowercase sha256 digest",
    );
  }
  if (issues.issues.length !== before) return undefined;
  return {
    state: "known",
    algorithm: value.algorithm as InboxFingerprintAlgorithm,
    value: value.value as string,
  };
}

function decodeRoutingDigest(value: unknown, prefix: string, issues: IssueCollector): InboxRoutingDigest | undefined {
  if (!isRecord(value)) {
    issues.add("inbox.routingDigest.type", prefix, "routingDigest must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  if (value.state === "unknown") {
    checkNoUnknownFields(value, ["state", "reason"], prefix, "inbox.routingDigest.unknown-field", issues);
    const reason = readUnknownReason(value, prefix, "inbox.routingDigest.reason.invalid", issues);
    return issues.issues.length === before && reason !== undefined
      ? { state: "unknown", reason }
      : undefined;
  }
  checkNoUnknownFields(
    value,
    ["state", "algorithm", "value"],
    prefix,
    "inbox.routingDigest.unknown-field",
    issues,
  );
  if (value.state !== "known") {
    issues.add("inbox.routingDigest.state.invalid", `${prefix}.state`, 'must be "known" or "unknown"');
    return undefined;
  }
  if (value.algorithm !== "sha256") {
    issues.add("inbox.routingDigest.algorithm.invalid", `${prefix}.algorithm`, 'algorithm must be "sha256"');
  }
  if (typeof value.value !== "string" || !SHA256_RE.test(value.value)) {
    issues.add(
      "inbox.routingDigest.value.invalid",
      `${prefix}.value`,
      "must be a 64-character lowercase sha256 digest",
    );
  }
  if (issues.issues.length !== before) return undefined;
  return { state: "known", algorithm: "sha256", value: value.value as string };
}

function decodeBlocker(value: unknown, prefix: string, issues: IssueCollector): InboxBlocker | undefined {
  if (!isRecord(value)) {
    issues.add("inbox.blocker.type", prefix, "blocker must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(value, BLOCKER_FIELDS, prefix, "inbox.blocker.unknown-field", issues);
  const code =
    typeof value.code === "string" && (INBOX_BLOCKER_CODES as readonly string[]).includes(value.code)
      ? (value.code as InboxBlockerCode)
      : undefined;
  if (code === undefined) {
    issues.add("inbox.blocker.code.invalid", `${prefix}.code`, `code must be one of ${INBOX_BLOCKER_CODES.join(", ")}`);
  }
  const missing = readRequiredString(value, "missing", prefix, "inbox.blocker.missing.invalid", issues);
  if (missing !== undefined) {
    if (missing.trim().length === 0) {
      issues.add("inbox.blocker.missing.invalid", `${prefix}.missing`, "missing must not be blank");
    } else if (missing.length > MAX_MISSING_CHARS) {
      issues.add(
        "inbox.blocker.missing.invalid",
        `${prefix}.missing`,
        `missing exceeds ${MAX_MISSING_CHARS} characters`,
      );
    }
  }

  let candidates: string[] | undefined;
  if (value.candidates !== undefined) {
    if (code !== undefined && code !== "owner_ambiguous") {
      issues.add(
        "inbox.blocker.candidates.unexpected",
        `${prefix}.candidates`,
        "candidates are only valid for owner_ambiguous",
      );
    }
    if (!Array.isArray(value.candidates) || value.candidates.length === 0) {
      issues.add(
        "inbox.blocker.candidates.invalid",
        `${prefix}.candidates`,
        "candidates must be a non-empty array when present",
      );
    } else {
      const seen = new Set<string>();
      const list: string[] = [];
      value.candidates.forEach((candidate, i) => {
        if (typeof candidate !== "string") {
          issues.add(
            "inbox.blocker.candidates.invalid",
            `${prefix}.candidates[${i}]`,
            "candidate must be a string",
          );
          return;
        }
        const issue = inboxCandidateIssue(candidate);
        if (issue !== null) {
          issues.add("inbox.blocker.candidates.invalid", `${prefix}.candidates[${i}]`, issue);
          return;
        }
        if (seen.has(candidate)) {
          issues.add(
            "inbox.blocker.candidates.duplicate",
            `${prefix}.candidates[${i}]`,
            `duplicate candidate: ${candidate}`,
          );
          return;
        }
        seen.add(candidate);
        list.push(candidate);
      });
      candidates = list;
    }
  }
  if (issues.issues.length !== before) return undefined;
  return {
    code: code as InboxBlockerCode,
    missing: missing as string,
    ...(candidates !== undefined ? { candidates } : {}),
  };
}

function decodeEntry(value: unknown, prefix: string, issues: IssueCollector): InboxBlockerEntry | undefined {
  if (!isRecord(value)) {
    issues.add("inbox.entry.type", prefix, "entry must be an object");
    return undefined;
  }
  const before = issues.issues.length;
  checkNoUnknownFields(value, ENTRY_FIELDS, prefix, "inbox.entry.unknown-field", issues);
  const name = readRequiredString(value, "name", prefix, "inbox.entry.name.invalid", issues);
  if (name !== undefined) {
    const issue = inboxEntryNameIssue(name);
    if (issue !== null) issues.add("inbox.entry.name.invalid", `${prefix}.name`, issue);
  }
  const kind =
    value.kind === "file" || value.kind === "dir"
      ? value.kind
      : undefined;
  if (kind === undefined) {
    issues.add("inbox.entry.kind.invalid", `${prefix}.kind`, 'kind must be "file" or "dir"');
  }
  const fingerprint = decodeFingerprint(value.fingerprint, `${prefix}.fingerprint`, issues);
  const routingDigest = decodeRoutingDigest(value.routingDigest, `${prefix}.routingDigest`, issues);
  const observedAt = readRequiredString(value, "observedAt", prefix, "inbox.entry.observedAt.invalid", issues);
  if (observedAt !== undefined && Number.isNaN(Date.parse(observedAt))) {
    issues.add("inbox.entry.observedAt.invalid", `${prefix}.observedAt`, "observedAt must be a parseable ISO date");
  }

  let blockers: InboxBlocker[] | undefined;
  if (!Array.isArray(value.blockers) || value.blockers.length === 0) {
    issues.add("inbox.entry.blockers.invalid", `${prefix}.blockers`, "blockers must be a non-empty array");
  } else {
    const seen = new Set<string>();
    const list: InboxBlocker[] = [];
    value.blockers.forEach((blocker, i) => {
      const decoded = decodeBlocker(blocker, `${prefix}.blockers[${i}]`, issues);
      if (decoded === undefined) return;
      if (seen.has(decoded.code)) {
        issues.add(
          "inbox.entry.blockers.duplicate",
          `${prefix}.blockers[${i}].code`,
          `duplicate blocker code: ${decoded.code}`,
        );
        return;
      }
      seen.add(decoded.code);
      list.push(decoded);
    });
    blockers = list;
  }

  if (issues.issues.length !== before) return undefined;
  return {
    name: name as string,
    kind: kind as "file" | "dir",
    fingerprint: fingerprint as InboxFingerprint,
    routingDigest: routingDigest as InboxRoutingDigest,
    observedAt: observedAt as string,
    blockers: blockers as InboxBlocker[],
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Canonical order: entries by exact UTF-8 name, blockers by code. */
export function sortInboxBlockers(snapshot: InboxBlockersV1): InboxBlockersV1 {
  const codeOrder = new Map(INBOX_BLOCKER_CODES.map((code, index) => [code, index]));
  return {
    ...snapshot,
    entries: [...snapshot.entries]
      .sort((a, b) => compareUtf8(a.name, b.name))
      .map((entry) => ({
        ...entry,
        blockers: [...entry.blockers].sort(
          (a, b) => (codeOrder.get(a.code) ?? 0) - (codeOrder.get(b.code) ?? 0),
        ),
      })),
  };
}

export function decodeInboxBlockers(input: unknown): DecodeResult<InboxBlockersV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("inbox.root.type", "inbox", "inbox blocker state must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ROOT_FIELDS, "inbox", "inbox.unknown-field", issues);
  readVersion(issues, "inbox.version.unsupported", "inbox.schema_version", input.schema_version, [
    INBOX_BLOCKERS_SCHEMA_VERSION,
  ]);
  const inboxRoot = readRequiredString(input, "inboxRoot", "inbox", "inbox.inboxRoot.invalid", issues);
  if (inboxRoot !== undefined) {
    if (!isAbsolutePath(inboxRoot)) {
      issues.add("inbox.inboxRoot.invalid", "inbox.inboxRoot", "must be an absolute path");
    }
    if (inboxRoot.split(/[\\/]+/).some((segment) => segment === "." || segment === "..")) {
      issues.add("inbox.inboxRoot.invalid", "inbox.inboxRoot", "must not contain . or .. segments");
    }
  }

  const entries: InboxBlockerEntry[] = [];
  if (!Array.isArray(input.entries)) {
    issues.add("inbox.entries.type", "inbox.entries", "entries must be an array");
  } else {
    const seen = new Set<string>();
    let previous: string | null = null;
    input.entries.forEach((entry, i) => {
      const decoded = decodeEntry(entry, `inbox.entries[${i}]`, issues);
      if (decoded === undefined) return;
      if (seen.has(decoded.name)) {
        issues.add(
          "inbox.entries.duplicate",
          `inbox.entries[${i}].name`,
          `duplicate inbox entry: ${decoded.name}`,
        );
        return;
      }
      if (previous !== null && compareUtf8(previous, decoded.name) >= 0) {
        issues.add(
          "inbox.entries.order",
          `inbox.entries[${i}].name`,
          "entries must be sorted by exact UTF-8 basename with no duplicates",
        );
      }
      seen.add(decoded.name);
      previous = decoded.name;
      entries.push(decoded);
    });
  }

  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: INBOX_BLOCKERS_SCHEMA_VERSION,
    inboxRoot: inboxRoot as string,
    entries,
  });
}

/** Canonical, human-readable state bytes (2-space JSON + trailing newline). */
export function serializeInboxBlockers(snapshot: InboxBlockersV1): string {
  return JSON.stringify(sortInboxBlockers(snapshot), null, 2) + "\n";
}

/** A known fingerprint/digest pair is reusable only when both sides are known
 *  and byte-identical. Unknown on either side can never be "current". */
export function sameInboxFingerprint(left: InboxFingerprint, right: InboxFingerprint): boolean {
  return (
    left.state === "known" &&
    right.state === "known" &&
    left.algorithm === right.algorithm &&
    left.value === right.value
  );
}

export function sameInboxRoutingDigest(left: InboxRoutingDigest, right: InboxRoutingDigest): boolean {
  return (
    left.state === "known" &&
    right.state === "known" &&
    left.value === right.value
  );
}
