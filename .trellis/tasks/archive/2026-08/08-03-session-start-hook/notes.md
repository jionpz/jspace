# 工作台 SessionStart hook — 任务记录

## 交付物
- `templates/workbench/.claude/settings.json`（新增）：Claude Code SessionStart hook，运行 `jspace cron check 2>/dev/null || echo '[jspace] cron check unavailable...'`（timeout 30）。
- `templates/workbench/AGENTS.md` cron 节补强：Claude Code 由 hook 自动检查；其他 harness（pi/codex/cursor）手动 `jspace cron check`。
- `.gitignore`：仓库根 `.claude/` 仍忽略（本仓库 harness 配置），定向 negation 放行 `templates/workbench/.claude/settings.json`（模板资产必须提交）。
- `cli/assets.generated.ts`：再生成（20 文件，含 .claude/settings.json）。

## 验证（2026-08-03）
- update-config skill 核对 schema：`hooks.SessionStart` → 组数组 → `{ hooks: [{ type: "command", command, timeout }] }`；matcher 可选；stdout 注入会话上下文；hook 失败不 crash 会话。
- `jq` schema 抽查通过；`jspace init` 物化出 `.claude/settings.json` + AGENTS.md 含 `jspace cron check` 指令。
- 临时工作台手跑 hook 命令本体（`cron check`）正常。
- `bun test` 30/30、`tsc` 干净、build 成功。

## 关键发现 / 修正
- **物化首次失败**：bin/jspace 是旧 build（创建模板前编译），未嵌新资产 → 按 M4 纪律重跑 gen-assets + build 后正确。教训：改 templates/ 后必须立即 gen-assets + build，再测物化。
- **仓库 .gitignore 的 `.claude/` 会吞掉模板文件**：本仓库 `.claude/` 是本仓库自己的 harness 配置（agents/hooks/skills/settings），必须保持忽略；用定向 negation `!templates/workbench/.claude/` 放行模板。

## 备注
- hook 为 Claude Code 特有；非 Claude harness 靠 AGENTS.md 指令兜底（有意的 harness 差异）。
- 真实 SessionStart hook 触发由用户环境确认（本机未在该工作台起 claude 会话验证 hook 触发；命令本体已验证）。
