# 工作台 SessionStart hook — 实施计划

## 前置
- **依赖 A（cron-failures-surface）已交付**（`jspace cron check` 命令存在）——先完成 A，再实施本任务。

## 有序清单

1. **schema 核对**：用 `update-config` skill（或 claude-code-guide）确认当前 Claude Code hooks 的 `SessionStart` schema 与「stdout 注入会话上下文」语义；记录到 notes。
2. **模板** `templates/workbench/.claude/settings.json`：SessionStart hook 调 `jspace cron check`（人类可读），带降级（`|| echo`）。按核对后的 schema 写。
3. **AGENTS.md 补强**（templates/workbench/AGENTS.md cron 节）：Claude 自动检查 + 其他 harness 手动 `jspace cron check`；有 needs_attention 先处置。
4. **.gitignore 核对**：模板 `.gitignore` 不排除 `.claude/settings.json`（确认或补一行）。
5. **物化验证**：`jspace init` 临时工作台 → 确认 `.claude/settings.json` 存在且内容正确；`jspace cron check` 在该工作台手跑输出正确。
6. **资产再生成**：gen-assets + build；`bun test` + `tsc` 不破。
7. **真实验证**：在真实工作台（`~/jspace-work`）手跑 hook 命令本体，核对输出；真实 SessionStart hook 触发留给用户环境确认（文档注明）。

## 验证命令

```bash
jspace init /tmp/wb-hook-test        # 物化核对
cat /tmp/wb-hook-test/.claude/settings.json
cd /tmp/wb-hook-test && jspace cron check
bun run scripts/gen-assets.ts && bun run build
bun test && bunx tsc --noEmit
```

## 评审门 / 回滚点

- [门 1] design 评审 → `task.py start`（在 A 交付后）。
- 回滚 = 撤模板改动 + 重跑 gen-assets/build。
