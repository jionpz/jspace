# Claude Code 接线参考（参考实现）

> Claude Code 是 JSpace harness 接线的**参考实现**：hooks（`.claude/settings.json`）+ skills 投影（`.claude/skills/` + `.agents/skills/`）+ MCP（`~/.claude.json`）+ 用户级 `~/.agents/skills/`。其他 harness 的接线是对它的近似。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Claude Code 的支持声明；`~/.agents/agents.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.claude）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `harness: claude`（argv `claude -p <prompt> --output-format text --allowedTools Bash,Read,Write,Edit,mcp__gbrain__*`） | **automated**：`adapters/harness/argv.test.ts` 单测锁定形状 + 白名单 |
| 会话 hook | ✅ SessionStart / UserPromptSubmit（`.claude/settings.json`，`jspace context session-start` / `turn`） | best_effort（交互式 + 无头 `claude -p` 均触发——实测确认） |
| MCP | ✅ 原生（`~/.claude.json` `mcpServers.gbrain`） | stdio `command + args` |
| skills 投影 | `.claude/skills/` + `.agents/skills/`（工作台级）+ `~/.agents/skills/`（用户级） | 工作台级 init/upgrade 物化；用户级 `jspace skills install` |
| 生命周期分级 | session-start best_effort / session-end manual / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（init 后现状）

- **hooks**：`templates/workbench/.claude/settings.json` seed——SessionStart（matcher `startup|clear|compact`）+ UserPromptSubmit（`turn`），命令带 `2>/dev/null || true` 保证 hook 永不阻塞会话。
- **skill discovery**：官方 skill 同字节投影到 `.jspace/skills/`（源）+ `.claude/skills/` + `.agents/skills/`，Claude Code 原生 skill 选择器（`Skill` 工具、`/jspace-use`）可发现。升级创建 `.claude/skills/` 后需**重启 claude 会话**（Claude Code 只监听会话启动时已存在的 skill 目录）。
- **MCP**：`~/.claude.json` -> `mcpServers.gbrain`：

```json
{ "command": "<gbrain>", "args": ["serve"], "type": "stdio" }
```

- **用户级 skills**：`jspace skills install` 物化到 `~/.agents/skills/`（多 harness 统一位置）。

## gbrain skill 路由

`jspace gbrain wire` 把 `GBRAIN_SKILLS_DIR=<wb>/.jspace/skills` 注入 `~/.claude.json` 的 gbrain MCP server env（合并、备份、绝不重写；需已存在 gbrain MCP server）。

## 验证

```bash
jspace doctor --dir .          # checkHarness: 活跃 claude 且二进制在 PATH -> 无 harness 诊断
jspace cron run <cron> --harness claude --dry-run --dir .   # argv 逐字节（--allowedTools 白名单）
```
