// cli/update.ts — `jspace update`: self-update from GitHub Releases.
// Only contacts the network when explicitly invoked (no background phone-home).
import { spawnSync } from "node:child_process";
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
import { sha256OfBytes } from "../core/shared/hash.ts";
import { CliError, fail } from "../core/shared/errors.ts";

const REPO = "jionpz/jspace";
const DEFAULT_BASE = `https://github.com/${REPO}/releases`;
/** Self-check spawn budget: a hung new binary must not hang `jspace update`. */
const PROBE_TIMEOUT_MS = 20_000;

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

/** Release tags are `vX.Y.Z` only. Anything else (prerelease `v1.2.3-beta.1`,
 *  moving aliases, garbage) is rejected loudly instead of being turned into a
 *  404 download or a silently mis-compared version: jspace publishes no
 *  prerelease channel, so accepting one would install an asset set that may not
 *  exist. A bare `1.2.3` is normalized to the real tag form. */
export function normalizeReleaseTag(tag: string): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) {
    fail(
      `不支持的版本号 ${JSON.stringify(tag)}：jspace update 只接受正式发布 tag vX.Y.Z（如 v1.0.14），` +
        `不支持预发布/后缀版本（v1.2.3-beta.1）。用 jspace update --check 查看最新正式版`,
    );
  }
  return `v${m[1]}.${m[2]}.${m[3]}`;
}

/** Minimal response-header view (Response.headers satisfies it; tests pass a stub). */
export interface HeaderLike {
  get(name: string): string | null;
}

/** User-facing message for a failed GitHub API release lookup. 403/429 are the
 *  unauthenticated rate limit in practice — the actionable escape hatch is to
 *  skip the API entirely with an explicit tag (`--version` downloads straight
 *  from the releases CDN). */
export function githubApiFailure(status: number, headers: HeaderLike | null): string {
  if (status === 403 || status === 429) {
    const remaining = headers?.get("x-ratelimit-remaining") ?? null;
    const reset = headers?.get("x-ratelimit-reset") ?? null;
    const limited = status === 429 || remaining === "0";
    const when = limited && reset !== null && /^\d+$/.test(reset)
      ? `（配额重置时间 ${new Date(Number(reset) * 1000).toISOString()}）`
      : "";
    return limited
      ? `获取最新版本失败（HTTP ${status}）：GitHub API 速率限制${when}。` +
          `改用 jspace update --version vX.Y.Z 指定版本可绕过 API 直连下载，或稍后重试`
      : `获取最新版本失败（HTTP ${status}）：GitHub API 拒绝访问（企业代理/网络策略拦截？）。` +
          `改用 jspace update --version vX.Y.Z 指定版本可绕过 API 直连下载`;
  }
  return `获取最新版本失败（HTTP ${status}）。请检查网络，或手动重跑安装脚本`;
}

/** Result of running the freshly downloaded binary once, before it replaces the
 *  live one. `error` is set when the process could not be executed at all. */
export interface ProbeResult {
  exit: number | null;
  output: string;
  error?: string;
}

export type ProbeFn = (binPath: string) => ProbeResult;

function firstLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
}

/** Grade a probe run: null = the new binary is usable, otherwise the reason. */
export function probeVerdict(r: ProbeResult, target: string): string | null {
  const head = firstLine(r.output);
  if (r.error !== undefined) return `新二进制无法执行（${r.error}）`;
  if (r.exit !== 0) {
    return `新二进制 --version 退出码 ${r.exit === null ? "未知" : r.exit}${head === "" ? "" : `；输出: ${head}`}`;
  }
  const want = target.replace(/^v/, "");
  if (!r.output.includes(want)) {
    return `新二进制 --version 未输出目标版本 ${want}（实际: ${head === "" ? "空输出" : head}）`;
  }
  return null;
}

/** Full user-facing text for a failed pre-replace self-check. The Windows hint
 *  is not generic advice: the published windows-x64 asset is a non-baseline bun
 *  target (needs AVX2), so an AVX-less machine sees exactly this failure. */
export function probeFailureMessage(detail: string, platform: string, asset: string): string {
  const hint =
    platform === "win32"
      ? "Windows x64 发布产物为非 baseline 构建（需要 AVX2 指令集）：不支持 AVX2 的 CPU 上会直接崩溃。" +
        "请在支持 AVX2 的机器上更新，或本地 `bun run build:all` 产出 baseline 二进制后手动替换（见 docs/PLATFORMS.md）"
      : "常见原因：CPU 指令集/glibc 不兼容，或下载产物损坏。平台边界见 docs/PLATFORMS.md；可重跑一键安装脚本";
  return `${detail}。已丢弃下载的 ${asset}，现有 jspace 未被替换（当前版本仍可用）。${hint}`;
}

