# JSpace

本地工作控制平面（JWorkspace）的**开发仓库**。日常使用的 JWorkspace 由 CLI 生成到其他目录；本仓库只负责开发、验证和发布工作台模板。

## 两个概念：JSpace 与 JWorkspace

- **JSpace** —— 本仓库，设计/开发层。只维护 CLI（`cli/` TypeScript/bun 源码，`bun run build` 产出 `bin/jspace` 编译二进制）、模板（`templates/workbench/`）、skills 的源码；不安装、不作为日常使用环境，只用它生成和校验 JWorkspace。
- **JWorkspace** —— 实际使用的工作目录，由 `jspace init --dir <目录>` 生成（编译二进制在 PATH；源码检出在仓库内 `bun run cli/main.ts`），**目录可由每个用户各自配置**（如 `~/jworkspace`、`~/ws` 等），不同用户互不干扰。产物含 `.jspace/hub.json`（注册表）、`AGENTS.md`（路由）、`workspace/<domain>/`、`.jspace/skills/`（官方打包技能；根 `skills/` 留给用户自建）。日常工作和 AI 会话从这里开始。

> 术语：下文「工作台 / workbench」即 JWorkspace 的正式命名。

## 目录约定

- `.trellis/` —— 本开发仓库使用的 **Trellis 开发工作流框架**（vendored，Claude Code 等 harness 的任务规划/执行/检查机制），**不是 jspace 运行时组件**，不影响 CLI 产物或 JWorkspace。
- `templates/workbench/` —— 工作台模板源（CLI 生成 JWorkspace 的种子资产，含各 harness 接线 seed `.claude/` `.grok/` `.opencode/` `.cursor/`）。
- `skills/` —— 官方技能源码（7 个 workbench 技能：jspace-use / asset-ingest / memory-recall / memory-writeback / workbench-retro / weekly-report / memory-consolidate；另有 global 段的 `harness-config` 机器级治理技能，manifest 合计 8 个），经 `scripts/gen-assets.ts` 嵌入二进制。
- `core/` `application/` `adapters/` `scripts/` —— CLI 分层源码：契约 / 领域用例 / harness·scheduler·process·fs 适配 / 生成与校验脚本（gen-assets / check-skills / check-harness-consistency / check-manifest-integrity）。`adapters/harness/capabilities.yaml` 是 harness 支持集的单一事实源。

## 快速开始

### 一键安装（推荐，macOS / Linux / Windows）

macOS / Linux（两段式，避免 `curl|bash` 静默吞下载失败）：

```bash
curl -fsSL https://raw.githubusercontent.com/jionpz/jspace/main/install/install.sh -o /tmp/jspace-install.sh \
  && bash /tmp/jspace-install.sh
```

Windows（PowerShell，两段式落盘执行）：

```powershell
irm https://raw.githubusercontent.com/jionpz/jspace/main/install/install.ps1 -OutFile $env:TEMP\jspace-install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\jspace-install.ps1
```

安装流程：识别平台与架构 → 从 GitHub Releases 下载匹配的编译二进制（SHA-256 校验）→ 装到 `~/.local/bin`（macOS/Linux，`$XDG_BIN_HOME` 可覆盖）或 `%LOCALAPPDATA%\jspace\bin`（Windows）→ 目录不在 PATH 时自动写入 shell rc（标记块，随卸载回滚）。

验证：

```bash
jspace --version
jspace init --dir ~/jworkspace # 生成真实工作台
jspace doctor --dir ~/jworkspace
```

> - 安装/卸载对 PATH 的改动需**新开终端**（或 source rc）后生效；非交互 shell（cron/IDE）需显式 `export PATH="$HOME/.local/bin:$PATH"`。
> - Windows 首次运行未签名 exe 若弹 SmartScreen：选「更多信息 → 仍要运行」。
> - 校验不通过（下载损坏/被篡改）会明确报错并退出非 0，不静默安装。

