# jspace update 自更新 — 技术设计

## 架构与边界

新增一块 CLI 能力 + 一处构建管线改动：

| 层 | 改动 |
|---|---|
| 版本源 | 新增 `cli/version.generated.ts`（占位提交，构建时生成）；`cli/args.ts`/`cli/init.ts` 去重为单一 import |
| 构建管线 | `scripts/gen-version.ts` 生成版本文件；build/build:all/CI 全链路接入 |
| CLI 命令 | `cli/args.ts` 注册 `update` + `cli/update.ts` 实现 |
| 运行时 | bun `fetch`（已有）+ `node:crypto` sha256 + `process.execPath` 自替换 |

数据流（`jspace update`）：

```
当前版本 = VERSION(version.generated.ts)
资产名   = jspace-<os>-<arch>[.exe]  (process.platform/arch)
目标版本 = --version <tag> | JSPACE_VERSION | API releases/latest tag_name
  --check → 打印 当前/最新，退出
比较 semver：无新版 → "已是最新 vX"，退出 0
下载     = $BASE/download/$VER/$ASSET  +  checksums.txt  （BASE=JSPACE_BASE_URL|github）
sha256 校验：不匹配 → 删临时、报错 exit≠0，不动现有二进制
自替换：
  Unix    → 解析 execPath 符号链接 → 写临时 → chmod +x → mv 覆盖
  Windows → rename execPath → execPath.old → 写新 execPath → 尝试删 .old（失败则留待下次启动清理）
报告新版本；提示 PATH 无需变更
```

## 关键决策

### 1. 版本注入（build-time generated file）
- `cli/version.generated.ts`：`export const VERSION = "0.0.0-dev";`（提交，保 tsc 可过）。
- `scripts/gen-version.ts`：写该文件，值取 `process.env.JSPACE_BUILD_VERSION || git describe --tags --abbrev=0 2>/dev/null || "0.0.0-dev"`；对 `v` 前缀归一化（保留原样，比较时剥离）。
- package.json：`build` = `bun run scripts/gen-version.ts && bun run scripts/gen-assets.ts && bun build --compile ...`；`build:all` 同加 gen-version；`build:win`/`build:linux` 同。
- CI build.yml：tag 触发时 `env: JSPACE_BUILD_VERSION: ${{ github.ref_name }}`（workflow_dispatch 走 git describe 回退）。
- `cli/args.ts:8` + `cli/init.ts:10`：删硬编码，`import { VERSION } from "./version.generated.ts"`（单源）。

### 2. 资产映射（运行时）
- `process.platform`：`darwin`→macos、`linux`→linux、`win32`→windows。
- `process.arch`：`arm64`→arm64、`x64`→x64。
- 资产名 `jspace-<os>-<arch>`，windows 加 `.exe`。
- 未知 → 报错「不支持平台/架构」。

### 3. semver 比较
- 纯函数 `compareVersions(a, b)`：剥离 `v` 前缀，按 `.` split，major/minor/patch 数值比较；缺位补 0；`0.0.0-dev` 视为最低。放 `cli/update.ts`（或 `cli/version.ts`），纯函数便于单测。

### 4. 网络与校验
- 取最新：`fetch("https://api.github.com/repos/jionpz/jspace/releases/latest", { headers: { Accept: "application/vnd.github+json" } })` → `tag_name`。失败 → 报错 exit≠0（提示重试/手动 install.sh）。
- 下载：`fetch("$BASE/download/$VER/$ASSET")` → 临时文件；checksums.txt 同源下载。
- sha256：`crypto.createHash("sha256")` 计算；从 checksums.txt `awk` 等价逻辑（按资产名列匹配、兼容 `*` 前缀、转小写）取期望值比对。
- 无匹配/不匹配 → 删临时、报错 exit≠0、现有二进制不动。

### 5. 自替换
- **Unix**：`realpath(execPath)`（解析符号链接）→ 临时文件 `chmod 755` → `renameSync(tmp, real)`（同目录原子替换）。运行中进程可覆盖自身文件（Unix 允许）。
- **Windows**：`renameSync(execPath, execPath + ".old")`（Windows 允许重命名运行中文件）→ `writeFileSync(execPath, newBin)` → `try unlink(execPath + ".old")`（若仍被锁则跳过）。**下次启动清理**：`cli/main.ts` 顶部或 update 命令内，若存在 `<execPath>.old` 且非自身 → 尝试 unlink。
- 覆盖前校验当前 execPath 的 basename 含 `jspace`（防止误更新其他文件？——execPath 即运行中的 jspace，天然安全，仅防御性检查）。

### 6. 命令形态（args.ts）
- `TOP_CHOICES` 加 `update`；`UPDATE_CHOICES = ["update"]`（或作为带 flag 的顶层子命令）。
- 解析：`jspace update [--check] [--version <tag>]`。更新 TOP_HELP/usage。
- `main.ts`：`case "update"` → 调 `cli/update.ts` 的 run。
- 开发版（VERSION 含 `-dev` 或等于 `0.0.0-dev`）：`update` 打印「开发版，跳过自动更新」exit 0；`--check` 也跳过（避免误导）。

### 7. 测试性
- 环境变量：`JSPACE_BASE_URL`（下载源覆盖）、`JSPACE_VERSION`（目标版本覆盖）。
- 本地 mock：HTTP 服务供 `download/<ver>/<asset>` + `download/<ver>/checksums.txt`；用 `JSPACE_BUILD_VERSION=1.0.0` 构建"旧"二进制、mock 供 v2.0.0 资产 → 真跑 update 验证替换。
- 注意：mock 下 latest 版本解析走 `JSPACE_VERSION`（不走 API），API 失败不阻塞 mock 路径。

## 兼容性 / 迁移

- 不改变 install.sh/ps1 语义（`latest` 下载仍可用）；`update` 是新增命令，不动现有命令。
- 之前 release（v1.0.0/v1.0.1）二进制报告旧版 `1.0.0`——已知、接受；v1.0.2 起版本注入生效。
- `jspace --version` 输出格式不变（`jspace <version>`），install 脚本自检 `^jspace ` 兼容。

## 运维 / 回滚

- update 前不改 PATH/rc（原地替换二进制）→ 卸载/回滚不受影响。
- 回滚：`jspace update --version v1.0.1` 可降级（钉版本）。
- 若更新出错（校验失败/网络失败），现有二进制保持不动（先下载校验后替换的顺序保证）。

## 风险

- GitHub API 额度（60/h 未认证）：低频显式命令，够用；失败提示重试。
- Windows 真机自替换延后验证（rename 是标准机制，风险低；CI 无第二 release 无法测真实升级，可用后续 v1.0.3 验证）。
- fetch 在极老 glibc/musl 环境的 TLS：与 install 脚本同源（bun 自带 TLS），不做额外处理。
