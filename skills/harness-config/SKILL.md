---
name: harness-config
description: "**机器级**多-harness 全局治理接线:检测已装 harness(Pi/Claude Code/Codex/Cursor)、装自身到用户根、建/维护单源治理文档 ~/.agents/agents.md、把各 harness 全局文件(symlink/@import/.mdc 指针)接到它、只读核对会话级配置(gbrain MCP/注入/hooks)。Use when 配置 harness、统一多-harness 入口、全局治理文档缺失/陈旧。Do NOT use for 单个 JSpace 工作台首配(→jspace-use)。"
triggers:
  - "configure harness"
  - "harness config"
  - "global governance"
  - "multi-harness"
  - "wire harness"
  - "agent memory setup"
---

# harness-config — 多-harness 全局治理接线(机器级)

给本机**所有** AI harness 接线到单一事实源治理文档(`~/.agents/agents.md`)。**按 Phase 顺序执行,跳过未装 harness,末尾报 checklist**。

> **命名**:`~/.agents` = **用户根目录**(`$HOME/.agents`),与本仓库项目级 `.agents/` 不同,勿混淆。
> **符号**:`$SKILL_DIR` = 本 skill 目录;`<gbrain>` = 按 `$GBRAIN_BIN`→`command -v gbrain`→`~/.bun/bin/gbrain` 解析。

## 何时用 / 何时不用
- ✅ 用:机器级统一多-harness 入口 / 建维护 `~/.agents/agents.md` / 某 harness 全局上下文缺失或陈旧。
- ❌ 不用:配单个 JSpace 工作台(gbrain 记忆库 + 注册表 + 单 harness 接线)→ `jspace-use`。本 skill 是**机器级全局**,不随工作台物化(需要时按 Phase 1 自装到 `~/.agents/skills/`)。

## 决策表

| 判断 | 取值 | 动作 |
|---|---|---|
| harness state(`detect.sh`) | installed / config_only / not_found | 接线 / 向用户确认后决定 / 跳过 |
| 治理文档 `~/.agents/agents.md` | 不存在 / 已存在 | 用 `references/governance.md` 骨架创建 / review 分层 + 确认红线最高优先级 |
| 既有全局文件非空 | 是 / 否(空 stub/不存在) | **不覆盖**:并入治理文档或保留+附加接线,二选一说明 / 直接 symlink |
| Phase 4 会话级配置 | wired / missing / n/a | **只核对报告,不改既有配置** |

## 命令速查

```bash
bash "$SKILL_DIR/scripts/detect.sh"       # 检测已装 harness(TSV: harness/binary/config_dir/state)
# 装自身到用户根(幂等,不覆盖本地已改文件)
rsync -a --ignore-existing "$SKILL_DIR"/. "$HOME/.agents/skills/harness-config/"
# Phase 5 验证
ls -la "$HOME/.agents/agents.md"
ls -la "$HOME/.pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md" "$HOME/.claude/CLAUDE.md"
```

## Phase 骨架(顺序执行)

0. **Detect**:跑 `detect.sh`;installed 接线 / config_only 确认 / not_found 跳过。前提:至少一个 installed。
1. **Install self**:幂等装到 `~/.agents/skills/harness-config`(补缺不覆盖本地改动)。
2. **治理文档**:`~/.agents/agents.md` 不存在则用 `references/governance.md` 骨架建;已存在则 review 内容分层(harness 无关规则进、MCP/hooks/注入不进)+ 确认安全红线最高优先级。
3. **Wire installed**:对 installed 的每个 harness 按 `references/harnesses.md` 接线(全局文件 → `~/.agents/agents.md`);幂等带守卫,不覆盖非空既有文件。逐 harness 报 wired/skipped/already-OK。
4. **Config check(只读)**:核对 gbrain MCP/CLI、session-start 注入、hooks,三态 wired/missing/n/a。**不改既有配置**;密钥卫生(只报名称状态,不回显令牌)。
5. **Verify + report**:文件层验证(+ Claude Code 内容层 `/context`);两维词汇分清(接线状态 vs 配置核对状态)。

## 按需深入(条件读指针)

- 逐 harness 接线命令(幂等守卫 / symlink / @import / .mdc / Codex override)+ 跨平台路径 + lifecycle 矩阵 → `references/harnesses.md`
- 治理文档骨架模板 + 内容分层表 + 回滚 → `references/governance.md`
- harness 检测逻辑 → `scripts/detect.sh`

## Golden run

端到端范例(detect → 建治理文档 → 接线一个 harness → 核对 → 验证)见 `references/example-harness-config.md`。

## 自检(做完跑这条)

```bash
ls -la "$HOME/.agents/agents.md"                              # 治理文档在
readlink "$HOME/.claude/CLAUDE.md"  # 或对应 harness 入口     # symlink 指向治理文档
bash "$SKILL_DIR/scripts/detect.sh"                           # 各 harness state 与报告一致
```
(Claude Code 内容层:新会话 `/context` 确认治理文档出现在 Memory files)

## 参考
- `references/harnesses.md` — 逐 harness 接线 + 跨平台路径 + lifecycle 矩阵
- `references/governance.md` — 治理文档骨架 + 内容分层 + 回滚
- `scripts/detect.sh` — 检测已装 harness
- `references/example-harness-config.md` — golden run(S5 产出)