卸载：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/jionpz/jspace/main/install/install.sh -o /tmp/jspace-install.sh \
  && bash /tmp/jspace-install.sh --uninstall
```
```powershell
# Windows（落盘执行；新终端下重新下载脚本即可）
irm https://raw.githubusercontent.com/jionpz/jspace/main/install/install.ps1 -OutFile $env:TEMP\jspace-install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\jspace-install.ps1 -Uninstall
```

### 开发模式（源码运行）

```bash
# 在另一个目录初始化真实工作台（源码运行；或先 `bun run build` 后用编译产物）
bun run cli/main.ts init ~/jworkspace

# 校验工作台
bun run cli/main.ts doctor --dir ~/jworkspace
```

## 常用运维命令

- `jspace cron` — 定时任务:`cron run <id> --dry-run`(rehearsal)、`cron install --dry-run`(reconciliation 计划)、`cron check`(会话开始失败/暂存聚合)、`cron ack`。
- `jspace ingest` — 资料入库 journal:`ingest begin`(暂存副本+journal)→ `advance --gbrain` → `advance --index` → `advance --complete`(移除 source);任一步失败 `ingest fail <id> --reason <原因>`(补偿,source 留 inbox 无孤儿);中断 `ingest list` 续跑。commit 的 source 移除未证明完成时 journal 保持 `failed/failedStep=committed`(`list` 标注 `failed/cleanup-pending`)——用同一 `advance <id> --complete` 幂等收尾,不虚报 source 已删。
- `jspace pending` — gbrain 写暂存:`pending stage`(锁冲突)、`pending apply`(锁空闲落 live,幂等)、`pending ack`(terminal_failed 确认)。锁冲突写不失败。
- `jspace workspace diff / upgrade` — 工作台升级计划与执行(managed 内容刷新、本地修改保冲突)。
- `jspace context` — harness hook 上下文注入:`context session-start|turn|pre-compact|session-end`(默认 hook JSON envelope;`--plain` 纯文本;session-start 另支持 `--envelope cursor`)。被 `.claude/settings.json` / `.grok/hooks/` / `.cursor/hooks.json` 等消费。
- `jspace domain / resource / project / filehub` — 域与资源注册表操作;`jspace skills install` 物化用户级官方技能;`jspace gbrain wire` 注入 gbrain MCP env;`jspace harness wire --harness <x>` 写各 harness 配置（支持 Claude Code / Grok Build / OpenCode / Pi / Cursor；Codex 仅 cron 兼容）。`jspace gbrain wire` 为 Claude Code 别名（向后兼容）。

## 目录结构

- `GOAL.md` - 最终目标（North Star），所有迭代的对齐物
- `cli/` - CLI 源码与命令（TypeScript/bun；`bin/jspace` 为 `bun run build` 编译产物）
- `core/` - 契约层（cron/skills/manifest 等 schema + decode）
- `application/` - 领域用例（automation/context/ingest/pending/workspace/registry…）
- `adapters/` - harness（capabilities.yaml 单一事实源）/ scheduler / process / fs 适配
- `scripts/` - 生成与校验（gen-assets / gen-version / check-skills / check-harness-consistency / check-manifest-integrity）
- `templates/` - 工作台模板源（`workbench/` + `filehub/`）
- `skills/` - 官方技能源码（物化进工作台 `.jspace/skills/`）
- `types/` - ambient 类型（如 `@opencode-ai/plugin` 的轻量 shim）
- `AGENTS.md` - 开发模式操作规则

## 开发模式

本仓库默认就是开发模式。非平凡改动先走 Trellis；改完 CLI 后用临时目录做一次 `init` + `doctor` 验证。改模板/skills/capabilities 后必须重跑 `bun run scripts/gen-assets.ts`（嵌入二进制资产并提交 generated 文件）。PR/push 质量门禁见 `.github/workflows/verify.yml`：tsc、bun test、资产完整性（`check-manifest-integrity`）、skill 自检、harness 一致性、全链集成。
