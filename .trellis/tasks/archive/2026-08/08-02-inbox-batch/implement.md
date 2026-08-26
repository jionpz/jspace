# 批量 inbox 整理 — 执行计划

## 实施清单(顺序)

1. **skill 批量模式**:`skills/asset-ingest/SKILL.md` 增「批量模式(整理一下 inbox)」小节 + 新增 `references/batch.md` 细则:
   - 前置定位 inbox(正式根 / 降级暂存区,共享 helper 逻辑)
   - 两遍式(第一遍确定性零提问;第二遍模糊清单)
   - `.processing` 幂等 + 中断续跑
   - 人工排除(skip 清单)+ 处理后纠错(撤销/重跑)
   - 无头模式(只第一遍 + 执行日志)+ 机械校验(计数对比 / 查重预检 / 召回自检贴输出)
2. **CLI `inbox status`**:`cli/cmds.ts` 增 `cmdInboxStatus(json)` + 共享「定位 inbox」helper;`cli/args.ts` 注册 `inbox status` 子命令。
3. **重新生成内嵌资产**:`bun run scripts/gen-assets.ts`(skill 变更后必须)。
4. **文档一致**:`references/filing.md` 无冲突(已含迁移路径);如需要补充批量纪律引用。

## 校验命令(每步)

- `bunx tsc --noEmit`
- `bun run scripts/gen-assets.ts`
- `bun run cli/main.ts inbox status [--json]`(filehub 已注册 + 未注册两种情况)
- 全流程:`init` + `filehub init --register` + 放真实文件 + 会话内批量演练(需 gbrain 环境)
- 回归:`init` + `doctor`;现有单文件路径不变

## 关键风险 / 回滚点

- `assets.generated.ts` 手改会被覆盖:改 skill 后必须 `gen-assets`。
- 无头与人工两模式共用逻辑:把「是否提问/是否写日志」做成一个标志,避免两套实现漂移。
- 批量失败纪律:单文件原子性(该份即停、不留半成品),不整批回滚。
- 回滚:撤销 SKILL.md/batch.md 与 cmds.ts/args.ts 相关 diff + `gen-assets` 重生成。
