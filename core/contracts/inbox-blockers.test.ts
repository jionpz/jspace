// core/contracts/inbox-blockers.test.ts — strict snapshot decoder/canonicalizer.
import { expect, test } from "bun:test";
import {
  INBOX_BLOCKERS_SCHEMA_VERSION,
  decodeInboxBlockers,
  serializeInboxBlockers,
  type InboxBlockersV1,
} from "./inbox-blockers.ts";

const HASH = "a".repeat(64);

function valid(): InboxBlockersV1 {
  return {
    schema_version: INBOX_BLOCKERS_SCHEMA_VERSION,
    inboxRoot: "/tmp/filehub/_inbox",
    entries: [
      {
        name: "a.pdf",
        kind: "file",
        fingerprint: { state: "known", algorithm: "sha256", value: HASH },
        routingDigest: { state: "known", algorithm: "sha256", value: HASH },
        observedAt: "2026-10-25T10:00:00.000Z",
        blockers: [{ code: "owner_ambiguous", missing: "two projects own this", candidates: ["project:acme", "area:books"] }],
      },
      {
        name: "bundle",
        kind: "dir",
        fingerprint: { state: "unknown", reason: "directory contains a symlink and is not followed" },
        routingDigest: { state: "unknown", reason: "hub.json is missing or invalid" },
        observedAt: "2026-10-25T10:01:00.000Z",
        blockers: [{ code: "source_unverified", missing: "no readable entry document" }],
      },
    ],
  };
}

test("valid snapshot round-trips and serializes canonically (sorted, trailing newline)", () => {
  const decoded = decodeInboxBlockers(valid());
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  const text = serializeInboxBlockers(decoded.value);
  expect(text.endsWith("\n")).toBe(true);
  const reparsed = decodeInboxBlockers(JSON.parse(text));
  expect(reparsed.ok).toBe(true);
  if (!reparsed.ok) return;
  expect(reparsed.value).toEqual(decoded.value);
});

test("serialization sorts entries and blockers deterministically", () => {
  const snapshot = valid();
  snapshot.entries.reverse();
  snapshot.entries[0]!.blockers.push({ code: "owner_ambiguous", missing: "second reason" });
  const text = serializeInboxBlockers(snapshot);
  const names = JSON.parse(text).entries.map((entry: { name: string }) => entry.name);
  expect(names).toEqual(["a.pdf", "bundle"]);
  expect(JSON.parse(text).entries[0].blockers.map((b: { code: string }) => b.code)).toEqual([
    "owner_ambiguous",
  ]);
});

test("rejects unknown top-level fields and unsupported versions", () => {
  const withExtra = { ...valid(), extra: true };
  const extra = decodeInboxBlockers(withExtra);
  expect(extra.ok).toBe(false);
  if (!extra.ok) expect(extra.issues.some((i) => i.code === "inbox.unknown-field")).toBe(true);

  const version = decodeInboxBlockers({ ...valid(), schema_version: 2 });
  expect(version.ok).toBe(false);
  if (!version.ok) expect(version.issues.some((i) => i.code === "inbox.version.unsupported")).toBe(true);
});

test("rejects duplicate, unsorted, path, resident and dot entry names", () => {
  for (const name of ["../escape", "a/b", ".hidden", "README.md", "AGENTS.md", ".", ".."]) {
    const snapshot = valid();
    snapshot.entries[0] = { ...snapshot.entries[0]!, name };
    const decoded = decodeInboxBlockers(snapshot);
    expect(decoded.ok).toBe(false);
  }

  const duplicate = valid();
  duplicate.entries.push({ ...duplicate.entries[0]! });
  expect(decodeInboxBlockers(duplicate).ok).toBe(false);

  const unsorted = valid();
  unsorted.entries.reverse();
  expect(decodeInboxBlockers(unsorted).ok).toBe(false);
});

test("rejects empty/blank missing, unknown blocker codes and duplicate blocker codes", () => {
  const blank = valid();
  blank.entries[0]!.blockers[0] = { code: "owner_ambiguous", missing: "   " };
  expect(decodeInboxBlockers(blank).ok).toBe(false);

  const badCode = valid();
  // @ts-expect-error intentionally invalid contract value
  badCode.entries[0]!.blockers[0] = { code: "guessed", missing: "x" };
  expect(decodeInboxBlockers(badCode).ok).toBe(false);

  const duplicate = valid();
  duplicate.entries[0]!.blockers.push({ code: "owner_ambiguous", missing: "again" });
  expect(decodeInboxBlockers(duplicate).ok).toBe(false);
});

test("candidates are owner_ambiguous-only, unique and project:/area:-shaped", () => {
  const wrongReason = valid();
  wrongReason.entries[0]!.blockers[0] = {
    code: "source_unverified",
    missing: "x",
    candidates: ["project:acme"],
  };
  expect(decodeInboxBlockers(wrongReason).ok).toBe(false);

  for (const candidates of [["acme"], ["project:"], ["project:a/b"], ["project:acme", "project:acme"]]) {
    const snapshot = valid();
    snapshot.entries[0]!.blockers[0] = { code: "owner_ambiguous", missing: "x", candidates };
    expect(decodeInboxBlockers(snapshot).ok).toBe(false);
  }
});

test("known fingerprints/digests require lowercase sha256; unknown requires a reason", () => {
  const badFingerprint = valid();
  badFingerprint.entries[0]!.fingerprint = { state: "known", algorithm: "sha256", value: "ABC" };
  expect(decodeInboxBlockers(badFingerprint).ok).toBe(false);

  const missingReason = valid();
  missingReason.entries[1]!.fingerprint = { state: "unknown", reason: "" };
  expect(decodeInboxBlockers(missingReason).ok).toBe(false);

  const badRouting = valid();
  badRouting.entries[0]!.routingDigest = { state: "known", algorithm: "sha256", value: "not-a-hash" };
  expect(decodeInboxBlockers(badRouting).ok).toBe(false);
});

test("empty blocker lists, empty entries and relative inboxRoot are rejected", () => {
  const emptyBlockers = valid();
  emptyBlockers.entries[0]!.blockers = [];
  expect(decodeInboxBlockers(emptyBlockers).ok).toBe(false);

  const relativeRoot = { ...valid(), inboxRoot: "_inbox" };
  expect(decodeInboxBlockers(relativeRoot).ok).toBe(false);

  const emptyEntries = { ...valid(), entries: [] };
  expect(decodeInboxBlockers(emptyEntries).ok).toBe(true);
});
