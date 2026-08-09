# OpenCode 接线参考（T2.5 plugin 驱动）

> OpenCode 用 **plugin（JS/TS 模块）** 而非 hooks.json，事件比 Claude 更细（`session.created` / `session.idle` / `experimental.session.compacting`）。本工作台对 OpenCode 的接线 = 用 plugin 重建「Claude 等价」，并利用 `experimental.session.compacting`（可注入 compaction context，等价 Grok memory_flush 时机）——但**只注入 context、不自动写 gbrain**（D2/D3 纪律一致）。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 OpenCode 的支持声明。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.opencode）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `harness: opencode`（argv `opencode run <prompt>`，positional） | argv 有单测（`adapters/harness/opencode-plugin.test.ts` 部分）；**无头 cron 可靠性未在 CI 全链验证** → best_effort |
| 会话事件 | ✅ `session.created` / `session.idle` / `experimental.session.compacting`（`.opencode/plugins/jspace.ts`） | best_effort（plugin 是否被 OpenCode 自动发现 + 事件真实触发**未实测**） |
| MCP | ✅ 原生 | |
| skills 投影 | `.opencode/skills/`（工作台级）+ `.agents/skills/`（共享） | init/upgrade 物化 |
| 生命周期分级 | session-start best_effort / session-end best_effort / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（init 后现状）

`.opencode/plugins/jspace.ts` seed plugin（薄 emit，无业务逻辑）：

| 事件 | 动作 | 纪律 |
|---|---|---|
| `session.created` | `jspace context session-start` | session-start 注入 |
| `session.idle` | `jspace pending apply --quiet` + `jspace cron check --quiet` | **flush 用户显式 stage 的队列 + cron 失败面**；idle 每 turn fire，**不**自动 memory-writeback（D3：自动写会写废） |
| `experimental.session.compacting` | `jspace context session-start --plain` push 进 compaction context | 只注入 context，不写 gbrain |

所有 spawn `Bun.spawn` fire-and-forget（不 await，避免阻塞每 turn 事件循环），失败静默——hook/plugin 永不阻塞会话。`cwd = directory`（workbench 根）。

`jspace pending apply --quiet` / `jspace cron check --quiet` 的 `--quiet` 由 JSpace CLI 提供（抑制 stdout，保留 exit code）。

## 待真实 OpenCode 会话验证（best_effort 边界）

1. `.opencode/plugins/jspace.ts` 是否被 OpenCode 自动发现/需配置引用——未实测。
2. `experimental.session.compacting`（experimental 前缀）真实触发与 `output.context` 注入——未实测。
3. headless `opencode run <prompt>` 在 unattended cron 下是否挂起等模型、exit code 语义——未在 CI 验证（CI 无 opencode）。

## 验证

```bash
jspace doctor --dir .          # checkHarness: 活跃 opencode 二进制在 PATH 检查
jspace cron run <cron> --harness opencode --dry-run --dir .   # argv = opencode run <prompt>
bun test adapters/harness/opencode-plugin.test.ts  # 事件分支（idle 不含 writeback）
```
