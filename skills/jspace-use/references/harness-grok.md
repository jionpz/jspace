# Grok Build 接线参考（T1 桥接）

> Grok Build 有**原生 memory 子系统**（`~/.grok/memory/` markdown + SQLite hybrid search、`/flush`、`/dream`），但按 **D1/B 决策**：gbrain 保持权威，Grok native memory 只是 Grok 内 UX、不参与 gbrain slug 生命周期。本工作台对 Grok 的接线 = Claude 接线的近似（hook 事件集对齐）+ bridge（PreCompact/收工时机注入提醒、由用户显式触发写回）。与 `harness-config` skill 的机器级接线分工：本文档是 JSpace 工作台对 Grok Build 的支持声明。
> `<gbrain>` = gbrain 二进制绝对路径（`$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain`）。

## 支持面（capsules：capabilities.grok）

| 维度 | 值 | 说明 |
|---|---|---|
| cron 无头 | ✅ `harness: grok`（argv `grok -p <prompt> --output-format json --allow Bash(*)`） | argv 组装有单测（`adapters/harness/grok.test.ts`）；**无头执行需本机 grok，CI 未全链验证** → best_effort |
| 会话 hook | ✅ SessionStart / UserPromptSubmit / PreCompact / SessionEnd（`.grok/hooks/jspace.json`，四个事件） | best_effort（真实触发需 Grok 会话，**未实测**——见下方「待真实 Grok 验证」） |
| MCP | ✅ 原生（`~/.grok/config.toml` `[mcp_servers.gbrain]`） | 格式与 codex/claude 一致 |
| skills 投影 | `.grok/skills/`（工作台级）+ `.agents/skills/`（共享） | init/upgrade 物化 |
| native memory | ⚠️ `full`（experimental，默认关） | gbrain 仍权威（D1/B）；Grok native 只是 UX |
| 生命周期分级 | session-start best_effort / session-end best_effort / fallback manual / crash best_effort | 见 capabilities.lifecycle |

## 接线（init 后现状）

- **hooks**：`templates/workbench/.grok/hooks/jspace.json` seed 四事件：
  - `SessionStart`（matcher `startup|clear|compact|resume`）→ `jspace context session-start`
  - `UserPromptSubmit` → `jspace context turn`
  - `PreCompact` → `jspace context pre-compact`（timeout 30；**被动注入**「快 compaction 了，如有需记忆的事实请显式收工」——D2/方案 a，不自动写 gbrain）
  - `SessionEnd` → `jspace context session-end`（结算提醒，同样不自动写）
- **skill 投影**：`.grok/skills/`（与 `.claude/skills/` 并列，机器托管）。
- **wire**：`jspace harness wire --harness grok` 把 `GBRAIN_SKILLS_DIR=<wb>/.jspace/skills` 注入 `~/.grok/config.toml` 的 `[mcp_servers.gbrain]` env（TOML 最小行编辑，保留其余字节；需已存在 gbrain MCP server）。

## hook 双写权衡（已知，显式接受）

Grok Build 兼容扫描可能同时读 `.claude/settings.json`（现存 SessionStart/UserPromptSubmit）。若双触发，去重靠 `jspace context session-start` 幂等（非工作台/钩子关 → exit 0 零输出）。模板只写 `.grok/hooks/jspace.json` 一处，不复制到 `.claude/settings.json`。

## 待真实 Grok 验证（best_effort 边界）

1. hook matcher 语义：`.grok/hooks/jspace.json` 用单字段 `|` 正则（`startup|clear|compact|resume`），Claude 模板是三条独立 matcher——Grok 对单字段正则的语义**未实测**；若 Grok 不认，改多 matcher 条目。
2. SessionEnd / PreCompact 真实触发、`.claude` 兼容扫描是否双触发——未实测。
3. `harness wire` 的 `~/.grok/config.toml` 实际格式（本机无 grok，TOML 按 `[mcp_servers.gbrain]` + env 推断）。

## 验证

```bash
jspace doctor --dir .          # checkHarness: 活跃 grok 二进制在 PATH 检查
jspace cron run <cron> --harness grok --dry-run --dir .   # argv = grok -p ... --allow Bash(*)
jspace harness wire --harness grok --dir .                # 无 config.toml -> error; 有 -> 合并 env
```
