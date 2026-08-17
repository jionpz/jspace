# Pi 接线参考（honest boundary + 插件通道）

> Pi 是 JSpace 支持集里的**最低能力 tier**（T3）：cron 无头 `pi -p` 可用，但**无 Claude 风格 hooks**（`hook_format: none`）。gbrain 接入靠 CLI 或第三方扩展 `pi-mcp-adapter`。本文档诚实标注「能做什么 / 怎么做 / 边界在哪」，不假装有自动接线。
> 与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Pi 的支持声明；`~/.agents/agents.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.pi）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `harness: pi`（argv `pi -p`） | `adapters/harness/pi.ts` headlessArgv，有单测 |
| 原生 MCP | ❌ 无（Pi core「No MCP」） | 走 CLI 或 `pi-mcp-adapter` 扩展 |
| MCP 扩展 | ⚠️ `via: pi_mcp_adapter` | 第三方通道，见下方安装提示 |
| 会话事件 | ⚠️ `session_start` / `before_agent_start`（扩展事件；jspace 提供专用 extension） | `jspace harness wire --harness pi` 写入 `~/.pi/agent/extensions/jspace/index.ts` |
| hooks.json | ❌ 无 | 注入靠 context/SYSTEM 文件 + 扩展事件 |
| skills 投影 | `~/.agents/skills/`（用户级） | `jspace skills install` 物化；Pi 认该目录 |
| 生命周期分级 | session-start best_effort / session-end manual / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## gbrain 接入：两条路

1. **CLI（最简，推荐起步）**：会话中直接调用 `gbrain put / get / query / list`。零配置，Pi 会话能读写同一 gbrain 库。
2. **扩展 `pi-mcp-adapter`（第三方，社区标准）**：给 Pi 会话提供 gbrain stdio MCP。

### 安装 `pi-mcp-adapter`（手动，非自动）

```bash
pi install npm:pi-mcp-adapter
```

然后配置 `mcpServers`（stdio `command` + `args`，`<gbrain>` 按上文解析）。**机器级接线用统一 wire（issue #12）**：`jspace harness wire --harness pi --dir <workbench>` 幂等写 `~/.pi/agent/mcp.json` 的 `mcpServers.gbrain`（`command` = gbrain 路径，`args: ["serve"]`，`env.GBRAIN_SKILLS_DIR`），merge 保留其余字段，写前 backup。等价产物：

```json
{
  "mcpServers": {
    "gbrain": { "command": "<gbrain>", "args": ["serve"], "env": { "GBRAIN_SKILLS_DIR": "<wb>/.jspace/skills" } }
  }
}
```

pi-mcp-adapter 的配置搜索优先级（高→低，wire 固定落 `~/.pi/agent/mcp.json`，已在该列表中）：

```
~/.config/mcp/mcp.json  >  ~/.agents/mcp.json  >  ~/.agents/mcp/mcp.json
>  ~/.pi/agent/mcp.json  >  .mcp.json  >  .pi/mcp.json
```

> ⚠️ **供应链核对（红线级）**：`npm:pi-mcp-adapter` **安装即执行包代码**。安装前务必核对包来源与 README，确认信任后再 `pi install`。JSpace 只提示安装，**永不自动执行**。

## 会话注入（无 hooks.json，靠这些）

- **jspace 自动扩展（推荐）**：`jspace harness wire --harness pi --dir <workbench>` 会写 `~/.pi/agent/extensions/jspace/index.ts`。Pi 启动时自动加载该 extension，在 `before_agent_start` 运行 `jspace context session-start --plain`，并通过 `context` 事件注入到会话。
- **文件式**：`~/.pi/agent/SYSTEM.md`（替换默认 system prompt）与 `~/.pi/agent/APPEND_SYSTEM.md`（追加），或项目 `.pi/SYSTEM.md`；context files（AGENTS.md/CLAUDE.md）本身在启动时注入。
- **扩展事件式**：`session_start`（reason = startup/reload/new/resume/fork）与 `before_agent_start`（可注入消息/改 system prompt）——现由 jspace 专用 extension 提供；第三方 `pi-mcp-adapter` 主要提供 MCP 通道。
- **手动兜底**：`jspace context session-start --plain` 输出可手动贴进会话（无需 hook）。

## 能力边界（诚实声明）

- **session-start 自动注入**：通过 `~/.pi/agent/extensions/jspace/index.ts` 实现 best_effort 自动 briefing；Pi 无 Claude 风格 hooks.json，但扩展事件通道可用。
- **收工显式**：会话结束无自动 memory-writeback 触发；按 AGENTS.md End-of-Work Capture 纪律，显式触发 memory-writeback skill。
- **资产入库粒度**：cron 无头 `harness: pi` + `jspace pending` 桥接仍可用，但粒度是「一晚上一次」而非「一会话一次」。
- **如需 session-level 自动接线**，请选 Claude Code / Grok Build / OpenCode 之一（见 `harness-claude.md` / `harness-grok.md` / `harness-opencode.md`）。

## 验证

```bash
jspace harness wire --harness pi --dir . --dry-run   # 预览 MCP + session-start extension 写入
jspace doctor --dir .          # 应无 harness.pi 的 session_start_not_wired（wire 后）
jspace cron run <cron> --harness pi --dry-run --dir .   # argv = pi -p <prompt>
```