/** Turn a filesystem failure during the binary swap into an actionable business
 *  error — a raw EACCES stack tells the user nothing about how to fix it. */
export function replaceErrorMessage(err: unknown, target: string): string {
  const code =
    typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return (
      `无法写入 ${target}（${code}）：安装目录不可写，现有二进制未被改动。` +
      `请用有权限的账号重试（Windows: 以管理员身份打开终端；macOS/Linux: 确认 ${dirname(target)} 属当前用户），` +
      `或重跑一键安装脚本装到用户目录（~/.local/bin）`
    );
  }
  if (code === "ENOSPC") {
    return `无法写入 ${target}（ENOSPC）：磁盘空间不足，现有二进制未被改动。清理空间后重试`;
  }
  if (code === "EBUSY" || code === "ETXTBSY") {
    return `无法替换 ${target}（${code}）：文件被占用。请关闭正在运行的 jspace 进程后重试`;
  }
  return `替换 ${target} 失败: ${msg}。请重跑一键安装脚本修复（jspace --version 可确认当前二进制是否仍可用）`;
}

/** fetch that turns network-level failures into a clear user-facing error. */
async function fetchOrFail(
  f: typeof fetch,
  url: string,
  what: string,
  headers?: Record<string, string>,
): Promise<Response> {
  try {
    return await f(url, headers ? { headers } : undefined);
  } catch {
    fail(`${what}失败（网络错误）。请检查网络后重试，或手动重跑安装脚本`);
  }
}

async function latestTag(f: typeof fetch): Promise<string> {
  const r = await fetchOrFail(
    f,
    `https://api.github.com/repos/${REPO}/releases/latest`,
    "获取最新版本",
    { Accept: "application/vnd.github+json" },
  );
  if (!r.ok) fail(githubApiFailure(r.status, r.headers ?? null));
  const j = (await r.json()) as { tag_name?: string };
  if (!j.tag_name) fail("GitHub 未返回版本号");
  return j.tag_name;
}

/** 把请求的版本解析成具体 tag。`latest` 是 GitHub 别名，不能直接拼进
 *  /download/<tag>（会被当字面 tag 返回 404），必须先解析成真实 tag。
 *  两条路径都过 normalizeReleaseTag：预发布 / 畸形 tag 在下载前 fail loud。 */
export async function resolveTargetVersion(
  requested: string | undefined,
  resolveLatest: () => Promise<string>,
): Promise<string> {
  const raw = requested && requested !== "latest" ? requested : await resolveLatest();
  return normalizeReleaseTag(raw);
}

/** Resolve symlinks so we replace the real binary (symlinked installs point elsewhere). */
function realExe(exe: string): string {
  try {
    return realpathSync(exe);
  } catch {
    return exe;
  }
}

