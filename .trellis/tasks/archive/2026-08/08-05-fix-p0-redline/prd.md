# P0 红线中性化：真实数据 + 历史改写

## Goal

从公开仓库中移除评审确认的真实个人/客户数据残留：`GOAL.md:87` 与 `skills/memory-recall/references/example-recall.md`（已嵌入 `cli/assets.generated.ts`）。随后执行 git 历史改写（用户已选：改写历史 + force push）。

## Requirements

1. **GOAL.md**：M4 验收记录中「30GB / 梯度公式 / 2 份真实资料 / 真实验收」替换为中性占位（如 12800 / 「示例资料」/「示例验收」），语义保留。
2. **example-recall.md**：`那 30 个 G 的数据怎么搬?` / `约 30GB 存量` 替换为中性数字（如 12800 / 12.8T），上下文占位（领域A/文件.md）保留。
3. 重跑 `scripts/gen-assets.ts`，同步 `cli/assets.generated.ts` 等嵌入资产，`git diff --exit-code cli/*.generated.ts` 通过。
4. 仓库内复扫：grep `30GB|梯度公式|2 份真实资料|jspace-work` 无残留（工作区，不含历史）。
5. **历史改写**：用 git filter-repo（或等价）重写含真实数据的 commit；force push 前由用户在终端手动执行并确认（红线；公开仓库，协作者需重新 clone）。
6. 历史改写期间仓库可被 force push 阻塞（临时安全考虑，用户决策）。

## Acceptance Criteria

- [ ] 工作区无任何真实数据残留（grep 复扫通过，除历史）。
- [ ] `cli/*.generated.ts` 与模板/示例同步（gen-assets 确定性 gate 绿）。
- [ ] 全部测试绿（`bun test`）+ `tsc --noEmit` 绿。
- [ ] 历史改写方案产出并交给用户执行；执行后 `git log` 验证旧提交不再含敏感字符串。
- [ ] 与 fix-docs-spec 无重复（README `~/jspace-work` 占位归 docs-spec，本任务只做真实数据点）。

## Notes

- 只改真实数据相关内容，不改语义结构；GOAL.md 其余内容不动。
- 历史改写是高风险操作：先备份、在临时克隆执行、force push 前必须用户逐条确认。
