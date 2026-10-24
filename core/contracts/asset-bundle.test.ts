import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  aggregateForMembers,
  bundleManifestRelPath,
  bundleMemberPathIssue,
  decodeAssetBundleManifest,
  serializeAssetBundleManifest,
  treeSha256,
  type AssetBundleManifestV1,
  type BundleMember,
  type TreeRecord,
} from "./asset-bundle.ts";

const SLUG = "assets/acme/report";

function members(): BundleMember[] {
  return [
    { path: "README.md", kind: "file", size: 5, sha256: "a".repeat(64), executable: false },
    { path: "assets", kind: "dir" },
    { path: "assets/图 1.png", kind: "file", size: 9, sha256: "b".repeat(64), executable: false },
  ];
}

function manifest(overrides: Partial<AssetBundleManifestV1> = {}): AssetBundleManifestV1 {
  const list = members();
  return {
    schema_version: 1,
    kind: "asset-bundle",
    ownerKind: "project",
    ownerId: "acme",
    slug: SLUG,
    rootRelPath: "projects/acme/report-bundle",
    entry: "README.md",
    source: { label: "inbox/report-bundle" },
    members: list,
    aggregateSha256: aggregateForMembers(list),
    ...overrides,
  };
}

describe("tree-sha256-v1", () => {
  test("is independent of member input order and locale", () => {
    const forward = members();
    const reverse = [...members()].reverse();
    expect(treeSha256(forward.map((member) =>
      member.kind === "dir" ? ["d", member.path] : ["f", member.path, member.size, member.sha256, member.executable],
    ))).toBe(aggregateForMembers(reverse));
  });

  test("changes when path, size, digest or executable changes", () => {
    const base = manifest();
    const changedExecutable = members();
    changedExecutable[0] = { ...changedExecutable[0], executable: true } as BundleMember;
    expect(aggregateForMembers(changedExecutable)).not.toBe(base.aggregateSha256);
    const changedPath = members();
    changedPath[2] = { ...changedPath[2], path: "assets/图 2.png" } as BundleMember;
    expect(aggregateForMembers(changedPath)).not.toBe(base.aggregateSha256);
  });

  test("memoizes the exact compact JSON payload", () => {
    const expected = createHash("sha256")
      .update(JSON.stringify(["tree-sha256-v1", [
        ["f", "README.md", 5, "a".repeat(64), false],
        ["d", "assets"],
        ["f", "assets/图 1.png", 9, "b".repeat(64), false],
      ]]))
      .digest("hex");
    const records = members().map((member): TreeRecord =>
      member.kind === "dir"
        ? ["d", member.path]
        : ["f", member.path, member.size, member.sha256, member.executable],
    );
    expect(treeSha256(records)).toBe(expected);
  });
});

describe("manifest serialization and decoding", () => {
  test("fixed field order, two-space indentation and trailing LF", () => {
    const text = serializeAssetBundleManifest(manifest());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "schema_version": 1,\n  "kind": "asset-bundle"')).toBe(true);
    expect(text.indexOf('"aggregateSha256"')).toBeGreaterThan(text.indexOf('"members"'));
    const decoded = decodeAssetBundleManifest(JSON.parse(text));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(serializeAssetBundleManifest(decoded.value)).toBe(text);
  });

  test("derives the managed manifest path from the slug", () => {
    expect(bundleManifestRelPath("projects/acme/", SLUG)).toBe(
      `projects/acme/.jspace/bundles/${createHash("sha256").update(SLUG).digest("hex")}.json`,
    );
  });

  test("rejects unsorted, duplicate, fold-colliding and parent/type member paths", () => {
    const base = manifest();
    const unsorted = decodeAssetBundleManifest({ ...base, members: [...base.members].reverse() });
    expect(unsorted.ok).toBe(false);

    const duplicate = decodeAssetBundleManifest({ ...base, members: [base.members[0], base.members[0]] });
    expect(duplicate.ok).toBe(false);

    const folded = decodeAssetBundleManifest({
      ...base,
      members: [
        { path: "Report.md", kind: "file", size: 1, sha256: "c".repeat(64), executable: false },
        { path: "report.md", kind: "file", size: 1, sha256: "d".repeat(64), executable: false },
      ],
      entry: "Report.md",
      aggregateSha256: aggregateForMembers([
        { path: "Report.md", kind: "file", size: 1, sha256: "c".repeat(64), executable: false },
        { path: "report.md", kind: "file", size: 1, sha256: "d".repeat(64), executable: false },
      ]),
    });
    expect(folded.ok).toBe(false);

    const parentFile = manifest({
      members: [
        { path: "a", kind: "file", size: 1, sha256: "c".repeat(64), executable: false },
        { path: "a/b", kind: "file", size: 1, sha256: "d".repeat(64), executable: false },
      ],
      entry: "a",
      aggregateSha256: aggregateForMembers([
        { path: "a", kind: "file", size: 1, sha256: "c".repeat(64), executable: false },
        { path: "a/b", kind: "file", size: 1, sha256: "d".repeat(64), executable: false },
      ]),
    });
    expect(decodeAssetBundleManifest(parentFile).ok).toBe(false);
  });

  test("rejects unknown fields, a missing entry member and an aggregate mismatch", () => {
    const base = manifest();
    expect(decodeAssetBundleManifest({ ...base, extra: true }).ok).toBe(false);
    expect(decodeAssetBundleManifest({ ...base, entry: "missing.md" }).ok).toBe(false);
    expect(decodeAssetBundleManifest({ ...base, aggregateSha256: "f".repeat(64) }).ok).toBe(false);
  });

  test("member paths reject absolute, backslash and traversal forms", () => {
    expect(bundleMemberPathIssue("../x")).not.toBeNull();
    expect(bundleMemberPathIssue("/x")).not.toBeNull();
    expect(bundleMemberPathIssue("a\\b")).not.toBeNull();
    expect(bundleMemberPathIssue("a//b")).not.toBeNull();
    expect(bundleMemberPathIssue("a/./b")).not.toBeNull();
    expect(bundleMemberPathIssue("a/b.txt")).toBeNull();
    expect(bundleMemberPathIssue("图 1.png")).toBeNull();
  });
});
