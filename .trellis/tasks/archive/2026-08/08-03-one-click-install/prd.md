# 一键脚本安装（M5 分发子项）

## Goal

让 **owner 在 macOS / Linux / Windows 各机器**用一行命令安装 JSpace CLI：自动识别平台与架构 → 从 GitHub Releases 下载匹配的编译二进制 → SHA-256 校验 → 装到用户目录并自动进 PATH（macOS/Linux 自动写 shell rc）→ 验证可用；同一文件提供卸载入口。对应 GOAL.md M5 分发（R7）里程碑的「打包安装」子项。

> 范围收敛：v1.0.0 首发为 **owner 内部**可用；对外公开分发（面向"任何人"）依赖**模板去个人化**，已拆为后续任务 `08-03-template-depersonalize` 紧随执行。

## 已确认事实（来自代码/CI/文档，已复核）

- 仓库 `github.com/jionpz/jspace`；`build.yml` 在 6 平台（3 OS × x64/arm64）编译独立二进制，打 `v*` tag 时经 softprops/action-gh-release 发布到 Releases；产物名：`jspace-{linux,macos}-{x64,arm64}`、`jspace-windows-{x64,arm64}.exe`。
- 二进制为单文件编译产物，无需解压；`bin/` 已 gitignore 不入库。
- `jspace --version` 输出 `jspace 1.0.0`（`cli/args.ts:8` `VERSION`）。
- **已存在 `v0.1.0-test` tag（commit 6fa953a）但无对应 release**（`gh release list` 为空）——不可复用做首发。
- **CI 可用**：`gh run` 显示 2026-08-03T01:00Z build 已 `completed success`（6 平台）；`docs/PLATFORMS.md:29` 的「CI 计费锁」表述已过时，须修正。
- CI 发布作业**不生成 checksums**（本任务补齐）。
- CLI 顶层命令仅 init/doctor/domain/resource/filehub/inbox/cron（`cli/args.ts:20`）——**没有 `uninstall` 子命令**，文档不得出现 `jspace uninstall`。
- `docs/PLATFORMS.md` 已有三平台矩阵；AGENTS.md 约定版本化承诺推迟到 R7，未上线无兼容性负担。

## Requirements

- R1 `install/install.sh`（macOS/Linux，POSIX sh）：`uname` 探测（含 Rosetta、glibc/musl 边界）→ 产物名映射 → **两段式下载**（`curl -fsSL -o` 临时文件，非裸管道）→ SHA-256 校验（**平台感知**：Darwin `shasum -a 256` / Linux `sha256sum`，按资产名列取哈希 token 比对）→ 装到 `BIN_DIR`（默认 `$HOME/.local/bin`，`$XDG_BIN_HOME` 可覆盖，全链路一致）→ **绝对路径自检** `"$BIN_DIR/jspace" --version` → 自动写 shell rc（标记块，幂等，zsh/bash/fish，bash 同时写 `.bash_profile`，符号链接 rc 安全处理）→ `--uninstall` 分支。
- R2 `install/install.ps1`（Windows，纯 PowerShell）：等价流程；装到 `%LOCALAPPDATA%\jspace\bin`；经 .NET API 写**用户作用域** PATH（展开绝对路径、去重、大小写不敏感）；`-Uninstall` 参数 + `$env:JSPACE_UNINSTALL` 环境变量双触发；`Get-FileHash` 结果转小写比对。
- R3 校验：release 附带 `checksums.txt`（CI release 作业生成）；校验不匹配或缺失 → 删半成品、报错 exit≠0。威胁模型如实声明：SHA-256 防**传输损坏**，不防发布源被攻破。
- R4 卸载：`install.sh --uninstall` / `install.ps1 -Uninstall`（或 `$env:JSPACE_UNINSTALL`）；**只删标记块**（外科手术式），**不整文件恢复备份**——仅当「当前 rc == 备份内容 + 标记块」（安装后无外部编辑）才恢复备份；完成后删除 `.jspace-bak`；Windows 从 User PATH 按条目精确删除安装目录；移除二进制，仅当目录为空才删目录。
- R5 文档：README「快速开始」三平台一行安装（**两段式**命令）+ 卸载（Windows 落盘执行）+ 新终端生效说明；`docs/PLATFORMS.md` 追加安装验证矩阵并修正计费锁表述。
- R6 首次发布：tag **v1.0.0**（正式 release，non-draft/non-prerelease）→ 验证 `latest/download/<asset>` 真实可用 → CI 新增 `verify-install` 作业**启用**（三平台真机一键安装断言）。

