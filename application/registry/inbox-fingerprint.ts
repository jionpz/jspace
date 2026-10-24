// application/registry/inbox-fingerprint.ts — bounded, safe evidence for an
// inbox snapshot.
//
// Two independent proofs decide whether an earlier "not yet decided" record may
// be reused:
//   fingerprint     what the source bytes/tree are now;
//   routingDigest   what the current registry, owner indexes and filing contract
//                   say about ownership.
// Both must be known and byte-identical. size/mtime alone is never evidence.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BUNDLE_MAX_FILE_BYTES } from "../../core/contracts/asset-bundle.ts";
import type { HubV1 } from "../../core/contracts/hub.ts";
import type {
  InboxFingerprint,
  InboxRoutingDigest,
} from "../../core/contracts/inbox-blockers.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { scanBundleTree, sha256FileNoFollow } from "../filehub/bundle.ts";
import { isRestrictedPath } from "../filehub/path-policy.ts";
import { resolveFilehubRoot } from "./filehub-lookup.ts";

const ROUTING_VERSION = "inbox-routing-v1";
const MAX_README_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_INDEXES = 500;
const MAX_ROUTING_BYTES = 16 * 1024 * 1024;

type BoundedRead =
  | { state: "ok"; bytes: Buffer }
  | { state: "missing" }
  | { state: "unreadable" };

/** Read a regular file without following a final-component symlink, bounded by
 *  size. Missing is distinct from unreadable/unsafe. */
function readBounded(abs: string, maxBytes: number): BoundedRead {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { state: "missing" } : { state: "unreadable" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { state: "unreadable" };
  if (stat.size > maxBytes) return { state: "unreadable" };
  try {
    return { state: "ok", bytes: readFileSync(abs) };
  } catch {
    return { state: "unreadable" };
  }
}

function fingerprintUnknown(reason: string): InboxFingerprint {
  return { state: "unknown", reason };
}

/** Bounded content/tree fingerprint. A symlink, special file, restricted member
 *  or exhausted budget is `unknown` with a safe reason, never a partial hash. */
export function fingerprintInboxEntry(inbox: string, name: string): InboxFingerprint {
  const abs = join(inbox, name);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fingerprintUnknown(
      code === "ENOENT" || code === "ENOTDIR"
        ? "entry disappeared before it could be fingerprinted"
        : "entry could not be inspected",
    );
  }
  if (stat.isSymbolicLink()) {
    return fingerprintUnknown("entry is a symlink and is not followed");
  }
  if (stat.isDirectory()) {
    const scan = scanBundleTree(abs);
    if (scan.state !== "ok" || scan.aggregateSha256 === undefined) {
      switch (scan.code) {
        case "restricted":
          return fingerprintUnknown("directory contains a restricted path");
        case "symlink":
          return fingerprintUnknown("directory contains a symlink and is not followed");
        case "unsupported":
          return fingerprintUnknown("directory contains a non-regular member");
        case "limit_members":
        case "limit_bytes":
        case "limit_depth":
          return fingerprintUnknown("directory exceeds the fingerprint budget");
        case "root_symlink":
          return fingerprintUnknown("entry is a symlink and is not followed");
        case "root_missing":
        case "root_not_directory":
          return fingerprintUnknown("entry is not a readable directory");
        default:
          return fingerprintUnknown("directory is not fully readable");
      }
    }
    return {
      state: "known",
      algorithm: "tree-sha256-v1",
      value: scan.aggregateSha256,
    };
  }
  if (!stat.isFile()) {
    return fingerprintUnknown("entry is neither a regular file nor a directory");
  }
  if (stat.size > BUNDLE_MAX_FILE_BYTES) {
    return fingerprintUnknown("file exceeds the fingerprint budget");
  }
  try {
    return { state: "known", algorithm: "sha256", value: sha256FileNoFollow(abs) };
  } catch {
    return fingerprintUnknown("file could not be read without following links");
  }
}

