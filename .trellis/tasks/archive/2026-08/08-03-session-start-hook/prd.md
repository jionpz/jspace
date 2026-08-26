# 工作台 SessionStart hook 硬化会话检查

## Goal

把「下次会话检查 cron 失败 + pending 暂存写」从 AGENTS.md 文档指令升级为**自动执行**：工作台模板加 Claude Code SessionStart hook，会话启动即跑 `jspace cron failures` 并把需关注项注入会话上下文；AGENTS.md 指令同步补强（含非 Claude harness 的兜底）。**依赖子任务 A**（`08-03-cron-failures-surface`，hook 调用其命令）。

## Requirements

- **模板新增** `templates/workbench/.claude/settings.json`：`hooks.SessionStart` 注册一条 command hook，运行 `jspace cron failures --json`（或 A 定的命令），stdout 注入会话上下文。
  - 无失败 + 无 pending → 输出一句「cron 正常」或空（不打扰）。
  - 有需关注 → 输出简明列表（失败 + pending APPLY）。
  - jspace 不在 PATH / 命令不存在 → hook 输出优雅错误或空，**不 crash 会话**。
- **AGENTS.md 指令补强**（templates/workbench/AGENTS.md cron 节）：明确「Claude Code 由 SessionStart hook 自动检查；其他 harness 在会话开始手动跑 `jspace cron failures`」。
- **物化验证**：`jspace init` 生成的临时工作台含 `.claude/settings.json`，且 hook 命令可执行、注入生效。
- **依赖顺序**：A 交付后再实施本任务（hook 依赖 `cron failures` 命令存在）；若 A 未就绪则阻塞。
- 纪律：改动 templates/ 后重跑 gen-assets + build。

## Acceptance Criteria

- [ ] 模板 `.claude/settings.json` 物化进生成工作台；hook schema 合法（Claude Code 可识别）。
- [ ] 在生成的工作台里启动 claude 会话，SessionStart hook 输出失败/pending 摘要注入上下文（需手动或脚本验证 hook 命令本身输出正确；真实 hook 触发由用户环境确认）。
- [ ] AGENTS.md 补强说明就位（Claude hook 自动 + 其他 harness 手动兜底）。
- [ ] hook 失败不 crash 会话（jspace 缺失时的降级路径）。
- [ ] gen-assets + build 同步；既有测试不破。

## Notes

- 依赖：`cron-failures-surface`（A）交付的 `jspace cron failures` 命令；本任务实施前 A 必须已完成。
- hook 为 Claude Code 特有（workbench 支持多 harness）；非 Claude harness 靠 AGENTS.md 指令兜底——这是有意的 harness 差异，不是缺陷。
- Claude Code SessionStart hook 配置在 `.claude/settings.json`；stdout 作为会话上下文注入。hook 在项目根（cwd=工作台）运行，`jspace` 需在 PATH。
