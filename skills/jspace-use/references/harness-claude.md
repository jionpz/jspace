# Claude Code 接线参考（参考实现）

> Claude Code 是 JSpace harness 接线的**参考实现**：hooks（`.claude/settings.json`）+ skills 投影（`.claude/skills/` + `.agents/skills/`）+ MCP（`~/.claude.json`）+ 用户级 `~/.agents/skills/`。其他 harness 的接线是对它的近似。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Claude Code 的支持声明；`~/.agents/agents.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.claude）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `harness: claude`（argv `claude -p <prompt> --output-format text --allowedTools Bash,Read,Write,Edit,mcp__gbrain__*`） | **automated**：`adapters/harness/argv.test.ts` 单测锁定形状 + 白名单 |
| 会话 hook | ✅ SessionStart / UserPromptSubmit（`.claude/settings.json`，`jspace context session-start` / `turn`） | best_effort（交互式 + 无头 `claude -p` 均触发——实测确认） |
| 会话结束 hook | ✅ SessionEnd（`jspace context session-end`） | best_effort；**输出被 Claude 丢弃**（见下方「session-end 的边界」） |
| MCP | ✅ 原生（`~/.claude.json` `mcpServers.gbrain`） | stdio `command + args` |
| skills 投影 | `.claude/skills/` + `.agents/skills/`（工作台级）+ `~/.agents/skills/`（用户级） | 工作台级 init/upgrade 物化；用户级 `jspace skills install` |
| 生命周期分级 | session-start best_effort / session-end best_effort / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（init 后现状）

- **hooks**：`templates/workbench/.claude/settings.json` seed——SessionStart（matcher `startup|clear|compact`）+ UserPromptSubmit（`turn`）+ SessionEnd（`session-end`，不写 matcher = 匹配全部结束原因），命令为纯 `jspace context ...`（无 shell 语法；CLI 内部吞错 exit 0，hook 永不阻塞会话）。
- **skill discovery**：官方 skill 同字节投影到 `.jspace/skills/`（源）+ `.claude/skills/` + `.agents/skills/`，Claude Code 原生 skill 选择器（`Skill` 工具、`/jspace-use`）可发现。升级创建 `.claude/skills/` 后需**重启 claude 会话**（Claude Code 只监听会话启动时已存在的 skill 目录）。
- **MCP**：`~/.claude.json` -> `mcpServers.gbrain`：

```json
{ "command": "<gbrain>", "args": ["serve"], "type": "stdio" }
```

- **用户级 skills**：`jspace skills install` 物化到 `~/.agents/skills/`（多 harness 统一位置）。

## session-end 的边界（诚实声明）

Claude Code 的 `SessionEnd` 是**一次性会话级事件**，matcher 可按结束原因过滤（`clear` / `resume` / `logout` / `prompt_input_exit` / `other`）。三条限制决定了它只能是 best_effort，不能说「自动写回」：

1. **无决策权、输出被丢弃**——SessionEnd 不能阻断会话结束，Claude 也会丢弃它的 JSON 输出字段。`jspace context session-end` 渲染的提醒**不会注入会话**（会话已经结束）；接线的意义是「结束时机上有个会跑的钩子」。
2. **超时预算紧**——SessionEnd 默认共享 1.5 秒；seed 写 `timeout: 10` 把预算抬到 10 秒。
3. **不保证一定跑**——部分退出路径/信号会在 hook 之前结束进程。

因此**收工写回的真实提醒面是 `jspace context turn`**：无更高优先级状态（hub/pending/cron/inbox）时，每会话最多注入一次收工提示。两者都**不自动写 gbrain**——写回永远是你说「收工」触发 `memory-writeback`。证据与复核方法见 JSpace 开发仓库（工作台外部，不随 init 物化）`docs/session-end-hooks.md`。

> 未接 `PreCompact`：Claude 的 PreCompact **有阻断权**（会阻止 compaction），且 seed 的 SessionStart 已带 `compact` matcher（compaction 后重新注入上下文），收益已覆盖、风险不划算。

## gbrain skill 路由

`jspace harness wire --harness claude`(等价旧入口 `jspace gbrain wire`,issue #12)把 `GBRAIN_SKILLS_DIR=<wb>/.jspace/skills` 注入 `~/.claude.json` 的 gbrain MCP server env(合并、备份、绝不重写;需已存在 gbrain MCP server)。

## 验证

```bash
jspace doctor --dir .          # checkHarness: 活跃 claude 且二进制在 PATH -> 无 harness 诊断
jspace cron run <cron> --harness claude --dry-run --dir .   # argv 逐字节（--allowedTools 白名单）
```
