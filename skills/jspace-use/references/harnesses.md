# Harness wiring reference

> 完整推荐配置、全局治理文档(`~/.agents/agents.md`)接线与逐 harness 差异见 **`harness-config` skill**;本文件是 JSpace 工作台对 harness 支持集的**权威声明**(单一来源,与 `adapters/harness/capabilities.yaml` 保持一致)。
> **`harness-config` 是机器级全局 skill**,**不随本工作台物化**(不在 `skills/` 下);需要时按其 Phase 1 自装到 `~/.agents/skills/harness-config` 后再用,勿假设工作台已内置。
> `<gbrain>` = gbrain 二进制绝对路径,按 `$GBRAIN_BIN` → `command -v gbrain`(Windows `where gbrain`) → `~/.bun/bin/gbrain` 解析(Windows:`%USERPROFILE%\.bun\bin\gbrain.exe`)。

支持集 = **五个会话 harness（Claude Code / Grok Build / OpenCode / Pi / Cursor）+ codex cron 兼容**。用户选其一会话 harness 使用,wire 那一个;hermes 可选(提及即可,不主动推广)。所有 harness 经 MCP/CLI 读写同一 gbrain 库。

## Harness 支持全景（auto-generated from capabilities.yaml）

> 逐 harness 真实能力与接线:见各 `harness-<name>.md`(下节链接)。下表是 capabilities.yaml 的渲染,勿手工编辑。

| harness | headless(cron) | sessions | mcp | hook_format | native_memory | lifecycle: start/end/fallback/crash |
|---|---|---|---|---|---|---|
| claude | `claude -p …` | SessionStart / UserPromptSubmit | native | claude_settings_json | none | best_effort / manual / manual / best_effort |
| grok | `grok -p …` | SessionStart / UserPromptSubmit / PreCompact / SessionEnd | native | grok_hooks_json | full | best_effort / best_effort / manual / best_effort |
| opencode | `opencode run …` | session.created / session.idle / experimental.session.compacting | native | opencode_plugin_ts | none | best_effort / best_effort / manual / best_effort |
| pi | `pi -p …` | session_start / before_agent_start（扩展事件） | via: pi_mcp_adapter | none | none | best_effort / best_effort / manual / best_effort |
| cursor | 无（IDE-only） | sessionStart | native | cursor_hooks_json | none | best_effort / manual / manual / manual |
| codex | `codex exec …` | — | native | none | none | best_effort / manual / manual / best_effort |

- **automated 的边界**：上表全部为 best_effort/manual（lifecycle 真实触发是 harness 运行时行为，未在 CI 全链验证）；CLI 侧的 automated 见 `docs/PLATFORMS.md`（外部稳定依赖，JSpace 开发仓库文档）「Harness 能力矩阵」（claude cron argv 有单测证据）。
- **分级语义（父任务 invariant #7：不虚报自动化可靠性）**：
  - **automated**：有 CI/测试证据、可作为保证的路径（如 claude headless cron argv 生成，见 `adapters/harness/argv.test.ts`）。
  - **best_effort**：机制存在（hook / plugin / Rules / 指令），但真实触发依赖用户环境（需启用/审批/会话条件），不构成保证。
  - **manual**：无自动机制，须用户/agent 显式执行。
  - **unsupported**：机制不存在。
- **措辞约定**：产品文档（模板 AGENTS / references / PLATFORMS）**只在 automated 处**使用「自动/保证」类措辞；best_effort/manual 路径说「按需」「显式」「可」等。

## 逐 harness 接线

- [`harness-claude.md`](harness-claude.md) — 参考实现：hooks + `.claude/skills/` + MCP + `jspace gbrain wire`
- [`harness-grok.md`](harness-grok.md) — T1 桥接：`.grok/hooks/` 四事件 + `.grok/skills/` + `jspace harness wire --harness grok`
- [`harness-opencode.md`](harness-opencode.md) — T2.5 plugin：`.opencode/plugins/jspace.ts` + 细粒度事件 + compacting context 注入
- [`harness-pi.md`](harness-pi.md) — T3 honest boundary：cron `pi -p` + pi-mcp-adapter 插件通道
- [`harness-cursor.md`](harness-cursor.md) — 会话 harness（D6 保留）：无 headless，MCP + sessionStart hook + Rules
- codex：cron 兼容条目（`documented: false`，无独立 doc——现有 cron 契约继续可用）

## 跨平台路径速查(Windows / macOS / Linux)

| 项 | macOS / Linux | Windows |
|---|---|---|
| gbrain 解析 | `$GBRAIN_BIN` → `which gbrain` → `~/.bun/bin/gbrain` | `$GBRAIN_BIN` → `where gbrain` → `%USERPROFILE%\.bun\bin\gbrain.exe` |
| Claude Code MCP | `~/.claude.json`(`mcpServers.gbrain`) | `%USERPROFILE%\.claude.json` |
| Codex 配置 | `~/.codex/config.toml`(`[mcp_servers.gbrain]`) | `%USERPROFILE%\.codex\config.toml` |
| Grok 配置 | `~/.grok/config.toml`(`[mcp_servers.gbrain]`) | `%USERPROFILE%\.grok\config.toml` |
| Cursor MCP | `~/.cursor/mcp.json`(user) / `.cursor/mcp.json`(project) | `%USERPROFILE%\.cursor\mcp.json`(user) / `.cursor\mcp.json`(project) |

> Windows 注意:**stdio MCP 的 `command` 必须写可执行文件全路径**(如 `%USERPROFILE%\.bun\bin\gbrain.exe`),不要用裸命令名——Windows 默认 shell 是 PowerShell,且 stdio 拉起不走 PATH 解析裸名。symlink 在 Windows 需管理员/开发者模式;gbrain 与 harness 均原生支持 Windows。

## hermes (optional)

- Optional harness for autonomous/cron/multi-endpoint work. Mention that it exists; do not proactively wire or install it.
- If already configured: MCP in `~/.hermes/config.yaml`; MCP stderr logs at `~/.hermes/logs/mcp-stderr.log`.

## Provider / proxy management (optional)

AI provider/model/proxy management is user-environment specific and outside this workbench's defaults. If the user has a local management tool or a local proxy gateway, register it as a resource in `.jspace/hub.json` and manage it from an appropriate domain. No specific tool or endpoint is assumed.
