// cli/update.test.ts — self-update logic: pure functions (version comparison,
// asset mapping, checksum parsing, tag/API error semantics) plus the
// replace-path guards run against a temp fixture "install dir" (never the real
// binary): a checksum-valid download that cannot run must be discarded with the
// live binary untouched.
// Run: bun test cli/update.test.ts
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  isDevVersion,
  assetFor,
  cmdUpdate,
  expectedHash,
  githubApiFailure,
  normalizeReleaseTag,
  probeFailureMessage,
  probeVerdict,
  replaceErrorMessage,
  resolveTargetVersion,
  type ProbeFn,
  type UpdateDeps,
} from "./update.ts";
import { sha256OfBytes } from "../core/shared/hash.ts";

test("compareVersions compares numeric X.Y.Z", () => {
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  expect(compareVersions("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexicographic
  expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
});

test("compareVersions handles v prefix and missing parts", () => {
  expect(compareVersions("v1.0.2", "1.0.2")).toBe(0);
  expect(compareVersions("v1.0.2", "1.0.2")).toBe(0);
  expect(compareVersions("1.0", "1.0.0")).toBe(0); // missing patch = 0
  expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0); // prerelease tail ignored
});

test("isDevVersion detects the build placeholder", () => {
  expect(isDevVersion("0.0.0-dev")).toBe(true);
  expect(isDevVersion("0.0.0")).toBe(true);
  expect(isDevVersion("v1.0.2")).toBe(false);
});

test("assetFor maps platform/arch to release asset names", () => {
  expect(assetFor("darwin", "arm64")).toBe("jspace-macos-arm64");
  expect(assetFor("darwin", "x64")).toBe("jspace-macos-x64");
  expect(assetFor("linux", "arm64")).toBe("jspace-linux-arm64");
  expect(assetFor("linux", "x64")).toBe("jspace-linux-x64");
  expect(assetFor("win32", "arm64")).toBe("jspace-windows-arm64.exe");
  expect(assetFor("win32", "x64")).toBe("jspace-windows-x64.exe");
  expect(() => assetFor("freebsd", "x64")).toThrow();
  expect(() => assetFor("linux", "ia32")).toThrow();
});

test("expectedHash matches the asset column (with * prefix and case)", () => {
  const checksums =
    "aaaa  jspace-linux-x64\nBBBB *jspace-macos-arm64\n";
  expect(expectedHash(checksums, "jspace-linux-x64")).toBe("aaaa");
  expect(expectedHash(checksums, "jspace-macos-arm64")).toBe("bbbb"); // lowercased
  expect(expectedHash(checksums, "jspace-windows-x64.exe")).toBeNull();
});

test("resolveTargetVersion passes a concrete tag through without resolving", async () => {
  let called = false;
  const t = await resolveTargetVersion("v1.0.2", async () => {
    called = true;
    return "v9.9.9";
  });
  expect(t).toBe("v1.0.2");
  expect(called).toBe(false);
});

test("resolveTargetVersion resolves latest (and default) via the tag source", async () => {
  expect(await resolveTargetVersion("latest", async () => "v1.0.3")).toBe("v1.0.3");
  expect(await resolveTargetVersion(undefined, async () => "v1.0.2")).toBe("v1.0.2");
});

test("sha256OfBytes produces a 64-hex digest", () => {
  expect(sha256OfBytes(new TextEncoder().encode("jspace"))).toMatch(/^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------- B9: tag form

test("normalizeReleaseTag accepts vX.Y.Z (bare X.Y.Z normalized to the tag form)", () => {
  expect(normalizeReleaseTag("v1.0.14")).toBe("v1.0.14");
  expect(normalizeReleaseTag("1.0.14")).toBe("v1.0.14");
  expect(normalizeReleaseTag("  v10.20.30 ")).toBe("v10.20.30");
});

test("normalizeReleaseTag rejects prerelease/partial/garbage tags loudly", () => {
  for (const bad of ["v1.2.3-beta.1", "1.2", "v1.2.3.4", "nightly", "latest", "v1.2.3+build", ""]) {
    expect(() => normalizeReleaseTag(bad)).toThrow(/只接受正式发布 tag vX\.Y\.Z/);
  }
});

test("resolveTargetVersion rejects a prerelease tag before any download", async () => {
  await expect(resolveTargetVersion("v2.0.0-rc.1", async () => "v1.0.0")).rejects.toThrow(
    /只接受正式发布 tag/,
  );
  // a prerelease coming back from the API is rejected the same way
  await expect(resolveTargetVersion(undefined, async () => "v2.0.0-rc.1")).rejects.toThrow(
    /只接受正式发布 tag/,
  );
});

// ------------------------------------------------------- B9: GitHub API errors

test("githubApiFailure gives rate-limit-specific guidance for 403/429", () => {
  const limited = githubApiFailure(403, { get: (n) => (n === "x-ratelimit-remaining" ? "0" : null) });
  expect(limited).toContain("速率限制");
  expect(limited).toContain("--version");

  const reset = githubApiFailure(429, {
    get: (n) => (n === "x-ratelimit-reset" ? "1700000000" : null),
  });
  expect(reset).toContain("速率限制");
  expect(reset).toContain(new Date(1_700_000_000_000).toISOString());
});

test("githubApiFailure separates a plain 403 (proxy/policy) from the rate limit", () => {
  const denied = githubApiFailure(403, { get: (n) => (n === "x-ratelimit-remaining" ? "57" : null) });
  expect(denied).toContain("拒绝访问");
  expect(denied).not.toContain("速率限制");
  expect(denied).toContain("--version");
});

test("githubApiFailure keeps the generic message for other statuses", () => {
  expect(githubApiFailure(500, null)).toContain("HTTP 500");
  expect(githubApiFailure(500, null)).not.toContain("速率限制");
});

test("cmdUpdate surfaces the rate-limit message when the releases API 403s", async () => {
  const fetchImpl = (async () =>
    new Response("rate limited", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    })) as unknown as typeof fetch;
  await expect(
    cmdUpdate(true, undefined, { version: "1.0.0", platform: "linux", arch: "x64", env: {}, fetchImpl }),
  ).rejects.toThrow(/速率限制/);
});

// ------------------------------------------------- B9: replace-failure wording

test("replaceErrorMessage maps permission/space/lock errors to actionable text", () => {
  const eacces = replaceErrorMessage(Object.assign(new Error("permission denied"), { code: "EACCES" }), "/opt/bin/jspace");
  expect(eacces).toContain("EACCES");
  expect(eacces).toContain("不可写");
  expect(eacces).toContain("现有二进制未被改动");

  expect(replaceErrorMessage(Object.assign(new Error("no space"), { code: "ENOSPC" }), "/opt/bin/jspace")).toContain(
    "磁盘空间不足",
  );
  expect(replaceErrorMessage(Object.assign(new Error("busy"), { code: "ETXTBSY" }), "/opt/bin/jspace")).toContain(
    "文件被占用",
  );
  // unknown errors still get a user-facing sentence, never a bare stack
  const other = replaceErrorMessage(new Error("kaboom"), "/opt/bin/jspace");
  expect(other).toContain("替换 /opt/bin/jspace 失败");
  expect(other).toContain("kaboom");
});

// -------------------------------------------------------- B2: pre-replace probe

test("probeVerdict passes only when the new binary exits 0 with the target version", () => {
  expect(probeVerdict({ exit: 0, output: "jspace 1.0.14\n" }, "v1.0.14")).toBeNull();
  expect(probeVerdict({ exit: 1, output: "" }, "v1.0.14")).toContain("退出码 1");
  expect(probeVerdict({ exit: 0, output: "jspace 1.0.13\n" }, "v1.0.14")).toContain("未输出目标版本");
  expect(probeVerdict({ exit: null, output: "", error: "被信号 SIGILL 终止" }, "v1.0.14")).toContain("无法执行");
});

test("probeFailureMessage names the AVX2 boundary on Windows", () => {
  const win = probeFailureMessage("新二进制无法执行（x）", "win32", "jspace-windows-x64.exe");
  expect(win).toContain("AVX2");
  expect(win).toContain("未被替换");
  expect(probeFailureMessage("新二进制无法执行（x）", "linux", "jspace-linux-x64")).toContain("指令集");
});

/** A fixture install dir holding a fake current binary named `jspace`. */
function fixtureInstall(): { dir: string; exe: string } {
  const dir = mkdtempSync(join(tmpdir(), "jspace-update-"));
  const exe = join(dir, "jspace");
  writeFileSync(exe, "CURRENT-BINARY");
  chmodSync(exe, 0o755);
  return { dir, exe };
}

/** fetch stub serving one release: the asset bytes + a matching checksums.txt. */
function releaseFetch(asset: string, bytes: Uint8Array): typeof fetch {
  const checksums = `${sha256OfBytes(bytes)}  ${asset}\n`;
  return (async (input: string) =>
    String(input).endsWith("checksums.txt")
      ? new Response(checksums)
      : new Response(bytes)) as unknown as typeof fetch;
}

function updateDeps(exe: string, bytes: Uint8Array, probe?: ProbeFn): UpdateDeps {
  return {
    execPath: exe,
    platform: "linux",
    arch: "x64",
    version: "1.0.0",
    env: {},
    fetchImpl: releaseFetch("jspace-linux-x64", bytes),
    probe,
    log: () => {},
  };
}

test("cmdUpdate discards a checksum-valid binary that fails --version (never bricks the install)", async () => {
  const { dir, exe } = fixtureInstall();
  const bytes = new TextEncoder().encode("NEW-BUT-BROKEN");
  const deps = updateDeps(exe, bytes, () => ({ exit: 132, output: "Illegal instruction" }));

  await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/退出码 132/);
  // the live binary is untouched and the staging file is gone
  expect(readFileSync(exe, "utf-8")).toBe("CURRENT-BINARY");
  expect(readdirSync(dir)).toEqual(["jspace"]);
});

test("cmdUpdate rejects a binary whose --version reports a different version", async () => {
  const { dir, exe } = fixtureInstall();
  const bytes = new TextEncoder().encode("NEW-WRONG-VERSION");
  const deps = updateDeps(exe, bytes, () => ({ exit: 0, output: "jspace 1.0.98\n" }));

  await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/未输出目标版本 1\.0\.99/);
  expect(readFileSync(exe, "utf-8")).toBe("CURRENT-BINARY");
  expect(readdirSync(dir)).toEqual(["jspace"]);
});

test("cmdUpdate replaces the binary once the self-check passes", async () => {
  const { dir, exe } = fixtureInstall();
  const bytes = new TextEncoder().encode("NEW-GOOD");
  const deps = updateDeps(exe, bytes, () => ({ exit: 0, output: "jspace 1.0.99\n" }));

  await cmdUpdate(false, "v1.0.99", deps);
  expect(readFileSync(exe, "utf-8")).toBe("NEW-GOOD");
  expect(readdirSync(dir)).toEqual(["jspace"]);
});

test("cmdUpdate still fails the checksum before ever probing", async () => {
  const { exe } = fixtureInstall();
  let probed = false;
  const bytes = new TextEncoder().encode("NEW-GOOD");
  const deps = updateDeps(exe, bytes, () => {
    probed = true;
    return { exit: 0, output: "jspace 1.0.99\n" };
  });
  // serve the asset bytes but a checksums.txt computed over different bytes
  const wrong = `${sha256OfBytes(new TextEncoder().encode("OTHER"))}  jspace-linux-x64\n`;
  deps.fetchImpl = (async (input: string) =>
    String(input).endsWith("checksums.txt") ? new Response(wrong) : new Response(bytes)) as unknown as typeof fetch;

  await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/SHA-256 校验不匹配/);
  expect(probed).toBe(false);
  expect(readFileSync(exe, "utf-8")).toBe("CURRENT-BINARY");
});

