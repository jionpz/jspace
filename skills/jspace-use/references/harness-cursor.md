# Cursor 接线参考（会话 harness，D6 保留）

> Cursor 是 **IDE-only 会话 harness**：**无 headless CLI**（无 `-p` 模式），所以**永不进 cron enum**（`capabilities.cursor.headless: null`，`cron_harness_enum_value: null`）。用户拍板（D6）保留 Cursor 为会话 harness，本次改造只**数据化不深度改造**——维持现状接线（MCP + sessionStart hook + Rules），不做新的自动化通道。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Cursor 的支持声明；`~/.agents/agents.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.cursor）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ❌ **无 headless CLI**（IDE） | `cursorAdapter.headlessArgv` → `fail("cursor has no headless CLI")`；`cron.harness` 不接受 cursor |
| 会话 hook | ✅ `sessionStart`（项目级 `.cursor/hooks.json` seed，`additional_context` 注入会话初始上下文） | best_effort |
| MCP | ✅ 原生（`~/.cursor/mcp.json` 用户级 / `.cursor/mcp.json` 项目级，project overrides user） | |
| 会话注入 | Rules `.mdc`（项目级）+ Cursor 原生读 AGENTS.md/CLAUDE.md | 用户级无规则文件（Cursor UI 存 User Rules） |
| skills 投影 | `.agents/skills/`（共享） | 工作台级 |
| 生命周期分级 | session-start best_effort / session-end manual / fallback manual / crash manual | 见 capabilities.lifecycle |

## 接线（现状，D6 保留不扩）

- **MCP**：

```json
{
  "mcpServers": {
    "gbrain": { "command": "<gbrain>", "args": ["serve"] }
  }
}
```

  用户级 `~/.cursor/mcp.json` 或项目级 `.cursor/mcp.json`（project overrides user）。若 `~/.cursor` 不存在，创建 `~/.cursor/mcp.json`；Cursor 重启后可能在 MCP 设置里要求审批 server。
- **session-start 注入**：至少保证 MCP wiring；如需会话级 context 注入，用 `.cursor/rules/*.mdc`（项目级）或 Rules 文件。项目级 `.cursor/hooks.json`（seed，check into VCS）的 `sessionStart` 事件输出顶层 `{"additional_context":"<text>"}` 注入会话初始上下文——命令为 `jspace context session-start --envelope cursor 2>/dev/null || true`（Cursor 从项目级 + 用户级 `~/.cursor/hooks.json` 多层级加载；用户级可覆盖/追加，但工作台 seed 落项目级）。
- **无 headless**：cron 不能用 cursor 跑（`cron run --harness cursor` → `fail`）。

## 能力边界（诚实声明）

- 无 headless CLI → 不参与 cron 无头执行。
- 用户级规则无文件入口（Cursor UI 存 User Rules），全局治理文档接进 Cursor 靠项目级 `.mdc` 指针 + Cursor 原生读 AGENTS.md/CLAUDE.md。
- 会话结束无自动 memory-writeback（manual）；收工走显式纪律。

## 验证

```bash
jspace doctor --dir .          # checkHarness: cursor 无 headless 不触发 bin 检查（非 cron harness）
jspace cron run <cron> --harness cursor --dry-run --dir .   # fail("cursor has no headless CLI")
```
