# Harness wiring reference

> 完整推荐配置、全局治理文档(`~/.agents/agents.md`)接线与逐 harness 差异见 **`harness-config` skill**;本文件保留 bootstrap 首次 wiring 视角。
> `<gbrain>` = gbrain 二进制绝对路径,按 `$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain` 解析。

Four session harnesses are supported: Pi, Claude Code, Codex, Cursor. The user picks which one to use; wire that one. hermes is optional (mention, don't promote). All harnesses read/write the same gbrain store over MCP/CLI.

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
