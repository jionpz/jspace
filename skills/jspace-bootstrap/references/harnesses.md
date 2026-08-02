# Harness wiring reference

> 完整推荐配置、全局治理文档(`~/.agents/agents.md`)接线与逐 harness 差异见 **`harness-config` skill**;本文件保留 bootstrap 首次 wiring 视角。
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

## cc-switch (provider/model/proxy)

- Owned by `/Users/jionpz/.cc-switch` (resource `cc-switch`). Read `workspace/agent-infra/README.md` and `domain.json` before changing providers/models/proxy/clients. Local proxy: `http://127.0.0.1:2006`.
