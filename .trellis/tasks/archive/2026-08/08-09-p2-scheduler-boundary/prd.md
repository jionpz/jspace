# P2-1 scheduler applyOps linux 穿透下沉(路径 A)

## Goal

`scheduler-service.ts:13,42-47` 的 `applyOps` 直接 `import { crontabBlock }` 且对 linux 特判「整块写入 crontab」,application 层知道平台细节,违反 hexagonal boundary;linux adapter 的 `buildContent` 因此只返回占位 `cron.id`(注释自称「placeholder just routes the cron through」)。本任务把 whole-block 语义下沉到 linux adapter。

## Requirements

采用 issue 推荐的路径 A(transparent 端口):**任何调用方都以为 scheduler 是 per-cron 的;linux 的「一个 workbench 的所有 cron 装在一个 crontab block」作为 adapter 内部细节隐藏起来**。具体方向:

- `application/automation/scheduler-service.ts` 删除 `crontabBlock` import 与 `applyOps` 里的 linux 特判分支。
- linux adapter(`adapters/scheduler/linux.ts`)承载 whole-block 语义:
  - `buildContent` 不再返回占位,生成可用的 per-cron 内容(整块由 adapter 在 apply 时以 workbench 维度组装),或按设计文档选定形态;
  - `apply` 的 create/update/delete 正确处理「同一 workbench 的 sibling cron 不受影响」与「全部 disabled → 整块清除」。
- `planReconciliation` 决策表保持不变(desired vs installed per-taskId),但需验证 linux 下 inspect(per-cron 行解析)与 apply(整块)的交互在新形态下仍正确。
- 回归:单 cron enable → 其它 cron 不受影响;全部 disabled → 整块清除(现有测试覆盖,不改变语义);dry-run 输出一致。

**约束**:不改变 darwin/win32 的 per-cron apply 行为;不改变 `SchedulerAdapter` 端口以外的平台知识上浮;cron install/dry-run/uninstall 全链在 verify.yml 中的整链不破坏。

## Acceptance Criteria

- [ ] `scheduler-service.ts` 无 `crontabBlock` import、无 `adapter.platform === "linux"` 特判
- [ ] linux adapter 的 whole-block 语义在 adapter 内部;`buildContent` 不再是无意义占位
- [ ] 回归测试:单 cron enable 不影响 sibling;全部 disabled 整块清除;install/dry-run/uninstall 行为与改造前一致
- [ ] use-cases.test.ts(cronInstall 各 distribution 分支)通过
- [ ] `bun test` 全绿、`tsc --noEmit` 通过

## Notes

- 本任务是复杂架构变更(端口形状 + 交互语义),必须先在 design.md 细化端口形态、再进 implement.md。
- issue 路径 A 内部存在两种表述(inspect 返回单 task vs 保持 per-cron),design 阶段择定一种并说明理由。
