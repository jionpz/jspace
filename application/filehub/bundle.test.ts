import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateForMembers,
  serializeAssetBundleManifest,
  type AssetBundleManifestV1,
} from "../../core/contracts/asset-bundle.ts";
import { compareBundleTree, readBundleManifest, scanBundleTree } from "./bundle.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-bundle-scan-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content = "x"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function manifestFor(slug: string, entry: string, scanRoot = root): AssetBundleManifestV1 {
  const scan = scanBundleTree(scanRoot);
  if (scan.state !== "ok") throw new Error(scan.detail);
  const members = [
    ...scan.directories.map((path) => ({ path, kind: "dir" as const })),
    ...scan.files.map((file) => ({
      path: file.path,
      kind: "file" as const,
      size: file.size,
      sha256: file.sha256,
      executable: file.executable,
    })),
  ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return {
    schema_version: 1,
    kind: "asset-bundle",
    ownerKind: "project",
    ownerId: "acme",
    slug,
    rootRelPath: "projects/acme/bundle",
    entry,
    source: { label: "inbox/bundle" },
    members,
    aggregateSha256: aggregateForMembers(members),
  };
}

describe("bundle traversal", () => {
  test("includes hidden files, empty directories and Unicode paths in a deterministic tree", () => {
    write("README.md", "entry\n");
    write(".hidden", "h");
    write("assets/图 1.txt", "image");
    mkdirSync(join(root, "empty"));
    chmodSync(join(root, "README.md"), 0o755);
    const scan = scanBundleTree(root);
    expect(scan.state).toBe("ok");
    expect(scan.files.map((file) => file.path)).toContain(".hidden");
    expect(scan.directories).toContain("empty");
    expect(scan.files.find((file) => file.path === "README.md")?.executable).toBe(true);
    expect(scan.aggregateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(scan.aggregateSha256).toBe(aggregateForMembers([
      ...scan.directories.map((path) => ({ path, kind: "dir" as const })),
      ...scan.files.map((file) => ({
        path: file.path,
        kind: "file" as const,
        size: file.size,
        sha256: file.sha256,
        executable: file.executable,
      })),
    ]));
  });

  test("refuses the whole tree for restricted paths without echoing the name", () => {
    write("README.md", "entry\n");
    write("secrets/token.json", "secret");
    const scan = scanBundleTree(root);
    expect(scan.state).toBe("error");
    expect(scan.code).toBe("restricted");
    expect(scan.detail).not.toContain("token.json");
    expect(scan.detail).not.toContain("secrets");
  });

  test("refuses symlinks and special nodes instead of following or skipping them", () => {
    write("README.md", "entry\n");
    symlinkSync(join(root, "README.md"), join(root, "link.md"));
    const linked = scanBundleTree(root);
    expect(linked.state).toBe("error");
    expect(linked.code).toBe("symlink");

    rmSync(join(root, "link.md"));
    write("README.md", "entry\n");
    symlinkSync("/dev/null", join(root, "device"));
    const special = scanBundleTree(root);
    expect(special.state).toBe("error");
    expect(special.code).toBe("symlink");
  });

  test("refuses a tree deeper than the fixed budget", () => {
    let rel = "README.md";
    write(rel, "entry\n");
    rel = Array.from({ length: 33 }, (_, index) => `d${index}`).join("/");
    write(`${rel}/file.txt`, "deep");
    const scan = scanBundleTree(root);
    expect(scan.state).toBe("error");
    expect(scan.code).toBe("limit_depth");
  });
});

describe("manifest reading and bidirectional comparison", () => {
  test("reads a strict manifest and reports extra/missing/changed members", () => {
    write("bundle/README.md", "entry\n");
    write("bundle/notes/a.txt", "a");
    const manifest = manifestFor("assets/acme/bundle", "README.md", join(root, "bundle"));
    mkdirSync(join(root, "meta"), { recursive: true });
    writeFileSync(join(root, "meta", "manifest.json"), serializeAssetBundleManifest(manifest));
    const read = readBundleManifest(root, "meta/manifest.json");
    expect(read.state).toBe("ok");
    expect(read.manifestSha256).toBe(
      createHash("sha256").update(serializeAssetBundleManifest(manifest)).digest("hex"),
    );

    const clean = compareBundleTree(read.manifest!, scanBundleTree(join(root, "bundle")));
    expect(clean).toEqual({ missing: [], extra: [], changed: [] });

    write("bundle/notes/extra.txt", "extra");
    write("bundle/notes/a.txt", "changed");
    rmSync(join(root, "bundle", "README.md"));
    const scan = scanBundleTree(join(root, "bundle"));
    const diff = compareBundleTree(read.manifest!, scan);
    expect(diff.extra).toContain("notes/extra.txt");
    expect(diff.changed).toContain("notes/a.txt");
    expect(diff.missing).toContain("README.md");
  });

  test("refuses a manifest that escapes the filehub or is a symlink", () => {
    expect(readBundleManifest(root, "../outside.json").state).toBe("invalid");
    mkdirSync(join(root, "meta"), { recursive: true });
    writeFileSync(join(root, "meta", "real.json"), "{}");
    symlinkSync(join(root, "meta", "real.json"), join(root, "meta", "link.json"));
    expect(readBundleManifest(root, "meta/link.json").state).toBe("symlink");
  });
});