/** Run the downloaded binary once (`--version`) with a hard timeout. */
function defaultProbe(binPath: string): ProbeResult {
  const r = spawnSync(binPath, ["--version"], {
    encoding: "utf-8",
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) return { exit: null, output, error: r.error.message };
  if (r.signal) {
    // SIGILL is what an AVX-requiring build does on an AVX-less CPU; SIGTERM
    // here is our own timeout kill. Either way the binary is unusable.
    return { exit: null, output, error: `被信号 ${r.signal} 终止（指令集不兼容通常表现为 SIGILL）` };
  }
  return { exit: r.status, output };
}

interface InstallOpts {
  probe: ProbeFn;
  target: string;
  asset: string;
  platform: string;
}

/** Stage, self-check, then swap in the downloaded binary. The staging file sits
 *  next to the target (not $TMPDIR): the install dir is executable by definition
 *  while /tmp is often mounted noexec, and a sibling keeps the final rename on
 *  one filesystem. Nothing touches the live binary until the probe passes. */
function installBinary(exe: string, bin: Uint8Array, isWindows: boolean, opts: InstallOpts): void {
  const real = realExe(exe);
  if (!basename(real).includes("jspace")) {
    fail(`异常: 目标 ${real} 不是 jspace 二进制，拒绝覆盖`);
  }
  const dir = dirname(real);
  const tmp = join(dir, `.jspace-update-${process.pid}.tmp${isWindows ? ".exe" : ""}`);
  const old = `${real}.old`;
  let movedAside = false;
  try {
    writeFileSync(tmp, bin);
    if (!isWindows) chmodSync(tmp, 0o755);
    const detail = probeVerdict(opts.probe(tmp), opts.target);
    if (detail !== null) fail(probeFailureMessage(detail, opts.platform, opts.asset));
    if (isWindows) {
      // A running .exe cannot be overwritten: rename current -> .old, write the
      // new one, and remove the .old (if still locked it is cleaned next run).
      renameSync(real, old);
      movedAside = true;
      renameSync(tmp, real);
      movedAside = false;
      try {
        unlinkSync(old);
      } catch {
        /* left for next startup cleanup */
      }
    } else {
      // Unix allows replacing a running binary: rename is atomic.
      renameSync(tmp, real);
    }
  } catch (e) {
    // A half-done Windows swap must not leave the user without a binary.
    if (movedAside) {
      try {
        renameSync(old, real);
      } catch {
        /* ignore: reported below, .old still holds the previous binary */
      }
    }
    if (e instanceof CliError) throw e;
    fail(replaceErrorMessage(e, real));
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

/** Injected seams for `cmdUpdate`. Production passes nothing; tests substitute
 *  the running binary, the network and the self-check probe so no test ever
 *  touches the real install. */
export interface UpdateDeps {
  execPath?: string;
  platform?: string;
  arch?: string;
  version?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  probe?: ProbeFn;
  log?: (line: string) => void;
}

export async function cmdUpdate(check: boolean, targetVersion?: string, deps: UpdateDeps = {}): Promise<void> {
  const execPath = deps.execPath ?? process.execPath;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const env = deps.env ?? process.env;
  const f = deps.fetchImpl ?? fetch;
  const probe = deps.probe ?? defaultProbe;
  const log = deps.log ?? ((line: string) => console.log(line));

  cleanupOld(execPath);
  const current = deps.version ?? VERSION;
  if (isDevVersion(current)) {
    log(`当前为开发版（${current}），跳过自动更新。发布版可用 jspace update 升级。`);
    return;
  }
  const asset = assetFor(platform, arch);
  // Setting JSPACE_BASE_URL makes that source the single trust root — both the
  // binary and checksums.txt are fetched from it (SHA-256 only defends against
  // transport/tampering, not the source itself). Documented in PLATFORMS.md.
  const base = env.JSPACE_BASE_URL || DEFAULT_BASE;
  // Mirror install.sh: the binary and checksums.txt share one trust root, so
  // it must be https — http lets a same-origin attacker swap both together.
  // Local e2e over http opts in explicitly with JSPACE_ALLOW_INSECURE=1.
  if (/^https:\/\//i.test(base)) {
    /* ok */
  } else if (/^http:\/\//i.test(base) && env.JSPACE_ALLOW_INSECURE === "1") {
    /* explicit local-e2e opt-in */
  } else {
    fail(`JSPACE_BASE_URL 必须为 https（当前 ${base}）；本地 e2e 需 JSPACE_ALLOW_INSECURE=1 放行`);
  }
  const target = await resolveTargetVersion(targetVersion || env.JSPACE_VERSION, () => latestTag(f));
  const upToDate = compareVersions(current, target) >= 0;
  const show = (v: string): string => v.replace(/^v/, "");

  if (check) {
    log(`当前版本: ${show(current)}`);
    log(`最新版本: ${show(target)}`);
    log(upToDate ? "已是最新" : `可更新到 ${show(target)}`);
    return;
  }
  if (upToDate && !targetVersion) {
    log(`已是最新版本: ${show(current)}`);
    return;
  }

  log(`正在更新 jspace ${show(current)} -> ${show(target)} ...`);
  const url = `${base}/download/${target}/${asset}`;
  const r = await fetchOrFail(f, url, "下载");
  if (!r.ok) fail(`下载失败（HTTP ${r.status}）: ${asset}`);
  const bin = new Uint8Array(await r.arrayBuffer());
  if (bin.length === 0) fail(`下载内容为空: ${asset}`);

  const ckResp = await fetchOrFail(f, `${base}/download/${target}/checksums.txt`, "下载 checksums.txt");
  if (!ckResp.ok) fail(`下载 checksums.txt 失败（HTTP ${ckResp.status}）`);
  const expect = expectedHash(await ckResp.text(), asset);
  if (!expect) fail(`checksums.txt 中未找到产物 ${asset} 的校验和（发布不完整？）`);
  const actual = sha256OfBytes(bin);
  if (actual !== expect) fail(`SHA-256 校验不匹配。期望 ${expect}，实际 ${actual}`);

  // A matching checksum only proves the bytes are the ones we published — not
  // that they run here (AVX-less CPU, wrong arch asset). Prove it first.
  installBinary(execPath, bin, platform === "win32", { probe, target, asset, platform });
  log(`已更新到 jspace ${target}。新终端生效，jspace --version 确认。`);
}
