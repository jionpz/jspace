// cli/update.ts — `jspace update`: self-update from GitHub Releases.
// Only contacts the network when explicitly invoked (no background phone-home).
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { VERSION } from "./version.generated.ts";
import { fail } from "./errors.ts";

const REPO = "jionpz/jspace";
const DEFAULT_BASE = `https://github.com/${REPO}/releases`;

/** Numeric comparison of X.Y.Z (leading `v` stripped; missing parts = 0). */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function parts(v: string): number[] {  const nums = v
    .trim()
    .replace(/^v/, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => {
      const m = /^\d+/.exec(n);
      return m ? parseInt(m[0], 10) : 0;
    });
  while (nums.length < 3) nums.push(0);
  return nums;
}

/** A locally-built placeholder (not a release build) — never self-update it. */
export function isDevVersion(v: string): boolean {
  return v.startsWith("0.0.0");
}

/** Map the running platform/arch to the release asset name. */
export function assetFor(platform: string, arch: string): string {
  const os =
    platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : null;
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!os || !a) fail(`不支持的平台/架构: ${platform}/${arch}（支持 macOS/Linux/Windows × x64/arm64）`);
  return `jspace-${os}-${a}${platform === "win32" ? ".exe" : ""}`;
}

export function sha256Of(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Pull the expected SHA-256 for `asset` from checksums.txt (handles `*` prefix). */
export function expectedHash(checksums: string, asset: string): string | null {
  for (const line of checksums.split(/\r?\n/)) {
    const m = line.trim().split(/\s+/);
    if (m.length < 2) continue;
    let f = m[1];
    if (f.startsWith("*")) f = f.slice(1);
    if (f === asset) return m[0].toLowerCase();
  }
  return null;
}

/** fetch that turns network-level failures into a clear user-facing error. */
async function fetchOrFail(url: string, what: string, headers?: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, headers ? { headers } : undefined);
  } catch {
    fail(`${what}失败（网络错误）。请检查网络后重试，或手动重跑安装脚本`);
  }
}

async function latestTag(): Promise<string> {
  const r = await fetchOrFail(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    "获取最新版本",
    { Accept: "application/vnd.github+json" },
  );
  if (!r.ok) fail(`获取最新版本失败（HTTP ${r.status}）。请检查网络，或手动重跑安装脚本`);
  const j = (await r.json()) as { tag_name?: string };
  if (!j.tag_name) fail("GitHub 未返回版本号");
  return j.tag_name;
}

/** 把请求的版本解析成具体 tag。`latest` 是 GitHub 别名，不能直接拼进
 *  /download/<tag>（会被当字面 tag 返回 404），必须先解析成真实 tag。 */
export async function resolveTargetVersion(
  requested: string | undefined,
  resolveLatest: () => Promise<string>,
): Promise<string> {
  return requested && requested !== "latest" ? requested : await resolveLatest();
}

/** Resolve symlinks so we replace the real binary (symlinked installs point elsewhere). */
function realExe(exe: string): string {
  try {
    return realpathSync(exe);
  } catch {
    return exe;
  }
}

function replaceBinary(exe: string, bin: Uint8Array, isWindows: boolean): void {
  const real = realExe(exe);
  if (!basename(real).includes("jspace")) {
    fail(`异常: 目标 ${real} 不是 jspace 二进制，拒绝覆盖`);
  }
  const dir = dirname(real);
  const tmp = join(dir, `.jspace-update-${process.pid}.tmp`);
  try {
    writeFileSync(tmp, bin);
    if (!isWindows) chmodSync(tmp, 0o755);
    if (isWindows) {
      // A running .exe cannot be overwritten: rename current -> .old, write the
      // new one, and remove the .old (if still locked it is cleaned next run).
      renameSync(real, real + ".old");
      renameSync(tmp, real);
      try {
        unlinkSync(real + ".old");
      } catch {
        /* left for next startup cleanup */
      }
    } else {
      // Unix allows replacing a running binary: rename is atomic.
      renameSync(tmp, real);
    }
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Remove a stale `<exe>.old` left by an interrupted Windows self-replace. */
function cleanupOld(exe: string): void {
  const old = realExe(exe) + ".old";
  try {
    if (existsSync(old)) unlinkSync(old);
  } catch {
    /* ignore */
  }
}

export async function cmdUpdate(check: boolean, targetVersion?: string): Promise<void> {
  cleanupOld(process.execPath);
  const current = VERSION;
  if (isDevVersion(current)) {
    console.log(`当前为开发版（${current}），跳过自动更新。发布版可用 jspace update 升级。`);
    return;
  }
  const asset = assetFor(process.platform, process.arch);
  const base = process.env.JSPACE_BASE_URL || DEFAULT_BASE;
  const target = await resolveTargetVersion(targetVersion || process.env.JSPACE_VERSION, latestTag);
  const upToDate = compareVersions(current, target) >= 0;
  const show = (v: string): string => v.replace(/^v/, "");

  if (check) {
    console.log(`当前版本: ${show(current)}`);
    console.log(`最新版本: ${show(target)}`);
    console.log(upToDate ? "已是最新" : `可更新到 ${show(target)}`);
    return;
  }
  if (upToDate && !targetVersion) {
    console.log(`已是最新版本: ${show(current)}`);
    return;
  }

  console.log(`正在更新 jspace ${show(current)} -> ${show(target)} ...`);
  const url = `${base}/download/${target}/${asset}`;
  const r = await fetchOrFail(url, "下载");
  if (!r.ok) fail(`下载失败（HTTP ${r.status}）: ${asset}`);
  const bin = new Uint8Array(await r.arrayBuffer());
  if (bin.length === 0) fail(`下载内容为空: ${asset}`);

  const ckResp = await fetchOrFail(`${base}/download/${target}/checksums.txt`, "下载 checksums.txt");
  if (!ckResp.ok) fail(`下载 checksums.txt 失败（HTTP ${ckResp.status}）`);
  const expect = expectedHash(await ckResp.text(), asset);
  if (!expect) fail(`checksums.txt 中未找到产物 ${asset} 的校验和（发布不完整？）`);
  const actual = sha256Of(bin);
  if (actual !== expect) fail(`SHA-256 校验不匹配。期望 ${expect}，实际 ${actual}`);

  replaceBinary(process.execPath, bin, process.platform === "win32");
  console.log(`已更新到 jspace ${target}。新终端生效，jspace --version 确认。`);
}
