# jspace update 自更新命令

## Goal

CLI 内置自更新：`jspace update` 从 GitHub Releases 检测并升级到最新版本——**不依赖重跑安装脚本**。同时修复内置版本号过期问题（当前 `cli/args.ts:8` 硬编码 `"1.0.0"`，而实际发布已是 v1.0.1），让 `jspace --version` 报告真实发布版本，为版本化承诺（R7）落地。

## 已确认事实（代码/实测）

- **编译二进制内 `fetch` 可用**（已实测：从编译产物调 GitHub API 返回 `latest tag_name: v1.0.1`）→ update 联网无运行时障碍。
- **`bun build --compile --define` 不生效**（已实测：两种写法都保留占位符）→ 版本注入必须用**构建时生成 `version.generated.ts`**（与现有 `assets.generated.ts` 的 gen-assets 模式一致）。
- 版本号现状：`cli/args.ts:8` `VERSION="1.0.0"` + `cli/init.ts:10` `VERSION="1.0.0"`（重复定义），`jspace --version` → `jspace 1.0.0`（**过期**，实际 v1.0.1）。
- CLI 命令注册：`cli/args.ts:20` `TOP_CHOICES`，main.ts 按 `action` 分发；新增命令需改 args.ts（choices/help/parser）+ cmds.ts（实现）+ main.ts 若需。
- Release 资产：`latest/download/jspace-<os>-<arch>[.exe]` + `checksums.txt`（v1.0.1 已验证全绿）；`JSPACE_BASE_URL`/`JSPACE_VERSION` 环境变量覆盖已存在于 install 脚本。
- `process.platform`/`process.arch`（bun 运行时）可映射到资产名，无需构建期嵌入架构。
- bun 内置 `node:crypto`（sha256）→ 校验可在 CLI 内实现。

## Requirements

- R1 **构建时版本注入**：新增 `cli/version.generated.ts`（提交占位 `"0.0.0-dev"`），由构建脚本从 `JSPACE_BUILD_VERSION` 环境变量（CI 由 tag 注入）或 `git describe --tags` 回退生成；`cli/args.ts`/`cli/init.ts` 改为 import 该文件（去重为单一版本源）；build/build:all/CI 全链路接入。
- R2 `jspace update` 命令：检测 latest 版本 vs 当前版本 → 有新版则下载匹配资产 + SHA-256 校验 → 自替换 → 报告新版本。
- R3 `jspace update --check`：只报告「当前 / 最新」不动作；`jspace update --version <tag>` 钉版本安装（回滚用）；`-h`。
- R4 **自替换**：Unix `mv` 覆盖当前二进制（运行中可覆盖，先解析符号链接）；Windows 运行中 exe 不可覆盖 → **rename 当前 exe → `.old` → 写入新 exe → 下次启动清理 `.old`**。
- R5 安全：仅显式 `update` 才联网（无后台 phone-home）；校验不匹配/下载失败 → 明确报错 exit≠0、不替换、无残留；开发版（`0.0.0-dev`）跳过并提示。
- R6 可测试性：`JSPACE_BASE_URL`/`JSPACE_VERSION` 环境变量覆盖（与 install 脚本一致），支持本地 mock release 做 e2e。
- R7 验证闭环：本地 mock e2e（v1.0.0 二进制 + mock v2.0.0）→ 真实验证（实现后发 v1.0.2，用 v1.0.1 二进制真跑一次 `jspace update` 升级到 v1.0.2）。

## Acceptance Criteria

- [ ] `jspace --version` 报告真实发布版本（发 v1.0.2 后 → `jspace 1.0.2`，不再过期）。
- [ ] 本地 mock e2e：构建 v1.0.0 测试二进制 + 本地 mock 服务供 v2.0.0 资产 → `jspace update` 替换成功、`--version` 变 v2.0.0、校验拦截（篡改 → 拒绝 exit≠0 无残留）。
- [ ] `update --check` 只报告不动作；`update --version <tag>` 钉版本。
- [ ] 开发版二进制 `update` 跳过并提示（不尝试自更新）。
- [ ] 网络失败/无 release/校验不匹配 → 明确报错 exit≠0，不破坏现有二进制。
- [ ] 真实闭环：发 v1.0.2 后用 v1.0.1 二进制真跑 `jspace update` → 升级到 v1.0.2 且 `--version` 确认。
- [ ] `bunx tsc --noEmit` / `bun run build` 通过；现有 `verify-install` 三平台仍全绿（回归）。

## Out of Scope

- Windows 自替换的**真机升级验证**（需 Windows + 两个真实 release）——用 CI 或后续 release 验证，本地仅验证 rename 逻辑。
- Homebrew/choco/scoop 的 update 对接。
- 自动检查更新/后台 phone-home（不做）。
- 修改 install 脚本本身（其 `--version` 已存在，`latest` 语义不变）。

## Key Decisions

- **版本源**：构建时生成 `version.generated.ts`（env `JSPACE_BUILD_VERSION` > `git describe --tags` > 占位），CI tag 构建注入 `github.ref_name`；解决 `--define` 不生效问题。
- **资产映射**：运行时 `process.platform`/`process.arch` → 资产名（无需构建期嵌架构）。
- **Windows 替换**：rename→`.old`→写新→下次启动清理（标准单文件更新器）。
- **联网**：仅显式 `update` 命令；fetch GitHub API `releases/latest` 取 tag；`JSPACE_BASE_URL` 覆盖下载源。

## Risks / Deferred

- Windows 自替换真机验证延后（本机无 Windows；CI 无第二 release 无法测真实升级）——rename 机制是标准做法，风险低。
- GitHub API 未认证 60 次/时额度：update 是显式低频命令，够用；失败降级为「重试/手动 install.sh」提示。
- 首次接入版本注入后，之前发布 v1.0.0/v1.0.1 二进制仍报告旧版——只有 v1.0.2 起才一致；已在 README/发布说明注明。
