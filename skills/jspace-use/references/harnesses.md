# Harness wiring reference

> 完整推荐配置、全局治理文档(`~/.agents/agents.md`)接线与逐 harness 差异见 **`harness-config` skill**;本文件保留首次启用(first-use)wiring 视角。
> **`harness-config` 是机器级全局 skill**,**不随本工作台物化**(不在 `skills/` 下);需要时按其 Phase 1 自装到 `~/.agents/skills/harness-config` 后再用,勿假设工作台已内置。
> `<gbrain>` = gbrain 二进制绝对路径,按 `$GBRAIN_BIN` → `command -v gbrain`(Windows `where gbrain`) → `~/.bun/bin/gbrain` 解析(Windows:`%USERPROFILE%\.bun\bin\gbrain.exe`)。

Four session harnesses are supported: Pi, Claude Code, Codex, Cursor. The user picks which one to use; wire that one. hermes is optional (mention, don't promote). All harnesses read/write the same gbrain store over MCP/CLI.

## 跨平台路径速查(Windows / macOS / Linux)

| 项 | macOS / Linux | Windows |
|---|---|---|
| gbrain 解析 | `$GBRAIN_BIN` → `which gbrain` → `~/.bun/bin/gbrain` | `$GBRAIN_BIN` → `where gbrain` → `%USERPROFILE%\.bun\bin\gbrain.exe` |
| Claude Code MCP | `~/.claude.json`(`mcpServers.gbrain`) | `%USERPROFILE%\.claude.json` |
| Codex 配置 | `~/.codex/config.toml`(`[mcp_servers.gbrain]`) | `%USERPROFILE%\.codex\config.toml` |
| Cursor MCP | `~/.cursor/mcp.json`(user) / `.cursor/mcp.json`(project) | `%USERPROFILE%\.cursor\mcp.json`(user) / `.cursor\mcp.json`(project) |

> Windows 注意:**stdio MCP 的 `command` 必须写可执行文件全路径**(如 `%USERPROFILE%\.bun\bin\gbrain.exe`),不要用裸命令名——Windows 默认 shell 是 PowerShell,且 stdio 拉起不走 PATH 解析裸名。symlink 在 Windows 需管理员/开发者模式;gbrain 与 harness 均原生支持 Windows。

## Pi

- MCP or CLI: at minimum ensure the `gbrain` CLI works. Note: Pi core has **no native MCP** — for stdio MCP use the `pi-mcp-adapter` extension, or rely on the `gbrain` CLI directly (see `harness-config` skill).

## Claude Code

- Skill discovery: official workbench skills materialize byte-identical into
  `.jspace/skills/` (harness-agnostic source) **and** `.claude/skills/`, so
  Claude Code's native skill selector (`Skill` tool, `/jspace-use`) can find
  them. Root `CLAUDE.md` imports `@AGENTS.md`, so claude sessions also load the
  workbench routing rules via the official memory channel. After an upgrade that
  creates `.claude/skills/` on a workbench where it did not exist, restart the
  claude session — Claude Code only watches skill directories that existed when
  the session started.
- MCP in `~/.claude.json` -> `mcpServers.gbrain`:

```json
{ "command": "<gbrain>", "args": ["serve"], "type": "stdio" }
```

## Codex

- MCP in user-level `~/.codex/config.toml`:

```toml
[mcp_servers.gbrain]
command = "<gbrain>"
args = ["serve"]
```

- Session-start injection: user-level `[features] hooks = true`, then a project `.codex/hooks.json` `SessionStart` hook emitting `hookSpecificOutput.hookEventName = "SessionStart"` + `additionalContext` (e.g., recent `gbrain list` / `gbrain query` output).
- Project hooks fire only after the user enables `features.hooks` and approves the hooks in the `/hooks` TUI review.

## Cursor

- MCP via `mcp.json` - project-level `.cursor/mcp.json` or user-level `~/.cursor/mcp.json` (project overrides user):

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "<gbrain>",
      "args": ["serve"]
    }
  }
}
```

- If `~/.cursor` does not exist yet, create `~/.cursor/mcp.json`; Cursor picks it up on restart and may ask to approve the server in MCP settings.
- Fallback if the file is not picked up: Cursor Settings > Features > MCP > Add New MCP Server (stdio transport, command + args), or restart Cursor.
- Session-start injection: at minimum ensure MCP wiring works; add retrieval instructions to `.cursor/rules/*.mdc` or a Rules file if session-start context injection is wanted.

## hermes (optional)

- Optional harness for autonomous/cron/multi-endpoint work. Mention that it exists; do not proactively wire or install it.
- If already configured: MCP in `~/.hermes/config.yaml`; MCP stderr logs at `~/.hermes/logs/mcp-stderr.log`.

## Lifecycle 能力矩阵（权威，单一来源）

> **本矩阵是 JSpace 对四 harness 生命周期能力的唯一权威声明**；JSpace 开发仓库 `docs/PLATFORMS.md`（外部稳定依赖，不随工作台物化）交叉引用本表，不另写整表。分级语义（父任务 invariant #7：不虚报自动化可靠性）：
> - **automated**：有 CI/测试证据、可作为保证的路径（如 claude headless cron argv 生成，见 `adapters/harness/argv.test.ts`）。
> - **best_effort**：机制存在（hook / Rules / 指令），但真实触发依赖用户环境（需启用/审批/会话条件），不构成保证。
> - **manual**：无自动机制，须用户/agent 显式执行。
> - **unsupported**：机制不存在。

| harness | session-start retrieval | session-end write-back | 显式 fallback | crash recovery |
|---|---|---|---|---|
| Pi | best_effort（context 文件 / SYSTEM.md，加载依赖 `/reload` 或会话条件） | best_effort（AGENTS End-of-Work Capture + 显式「收工」；无原生 session-end hook） | manual（用户显式调用 skill/命令） | best_effort（下次会话 context 重载可见 pending/incident） |
| Claude Code | best_effort（SessionStart hook，`.claude/settings.json`；需 hook 真实触发，非 CI 验证） | best_effort（End-of-Work Capture + 显式「收工」；无原生 session-end hook） | manual | best_effort（SessionStart 跑 `cron check` 暴露未确认 incident） |
| Codex | best_effort（SessionStart hook 需用户 enable `features.hooks` + `/hooks` 审批） | manual（无 hook；靠显式收工） | manual | best_effort（hook 生效时 SessionStart 检查） |
| Cursor | best_effort（Rules `.mdc` / sessionStart hook） | manual（无 hook；靠显式收工） | manual | manual（无自动 SessionStart 检查） |

- **automated 的边界**：本矩阵不含 automated 格——所有 lifecycle 操作的真实触发都是 harness 运行时行为，未在 CI 验证，如实标 best_effort/manual。CLI 侧的 automated 见 `docs/PLATFORMS.md`「Harness 能力矩阵」（claude cron argv 有单测证据）。
- 措辞约定：产品文档（模板 AGENTS / references / PLATFORMS）**只在 automated 处**使用「自动/保证」类措辞；best_effort/manual 路径说「按需」「显式」「可」等。

## Provider / proxy management (optional)

AI provider/model/proxy management is user-environment specific and outside this workbench's defaults. If the user has a local management tool or a local proxy gateway, register it as a resource in `.jspace/hub.json` and manage it from an appropriate domain. No specific tool or endpoint is assumed.
