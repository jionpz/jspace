// application/registry/inbox-state.ts — read/write the inbox blocker snapshot.
//
// A damaged snapshot is a visible state, never an empty one: status may still
// list inbox files but must say blocker coverage is unavailable, and mutations
// refuse to overwrite the damaged bytes. Writes are atomic and short; callers
// perform deep fingerprints/routing reads outside the mutation lock.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import {
  INBOX_BLOCKERS_STATE_REL,
  INBOX_BLOCKER_CODES,
  decodeInboxBlockers,
  serializeInboxBlockers,
  sortInboxBlockers,
  type InboxBlockerEntry,
  type InboxBlockersV1,
} from "../../core/contracts/inbox-blockers.ts";

const MAX_STATE_BYTES = 16 * 1024 * 1024;

export type InboxBlockersRead =
  | { state: "missing" }
  | { state: "ok"; snapshot: InboxBlockersV1 }
  | { state: "damaged"; detail: string };

export function inboxBlockersPath(root: string): string {
  return join(root, INBOX_BLOCKERS_STATE_REL);
}

/** Read-only snapshot probe. Never throws: unreadable, symlinked, oversized,
 *  non-UTF-8, non-JSON and schema-invalid files all report `damaged`. */
export function readInboxBlockers(root: string): InboxBlockersRead {
  const path = inboxBlockersPath(root);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { state: "missing" };
    return { state: "damaged", detail: "state file could not be inspected" };
  }
  if (stat.isSymbolicLink()) return { state: "damaged", detail: "state file is a symlink and is not followed" };
  if (!stat.isFile()) return { state: "damaged", detail: "state path is not a regular file" };
  if (stat.size > MAX_STATE_BYTES) {
    return { state: "damaged", detail: `state file exceeds ${MAX_STATE_BYTES} bytes` };
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return { state: "damaged", detail: "state file could not be read" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { state: "damaged", detail: "state file is not valid UTF-8" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "damaged", detail: "state file is not valid JSON" };
  }
  const decoded = decodeInboxBlockers(parsed);
  if (!decoded.ok) {
    return {
      state: "damaged",
      detail: decoded.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
    };
  }
  return { state: "ok", snapshot: decoded.value };
}

export function validateInboxBlockers(snapshot: InboxBlockersV1): void {
  const decoded = decodeInboxBlockers(snapshot);
  if (!decoded.ok) {
    throw new Error(
      `refusing to write invalid inbox blocker state: ${decoded.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
}

export function writeInboxBlockers(root: string, snapshot: InboxBlockersV1): void {
  validateInboxBlockers(snapshot);
  writeBytesAtomic(inboxBlockersPath(root), serializeInboxBlockers(snapshot));
}

const CODE_ORDER = new Map(INBOX_BLOCKER_CODES.map((code, index) => [code, index]));

function blockerSignature(entry: InboxBlockerEntry): string {
  return JSON.stringify({
    kind: entry.kind,
    fingerprint: entry.fingerprint,
    routingDigest: entry.routingDigest,
    blockers: [...entry.blockers].sort(
      (a, b) => (CODE_ORDER.get(a.code) ?? 0) - (CODE_ORDER.get(b.code) ?? 0),
    ),
  });
}

/** Merge one explicitly-observed entry. A same-name but different-kind entry is
 *  a new object, so its old reasons are not inherited. Same-code reasons are
 *  updated in place; different codes accumulate. Identical observations keep
 *  the prior `observedAt`, making a repeat `inbox block` byte-idempotent. */
export function mergeInboxBlockerEntry(
  snapshot: InboxBlockersV1,
  next: InboxBlockerEntry,
): { snapshot: InboxBlockersV1; changed: boolean } {
  const existing = snapshot.entries.find((entry) => entry.name === next.name);
  if (existing === undefined) {
    return {
      snapshot: sortInboxBlockers({ ...snapshot, entries: [...snapshot.entries, next] }),
      changed: true,
    };
  }

  if (existing.kind !== next.kind) {
    return {
      snapshot: sortInboxBlockers({
        ...snapshot,
        entries: snapshot.entries.map((entry) => (entry.name === next.name ? next : entry)),
      }),
      changed: blockerSignature(existing) !== blockerSignature(next),
    };
  }

  const blockers = [
    ...existing.blockers.filter((old) => !next.blockers.some((fresh) => fresh.code === old.code)),
    ...next.blockers,
  ];
  // Preserve the original observation time only when the captured identity and
  // reasons are otherwise identical; any change refreshes `observedAt`.
  const identical = blockerSignature(existing) === blockerSignature({ ...next, blockers });
  const merged: InboxBlockerEntry = {
    ...next,
    blockers,
    observedAt: identical ? existing.observedAt : next.observedAt,
  };

  if (blockerSignature(existing) === blockerSignature(merged)) {
    return { snapshot, changed: false };
  }
  return {
    snapshot: sortInboxBlockers({
      ...snapshot,
      entries: snapshot.entries.map((entry) => (entry.name === next.name ? merged : entry)),
    }),
    changed: true,
  };
}

export function removeInboxBlockerEntry(
  snapshot: InboxBlockersV1,
  name: string,
): { snapshot: InboxBlockersV1; changed: boolean } {
  const entries = snapshot.entries.filter((entry) => entry.name !== name);
  if (entries.length === snapshot.entries.length) return { snapshot, changed: false };
  return { snapshot: sortInboxBlockers({ ...snapshot, entries }), changed: true };
}
