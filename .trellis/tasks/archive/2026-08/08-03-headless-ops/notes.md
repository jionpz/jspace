# 无头执行的运维(#3) — 任务记录

## 父任务集成评审（2026-08-03）

三子任务均交付、验收通过、已提交 main：

| 子任务 | 交付 | 验收 | 提交 |
|---|---|---|---|
| A cron-failures-surface | `jspace cron failures`/`check` + `--json` + doctor pending APPLY | 30/30 单测；真实 pending APPLY 浮现、退出码契约、JSON 合法 | `ff24625` |
| B session-start-hook | 工作台 `.claude/settings.json` SessionStart hook + AGENTS.md 补强 | schema 校验；物化出 hook + 指令；降级不 crash | `5defeb1` |
| C quota-ops-docs | `docs/HEADLESS-OPS.md` + AGENTS.md 内联要点 | 文档齐全、零密钥；物化含引用 | `ce1c8fb` |

## 真实运行验证（父任务集成项）

- **成功路径**：真实工作台 `~/jspace-work` 已有 3 次真实 `cron run` 成功（M4 rehearsal：inbox-tidy/weekly-report/memory-consolidate 全 ok，日志在 `.jspace/logs/cron/<id>/`）。
- **失败路径（本次诱导）**：用 codex harness 真实 `cron run fail-probe`（codex 无头 auth 失败 → exit 1）→ `cron-failed.md` 记 `- 2026-08-03T202823 fail-probe exit 1` → `jspace cron check` 列出 failures(1) + pending(1) + fail-probe:failed → **needs_attention 3、exit 1** → `doctor` 摘要 1 failed + 1 pending APPLY。**闭环成立**。
- **探针清理**：fail-probe cron 已 remove、cron-failed 探针行与日志已删，真实工作台恢复干净（只剩真实 pending APPLY）。

## GOAL 开放问题状态

#1/#2/#4 已闭（前轮）；**#3 本轮闭合**：失败可见性硬化（cron check + hook + doctor）+ 账号/配额模型（HEADLESS-OPS.md）+ 真实运行验证。**四个开放问题全部闭合**。

## 遗留 / 待办

- 真实 SessionStart hook 触发：模板已交付 + 命令本体已验证；本机真实工作台需在新生成的含 hook 的工作台里起 claude 会话确认 hook 触发（工作台已生成的旧实例无 hook，升级需重新 init 或手动补 `.claude/settings.json`）。
- codex 无头 auth 失败（本次探测暴露）→ 是真实配置项（codex 走 cc-switch profile 需无头可用），非本轮范围，记入 HEADLESS-OPS 处置路径即可。
- cron 每日真实定时触发（非 rehearsal 手动 run）尚未自然观察到——等 launchd 真实调度。

## 过程发现

- **暂存写路径 `.jspace-logs/`（连字符）**：初版扫 `.jspace/logs` 漏扫，真实 pending 不浮现 → 修正（A 的 notes）。
- **改 templates/ 后必 gen-assets + build 再测物化**：旧 bin 不嵌新资产 → 物化失败（B 的 notes，M4 纪律复发）。
- **仓库 `.claude/` gitignore 吞模板**：定向 negation 放行 `templates/workbench/.claude/settings.json`。
