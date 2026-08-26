# 无头执行的运维(#3)：失败可见性硬化 + 账号/配额文档

## Goal

攻坚 GOAL 开放问题 #3（无头执行的运维：账号/配额、失败通知）。已有底座（M3）：`cron-failed.md` + `cron status` + doctor 摘要 + AGENTS.md 文档指令「会话开始查 status/failed」。本轮把「下次会话检查」硬化（命令 + hook）+ 沉淀账号/配额模型 + 真实运行验证。

## Requirements

- 三个子任务，独立可验收：
  - **A 失败可见性命令**（`08-03-cron-failures-surface`）：`jspace cron failures [--json]`，列最近失败 + pending 暂存写（APPLY.md）+ 状态摘要；doctor 增强。纯 CLI。
  - **B 会话检查硬化**（`08-03-session-start-hook`）：工作台模板加 SessionStart hook（自动跑 A 的命令并注入会话上下文）+ AGENTS.md 指令补强。**依赖 A**（用其命令），依赖顺序写进 PRD。
  - **C 账号/配额运维文档**（`08-03-quota-ops-docs`）：沉淀无头 harness 的账号/配额模型到 docs + 工作台规则。
- 执行顺序：A → B（依赖 A）→ C（独立）；父任务统一集成评审 + **真实运行验证**（cron run 一次核对失败/成功可见性闭环）。
- 遵守纪律：不改 gbrain 锁/embedding 契约；改动 skills/templates 后重跑 gen-assets + build。

## Acceptance Criteria

- [x] 三个子任务各自 PRD/design/implement 评审通过后开工，交付物按各自验收标准核验。
- [x] GOAL.md 开放问题 #3 更新为闭合/缓解（注明结论：失败可见性硬化 + 账号/配额模型 + 真实运行验证结果）。
- [x] 父任务集成验证：真实 `jspace cron run` 一次，核对成功路径日志 + 失败路径（人为制造一次失败，如不可达 prompt 或超时）写 `cron-failed.md` + `jspace cron failures` 能列出 + doctor 摘要。
- [x] 涉及 skills/templates 的改动已同步编译产物（gen-assets + build），git 提交干净。

## Notes

- 现状研究（2026-08-03）：`cron run` 失败 → `appendFailed` 写 `<root>/.jspace/logs/cron-failed.md`（`- <时间>  <id>  <原因>  log: <路径>`，保留 30 行）；每次运行写 `.jspace/logs/cron/<id>/<时间戳>.md`（time/exit/status/timed_out/output）；`cron status` 读每 cron 最后一条（ok/suspect/failed/never run）。gbrain 暂存写落 `<filehub>/.jspace-logs/*.APPLY.md`（如 memory-consolidate-2026-08-03.APPLY.md，当前有 pending 未应用）。AGENTS.md:158 已有「会话开始查 status/failed」文档指令，但无 hook 强制。
- provider 事实（child C 用）：claude 经 cc-switch 本地代理（127.0.0.1:2006）+ failover；`currentProviderClaude` 指向某 provider profile；`~/.claude.json` 无 OAuth/自定义 key → auth 走 cc-switch profile。敏感凭据不触碰。
