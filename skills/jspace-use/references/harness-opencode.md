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
| 生命周期分级 | session-start best_effort / session-end manual / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（init 后现状）

`.opencode/plugins/jspace.ts` seed plugin（薄 emit，无业务逻辑）：

| 事件 | 动作 | 纪律 |
|---|---|---|
| `session.created` | `client.session.prompt`（`noReply: true`）注入 `jspace context session-start --plain` 文本 | session-start 注入；OpenCode 无 system-prompt 通道，注入以可见 user message 落历史 |
| `session.idle` | `jspace cron check`（非 quiet），exit != 0 时把输出经 `noReply` 注入为可见提醒 | **失败面可见**；idle **不**自动 flush staged 写（P1.7：与 Claude/Grok 一致，staged flush + write-back 都用户显式触发）；不自动 memory-writeback（D3） |
| `experimental.session.compacting` | `jspace context session-start --plain` push 进 compaction context | 只注入 context，不写 gbrain |

所有 spawn 带 guard（8s 超时 + `stdin: ignore` + 退出码检查），失败静默返回空——hook/plugin 永不阻塞会话。`cwd = directory`（workbench 根）。

**gbrain MCP 接线（统一 wire，issue #12）**：`jspace harness wire --harness opencode --dir <workbench>` 幂等写 `~/.config/opencode/opencode.json` 的 `mcp.gbrain`（local-server shape：`{ type: "local", command: ["<gbrain>", "serve"], enabled: true, environment: { GBRAIN_SKILLS_DIR: "<wb>/.jspace/skills" } }`），merge 保留其余配置（如 provider apiKey），写前 backup。

`jspace cron check` 的退出码语义：exit != 0 表示有需要 attention 的项（失败 + pending staged writes）；`--quiet` 变体抑制 stdout 但保留 exit code（JSpace CLI 提供）。

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