## Acceptance Criteria

- [ ] 三平台各自一行命令完成全新安装；`jspace --version` 正确输出版本号（macOS 本机 e2e + CI verify-install 三平台闭环）。
- [ ] 错误路径可感知：平台/架构无产物（含 musl 明确报错）、下载失败（两段式使 exit 非 0）、校验不匹配 → 明确报错、exit≠0、无残留半成品。
- [ ] 幂等：重复安装覆盖旧二进制、不重复追加 PATH/rc 标记块。
- [ ] 卸载无残留：二进制、安装目录、rc 标记块、Windows PATH 条目全部回滚；`jspace` 不可再被找到；**「安装后改 rc 再卸载」用例不丢用户编辑**。
- [ ] 校验真实执行：篡改 checksums、或下载后校验前给二进制追加字节 → 安装拒绝。
- [ ] Windows 卸载经落盘执行可达（`-File install.ps1 -Uninstall` 端到端用例）。
- [ ] 首次发布链路可用：`v1.0.0` release 存在、checksums.txt 随发布、`latest/download/<asset>` 返回 200。

## Key Decisions

- PATH 策略（owner 拍板）：macOS/Linux 装 `BIN_DIR`（默认 `$HOME/.local/bin`，`$XDG_BIN_HOME` 可覆盖），目录不在 PATH 时**自动追加 shell rc**（标记块、幂等、编辑前备份、卸载回滚；未知 shell 只打印指令）；Windows 固定 `%LOCALAPPDATA%\jspace\bin` + .NET 用户 PATH。
- 版本解析不用 GitHub API/jq，用 `releases/latest/download/<asset>`；脚本支持 `JSPACE_VERSION`/`JSPACE_BASE_URL` 环境变量覆盖（便于钉版本与本地 e2e）。
- 安装命令为**两段式** `curl -fsSL <url> -o /tmp/jspace-install.sh && bash /tmp/jspace-install.sh`——与全局治理红线「不直接执行 curl|bash」自洽，且下载失败不静默。
- Windows 卸载双触发：`-Uninstall` 参数（落盘执行）+ `$env:JSPACE_UNINSTALL`（`irm|iex` 可达）。
- 首发 tag 定为 **v1.0.0**（匹配 `cli/args.ts:8` VERSION），正式 release；推送前按红线经 owner 确认。
- **首发排序（记录在案）**：v1.0.0 为 **owner 内部**使用（不对外宣传）；模板去个人化（`08-03-template-depersonalize`）完成后才面向公开分发——与 GOAL.md「公开分发前先去个人化」一致。

## Out of Scope

- `jspace self-update` 命令（CLI 内置升级）——后续任务。
- Homebrew tap / choco / scoop 等包管理器分发。
- 全局安装（/usr/local/bin 等需 sudo 位置）；默认用户级安装。
- 模板去个人化（已拆 `08-03-template-depersonalize`，紧随执行）。
- musl 构建产物（v1 明确 glibc-only 并报错）；ARM Windows/Linux 产物存在但 v1 安装覆盖以 CI 发布为准。

## Risks / Deferred

- 首个 `v1.0.0` tag 推送是外部可见动作，执行前按治理红线经 owner 确认；推前 `git tag -l 'v*'` 核对 semver。
- checksums.txt 与二进制同源：能改发布源者同样能改 checksums——威胁模型如实声明（防传输损坏），真实信任根 = 仓库写权限。
- 跨平台真机验证依赖 CI verify-install 作业（计费锁前提已推翻，正常启用）；若 CI 意外不可用，降级为 macOS 本机 e2e + `JSPACE_BASE_URL` 本地 HTTP 模拟 + 语法检查，并如实标注 Linux/Windows 验证延期。
- 未签名 bun `.exe` 首发可能触发 SmartScreen/MOTW 拦截：README 注明首次运行绕过方法；verify-install Windows 作业确认 `--version` 不被弹窗阻塞。
