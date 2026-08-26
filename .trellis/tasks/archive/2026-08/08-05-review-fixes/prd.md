# 评审修复：P0 红线 + cron 收敛 + 可靠性 + 测试 + 文档

## Goal

执行 `08-05-project-review` 评审报告的修复。父任务持有需求地图、子任务映射、跨子任务验收与最终集成验证；5 个子任务独立计划/实现/验收/归档。

## Requirement Map（来自 report.md）

| # | 子任务 | 覆盖报告项 | 严重度 |
|---|--------|-----------|--------|
| 1 | `fix-p0-redline` | GOAL.md 真实数据泄漏（P0）+ example-recall.md 30GB 连带 | P0 |
| 2 | `fix-cron-convergence` | win32 install 构造损坏（P1）/ doctor 身份漂移（P1）/ linux tag 下标 + no-op（P2）/ delete-only 地雷（P2）/ cron.json 原子写（P2）/ darwin env.home + unknown tag（P3） | P1 |
| 3 | `fix-reliability` | failIngest 标记碰撞 / run·incident 原子写 / applyPending TOCTOU+空页 / 日志秒级文件名 / dry-run hub 迁移误报 / init --force 覆盖披露 | P1 |
| 4 | `fix-test-coverage` | doctor / cron 用例 / filehubInit / darwin adapter / handler 接线 零覆盖 | P2 |
| 5 | `fix-docs-spec` | PLATFORMS.md / workbench README / AGENTS.md 刷新死路 / spec（目录结构·测试数·层环）/ README 真实路径占位 | P2 |

## Constraints

- 每项修复必须回归测试（补/改单测），并跑全量 `bunx tsc --noEmit` + `bun test`。
- cron/ingest/pending 行为契约不可破坏（idempotent no-op、ownership 三态、cleanup-pending 语义）。
- 改动模板或 skills 后必须重跑 `scripts/gen-assets.ts` 并 `git diff --exit-code cli/*.generated.ts`。
- 不引入真实个人/项目数据到示例（中性占位纪律）。
- P0 历史改写：filter-repo 在临时分支/克隆执行，force push 由用户在终端手动确认（红线）。
- 层依赖纪律：应用层不 import cli；修复不得扩大层环。

## Cross-child Acceptance（父任务）

- [ ] 5 个子任务全部实现且各自 `bun test` / `tsc --noEmit` 通过。
- [ ] `git diff --exit-code cli/*.generated.ts` 通过（gen-assets 确定性）。
- [ ] 复扫红线：`grep -riE '30GB|梯度公式|jspace-work' . --include=*.md --include=*.ts --include=*.jsonl --include=*.yml` 无真实数据残留（除 git 历史）。
- [ ] doctor 真机回归：macOS 上 `cron add → cron install → cron doctor` 无「enabled but not installed」误报（在可用 workbench 验证）。
- [ ] 全量 CI 门禁绿：tsc + test + gen-assets determinism + build。

## Notes

- 执行顺序建议：1（P0）→ 2（cron 收敛）→ 3 → 4 → 5；但子任务可独立推进，无硬依赖（若同时改 cli/cron.ts 身份与 cron 测试，先收敛代码再补测更稳）。
- 每个子任务验收以各自 prd.md 为准；父任务在全部归档后做最终集成复验。
