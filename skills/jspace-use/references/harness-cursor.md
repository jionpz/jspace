# Cursor 接线参考（会话 harness，D6 保留）

> Cursor 是 **IDE-only 会话 harness**：**无 headless CLI**（无 `-p` 模式），所以**永不进 cron enum**（`capabilities.cursor.headless: null`，`cron_harness_enum_value: null`）。用户拍板（D6）保留 Cursor 为会话 harness，本次改造只**数据化不深度改造**——维持现状接线（MCP + sessionStart hook + Rules），不做新的自动化通道。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Cursor 的支持声明；`~/.agents/agents.md` 全局治理的逐 harness 差异见 harness-config。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.cursor）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ❌ **无 headless CLI**（IDE） | `cursorAdapter.headlessArgv` → `fail("cursor has no headless CLI")`；`cron.harness` 不接受 cursor |
| 会话 hook | ✅ `sessionStart`（项目级 `.cursor/hooks.json` seed，`additional_context` 注入会话初始上下文） | best_effort |
| 会话结束 hook | ✅ `sessionEnd`（同一 seed，`jspace context session-end --plain`） | best_effort；**fire-and-forget**（见下方能力边界） |
| MCP | ✅ 原生（`~/.cursor/mcp.json` 用户级 / `.cursor/mcp.json` 项目级，project overrides user） | |
| 会话注入 | Rules `.mdc`（项目级）+ Cursor 原生读 AGENTS.md/CLAUDE.md | 用户级无规则文件（Cursor UI 存 User Rules） |
| skills 投影 | `.agents/skills/`（共享） | 工作台级 |
| 生命周期分级 | session-start best_effort / session-end best_effort / fallback manual / crash manual | 见 capabilities.lifecycle |

## 接线（D6 保留不扩；机器级用一条命令）

- **MCP（统一 wire，issue #12）**：`jspace harness wire --harness cursor --dir <workbench>` 幂等写 `~/.cursor/mcp.json` 的 `mcpServers.gbrain`（`command` = 解析出的 gbrain 路径，`args: ["serve"]`，`env.GBRAIN_SKILLS_DIR` 指向工作台 `.jspace/skills`）；已正确则 `already-wired` 不写；写前 backup。等价手动产物：

```json
{
  "mcpServers": {
    "gbrain": { "command": "<gbrain>", "args": ["serve"], "env": { "GBRAIN_SKILLS_DIR": "<wb>/.jspace/skills" } }
  }
}
```

  用户级 `~/.cursor/mcp.json` 或项目级 `.cursor/mcp.json`（project overrides user）。`--dry-run` 预览；Cursor 重启后可能在 MCP 设置里要求审批 server。
- **skills 薄链**：同一条 wire 把官方 skills 链到 `~/.cursor/skills/<name>` → `~/.agents/skills/<name>`（先 `jspace skills install` 物化用户级）；缺链 `jspace doctor` 报 `cursor.skills_unlinked` info。
- **session-start 注入**：至少保证 MCP wiring；如需会话级 context 注入，用 `.cursor/rules/*.mdc`（项目级）或 Rules 文件。项目级 `.cursor/hooks.json`（seed，check into VCS）的 `sessionStart` 事件输出顶层 `{"additional_context":"<text>"}` 注入会话初始上下文——命令为 `jspace context session-start --envelope cursor`（纯命令，无 shell 语法；CLI 内部吞错 exit 0。Cursor 从项目级 + 用户级 `~/.cursor/hooks.json` 多层级加载；用户级可覆盖/追加，但工作台 seed 落项目级）。
- **无 headless**：cron 不能用 cursor 跑（`cron run --harness cursor` → `fail`；`harness wire` 不接受 cursor 之外的 `--harness cursor` 也不会把它当 cron）。

## 能力边界（诚实声明）

- 无 headless CLI → 不参与 cron 无头执行。
- 用户级规则无文件入口（Cursor UI 存 User Rules），全局治理文档接进 Cursor 靠项目级 `.mdc` 指针 + Cursor 原生读 AGENTS.md/CLAUDE.md。
- **`sessionEnd` 已接线但注不回会话**：Cursor 官方声明该 hook 是 fire-and-forget（「响应被记录但不使用」），输入含 `reason`（`completed`/`aborted`/`error`/`window_close`/`user_close`）；seed 用 `--plain` 输出纯文本便于排查。另外 **cloud agent 不加载 `sessionStart`/`sessionEnd`**（云端没有 editor 生命周期的会话边界），只在 IDE 会话里触发——这也是它停在 best_effort 而非 automated 的原因。
- **会话结束不自动写 gbrain**（永远显式）：真实提醒面是 `jspace context turn` 的每会话一次收工轻提示；写回由你说「收工」触发 `memory-writeback`。证据见 JSpace 开发仓库（工作台外部，不随 init 物化）`docs/session-end-hooks.md`。

## 验证

```bash
jspace harness wire --harness cursor --dir . --dry-run   # 预览 ~/.cursor/mcp.json + skills 薄链计划
jspace doctor --dir .          # checkHarness: cursor 无 headless 不触发 bin 检查（非 cron harness）；缺薄链报 cursor.skills_unlinked info
jspace cron run <cron> --harness cursor --dry-run --dir .   # fail("cursor has no headless CLI")
```