interface RoutingInput {
  rel: string;
  bytes: Buffer;
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function routingUnknown(reason: string): InboxRoutingDigest {
  return { state: "unknown", reason };
}

/** Select the owner indexes that currently describe routing: every registered
 *  project root plus every direct area directory. A missing index is itself a
 *  stable, hashed routing state; an unreadable one makes the digest unknown. */
function collectOwnerIndexes(
  filehubRoot: string,
  hub: HubV1,
): { rels: string[] } | { error: string } {
  const rels = new Set<string>();
  for (const project of hub.projects) {
    const rel = project.asset_rel_path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (rel.length === 0 || rel.startsWith("/") || rel.split("/").some((s) => s === "." || s === "..")) {
      return { error: "a registered project asset path is not a safe filehub-relative path" };
    }
    rels.add(`${rel}/index.md`);
  }

  const areasRoot = join(filehubRoot, "areas");
  let areaNames: string[];
  try {
    areaNames = readdirSync(areasRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { rels: [...rels].sort(utf8Compare) };
    return { error: "filehub areas/ could not be listed" };
  }
  for (const name of areaNames) {
    if (name.startsWith(".")) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(join(areasRoot, name));
    } catch {
      return { error: "an area directory could not be inspected" };
    }
    if (stat.isSymbolicLink()) return { error: "areas/ contains a symlink" };
    if (!stat.isDirectory()) continue;
    rels.add(`areas/${name}/index.md`);
  }
  return { rels: [...rels].sort(utf8Compare) };
}

/** Bounded hash of every input that can change who owns an inbox entry. Inputs
 *  are sorted by relative path and length-prefixed, so concatenation ambiguity
 *  cannot forge an unchanged digest. */
export function computeInboxRoutingDigest(root: string, inboxRoot: string): InboxRoutingDigest {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok") return routingUnknown("hub.json is missing or invalid");
  const filehubRoot = resolveFilehubRoot(root);
  if (filehubRoot === null) return routingUnknown("filehub is not registered or bound");

  const inputs: RoutingInput[] = [];
  let total = 0;
  const add = (rel: string, bytes: Buffer): void => {
    total += bytes.length;
    inputs.push({ rel, bytes });
  };

  const hubBytes = readBounded(join(root, ".jspace", "hub.json"), MAX_README_BYTES);
  if (hubBytes.state !== "ok") return routingUnknown("hub.json could not be read completely");
  add(".jspace/hub.json", hubBytes.bytes);

  const localBytes = readBounded(join(root, ".jspace", "local.json"), MAX_README_BYTES);
  if (localBytes.state !== "ok") return routingUnknown("local.json could not be read completely");
  add(".jspace/local.json", localBytes.bytes);

  const readme = readBounded(join(filehubRoot, "README.md"), MAX_README_BYTES);
  if (readme.state === "ok") {
    add("README.md", readme.bytes);
  } else if (readme.state === "missing") {
    add("README.md", Buffer.from("missing", "utf8"));
  } else {
    return routingUnknown("filehub README could not be read completely");
  }

  const indexes = collectOwnerIndexes(filehubRoot, reads.hub.value);
  if ("error" in indexes) return routingUnknown(indexes.error);
  if (indexes.rels.length > MAX_INDEXES) {
    return routingUnknown(`more than ${MAX_INDEXES} owner indexes require review`);
  }
  for (const rel of indexes.rels) {
    if (isRestrictedPath(rel)) return routingUnknown("an owner index path is restricted");
    const read = readBounded(join(filehubRoot, rel), MAX_INDEX_BYTES);
    if (read.state === "ok") add(rel, read.bytes);
    else if (read.state === "missing") add(rel, Buffer.from("missing", "utf8"));
    else return routingUnknown(`owner index could not be read completely: ${rel}`);
    if (total > MAX_ROUTING_BYTES) return routingUnknown("routing inputs exceed the fingerprint budget");
  }

  add("inboxRoot", Buffer.from(inboxRoot, "utf8"));
  inputs.sort((a, b) => utf8Compare(a.rel, b.rel));

  const hash = createHash("sha256");
  hash.update(`${ROUTING_VERSION}\0`);
  for (const input of inputs) {
    hash.update(`${input.rel}\0${input.bytes.length}\0`);
    hash.update(input.bytes);
  }
  return { state: "known", algorithm: "sha256", value: hash.digest("hex") };
}

/** The full-tree aggregate a bundle journal recorded for a source can be
 *  compared directly with a known tree fingerprint. */
export function treeAggregateOf(fingerprint: InboxFingerprint): string | null {
  return fingerprint.state === "known" && fingerprint.algorithm === "tree-sha256-v1"
    ? fingerprint.value
    : null;
}

/** Test seam for the manifest-relative target path check (also used by the
 *  archive verifier). */
export function filehubRelativePath(filehubRoot: string, abs: string): string | null {
  const rootAbs = resolve(filehubRoot);
  const targetAbs = resolve(abs);
  const rel = relative(rootAbs, targetAbs).replace(/\\/g, "/");
  if (rel.length === 0 || rel.startsWith("../") || rel === ".." || resolve(rootAbs, rel) !== targetAbs) {
    return null;
  }
  return rel;
}
