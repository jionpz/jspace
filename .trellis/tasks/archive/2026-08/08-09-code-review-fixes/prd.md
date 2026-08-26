# Issue #2: Code Review 一致性 / 正确性 / CI 缺口修复(20 项)

## Goal

2026-08-09 全仓审查发现 20 个问题点(GitHub issue #2),分 5 个可独立交付的批次修复。已过 `bun test`(409/0 fail)与 `bunx tsc --noEmit` 基线。目标:全部修复后 **issue 关闭**,`bun test` + `tsc` 全绿,仓库 0 warning,不留死链 / 过期注释 / 静默丢数据路径。

## Task Map

| 子任务 | 范围 | 优先级 | 对应 issue 项 |
|---|---|---|---|
| 08-09-p0-correctness-deadlinks | 正确性 / 死链 | P0 | P0-1 ~ P0-4 |
| 08-09-p1-ci-gaps | PR CI 缺口 | P1 | P1-1 ~ P1-3 |
| 08-09-p2-data-integrity-refactor | 数据完整性 + 长函数拆分 | P1 | P2-6 / P2-2 / P2-4 |
| 08-09-p2-architecture-cleanup | 架构清净 | P2 | P2-1 / P2-3 / P2-7 |
| 08-09-p3-p4-docs-structural | 文档 / 脚本质量 + 结构观察 | P2 | P3-1 ~ P3-4 / P4-1 / P4-2 |

## Requirements

- 每个子任务独立可验证:各自 prd.md 定义 Requirements + Acceptance Criteria。
- 全部修复保持仓库既有约定(memory: jspace-cli-assets-regeneration — 改 `templates/workbench/` 后必须重跑 `gen-assets.ts` 同步嵌入式资产)。
- 仓库 PUBLIC:示例 / 文档一律中性占位(acme/12800/~/filehub),issue 内容本身不含真实数据,继续遵守。
- 修复期间不改 public API 契约对外形态(CLI 输出格式 / 命令签名)除非子任务 AC 明确要求;P2 架构重构需保持全部既有测试绿。

## Acceptance Criteria

- [ ] 5 个子任务全部按各自 AC 完成并 `task.py finish`。
- [ ] 全仓 `bun test` 全绿(≥409 用例,新增回归用例)。
- [ ] `bunx tsc --noEmit` 无错。
- [ ] 主工作台 `~/jspace-work` doctor 0 warning 保持(若有 behavior 变化需回归验证)。
- [ ] `.trellis/tasks/08-09-code-review-fixes` 全部子任务完成。
- [ ] GitHub issue #2 由 jionpz 复核后关闭(本任务结束前不自行 close)。

## Ordering / Dependencies

1. p0 → p1 → p2-data-integrity → p2-architecture → p3-p4(按 issue 建议顺序,含依赖:P2-3 依赖 P2-4 的 doctor 拆分结果、P1-3 与 P2-1 都动 scheduler 契约,先 P1-3 后 P2-1)。
2. 每批次完成后跑 `bun test` + `tsc`,红则回退到该批次起点。

## Notes

- P4-1(.trellis/ dead weight)是结构性观察,**需要用户决策**删除/保留——本任务正用 Trellis 管理,删除与「使用 Trellis」矛盾,倾向「保留并记录结论」;子任务 prd 中标注为决策项而非强制删除。
- 修改 `templates/` 相关后必须重跑 `scripts/gen-assets.ts` 并同步版本/模板哈希(见 memory: jspace-cli-assets-regeneration)。
- 大改动每批次独立 commit,避免 20 项挤在一个 commit 里难以 review。
