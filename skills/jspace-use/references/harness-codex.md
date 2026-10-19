# Codex 接线参考（headless cron；无会话 hook）

> Codex 是 JSpace 支持集里的**正式条目**（与另外五个 harness 同样受 `check-harness-consistency` 检查），但它只覆盖 **headless 执行**：`codex exec` 可被 cron 调用，**没有** SessionStart / SessionEnd / compaction 事件，JSpace 也没有为它提供机器级 MCP 配置写入器。本文档如实标注「能做什么 / 怎么做 / 边界在哪」。
> 与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Codex 的支持声明；`~/.agents/AGENTS.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain`；两者都解析不到时接线显式失败并提示安装，不猜测 `~/.bun/bin/gbrain` 一类安装目录）。

## 支持面（capsules：capabilities.codex）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `codex exec`（argv 前缀 `codex exec`；模型 `-m <model>`） | cron.json `harness: "codex"`；`jspace cron run --id <id> --harness codex --dry-run` 可预演 argv |
| 工具限制 | ❌ 不支持 | `supports_tool_restriction: false`：cron 若声明 `tools`（或 `cron run --tools`），`cron add`/`cron run` **显式失败**（不静默忽略） |
| cron env 白名单 | `OPENAI_*` / `CODEX_*`（+ 通用基础键与 `GBRAIN_*`） | 无头执行只继承该白名单，避免把交互 shell 的凭据带进调度进程 |
| 会话 hook | ❌ 无（`sessions: []`） | 不假装有自动会话注入或收工提醒 |
| MCP | ⚠️ Codex 原生支持 MCP，但 **JSpace 不提供写入器**（`mcp_config: null`） | `jspace harness wire --harness codex` **拒绝**（不支持该 harness）；如需 gbrain MCP，按 Codex 官方文档在 `~/.codex/config.toml` 手写 `[mcp_servers.gbrain]`，JSpace 只如实记录该边界 |
| skills 投影 | 无（`workbench_projection: []` / `user_install: []`） | 不向 `~/.codex/` 物化任何 JSpace skill |
| 全局入口 | ✅ `~/.codex/AGENTS.md`（symlink 接线，`AGENTS.override.md` 可覆盖） | 由 `harness-config` 的机器级治理负责；`jspace doctor` 只读核对 |
| 原生记忆 | 无（`native_memory: none`） | 记忆一律走 gbrain |
| 生命周期分级 | session-start manual / session-end manual / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（cron）

```bash
jspace cron add inbox-codex --schedule "0 21 * * *" --harness codex --prompt "<指令>" --dir .
jspace cron run --id inbox-codex --harness codex --dry-run --dir .   # 逐字节预演，不执行
```

- 提示词与工具契约留在 `.jspace/cron.json`（user 数据，升级不覆盖）；官方周期任务用 `target: {kind: "skill"}`，不写内联长 prompt。
- 调度条目由 `jspace cron install` 写系统调度器；macOS/Linux/Windows 的后端与补跑语义见 JSpace 开发仓库（工作台外部，不随 init 物化）`docs/PLATFORMS.md`。

## 能力边界（诚实声明）

1. **没有会话 hook。** Codex 不进 session-start / session-end 注入路径，收工写回提醒与上下文注入都不覆盖它；这些 entry 的 lifecycle 分级是 `manual`，不是 best_effort。
2. **`mcp.native: true` 不等于已接线。** 该字段只声明 Codex 产品本身支持 MCP；JSpace 未声明 `mcp_config`，因此不写 `~/.codex/config.toml`，doctor 也不对它报 gbrain skills-dir 未接线。
3. **不支持工具限制。** 需要按工具授权的任务应改用 claude/grok（它们声明了 `argv_flags.permission`）。
4. **crash_recovery: best_effort** 指的是无头进程被中断后由 JSpace 的 run 记录/incident 侧处置，不是 Codex 会话内自动恢复。

## 验证

```bash
jspace cron run --id <codex-cron> --harness codex --dry-run --dir .   # argv 形状（codex exec …）
jspace doctor --dir . --verbose                                      # 只读核对，不修改 Codex 配置
bun run scripts/check-harness-consistency.ts                         # 支持集/文档集一致性（CI）
```