test("cmdUpdate turns a filesystem replace failure into a business error, not a stack", async () => {
  const bytes = new TextEncoder().encode("NEW-GOOD");
  // install dir does not exist -> staging write fails (ENOENT) inside installBinary
  const deps = updateDeps(join(tmpdir(), "jspace-absent-install-dir", "jspace"), bytes, () => ({
    exit: 0,
    output: "jspace 1.0.99\n",
  }));
  await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/失败/);
});

// The production probe (spawnSync) needs a real executable; the fake "binary" is
// a shell script, so this pair is POSIX-only.
const posix = process.platform !== "win32";

test.if(posix)("the real probe rejects a downloaded binary that cannot run", async () => {
  const { dir, exe } = fixtureInstall();
  const bytes = new TextEncoder().encode("#!/bin/sh\nexit 3\n");
  const deps = updateDeps(exe, bytes); // no probe injected: production spawnSync path

  await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/自检|退出码 3/);
  expect(readFileSync(exe, "utf-8")).toBe("CURRENT-BINARY");
  expect(readdirSync(dir)).toEqual(["jspace"]);
});

test.if(posix)("the real probe accepts a downloaded binary printing the target version", async () => {
  const { exe } = fixtureInstall();
  const bytes = new TextEncoder().encode("#!/bin/sh\necho 'jspace 1.0.99'\n");
  const deps = updateDeps(exe, bytes);

  await cmdUpdate(false, "v1.0.99", deps);
  expect(readFileSync(exe, "utf-8")).toContain("echo 'jspace 1.0.99'");
});

test.if(posix && process.getuid !== undefined && process.getuid() !== 0)(
  "cmdUpdate reports an unwritable install dir as EACCES guidance",
  async () => {
    const { dir, exe } = fixtureInstall();
    chmodSync(dir, 0o555);
    try {
      const bytes = new TextEncoder().encode("NEW-GOOD");
      const deps = updateDeps(exe, bytes, () => ({ exit: 0, output: "jspace 1.0.99\n" }));
      await expect(cmdUpdate(false, "v1.0.99", deps)).rejects.toThrow(/不可写/);
      expect(readFileSync(exe, "utf-8")).toBe("CURRENT-BINARY");
    } finally {
      chmodSync(dir, 0o755);
    }
  },
);
