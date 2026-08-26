# issue4 linux apply() 接口地雷(4)

## Goal

消除 linux adapter `apply()` 的接口语义地雷。issue #4 第 4 项,方案 A(收缩端口)。

## 背景与问题

P2-1(issue #3)之后:
- `buildContent()` 生成**单行** crontab 条目(`linux.ts:147–152`)
- 安装路径走 `applyBatch()`,内部用 `crontabBlock(enabled, ...)` 重建**整块**再 `replaceManagedBlock`
- 但 `apply()` 的 create/update 分支仍直接 `replaceManagedBlock(existing, op.content, tag)`
  —— 把"单行 content"当"整块 block"替换进去

若未来有人绕过 `applyBatch` 直接调 `apply({action:"create", content: <单行>})`,
会把本 workbench 的整个 managed block(含 marker、含兄弟 cron)替换成一行无 marker 内容 —— 静默损坏调度。

**已核实**:当前无生产调用(`scheduler-service.ts` 只调 `applyBatch`)、无测试引用(三个 adapter 的
`apply` 仅被 darwin/win32 自己的 `applyBatch` 内部 `flatMap` 委托),所以收缩端口无外部行为影响。

## Requirements

1. **从 `SchedulerAdapter` 接口删除 `apply()`**(`adapters/scheduler/types.ts:65`),接口只保留 `applyBatch` 作为唯一写入端口。
2. **darwin/win32 的 `applyBatch` 内部 per-cron 实现改为私有 helper**(原 `apply` 方法体),不再暴露为接口方法。
3. **linux.ts 删除 `apply()` 方法**,并更新文件头注释,说明「linux crontab 是 whole-file;managed block
   的唯一安全写入路径是 applyBatch」。
4. **同步 `application/automation/use-cases.test.ts` fakeAdapter**:删除 `apply` 属性(类型标注 `SchedulerAdapter`
   会因多余属性报错),applyBatch 内部已有 per-op 的 `onApply` 委托,测试语义不变。
5. 若 `types.ts` 接口注释涉及 apply 的说明,一并更新。

## 不做

- 不改 applyBatch 的整块语义(已正确)。
- 不引入任何行为变更:darwin/win32 的逐 op 安装行为保持不变,仅从"接口方法"降级为"私有 helper"。

## Acceptance Criteria

- [ ] `types.ts` `SchedulerAdapter` 无 `apply` 字段;`applyBatch` 注释完整说明 whole-file 语义
- [ ] darwin/win32 的 applyBatch 行为与改动前一致(per-op 安装,逐 op 报错语义保留)
- [ ] linux.ts 无 `apply`,唯一 crontab 写入路径是 applyBatch;文件头注释说明缘由
- [ ] `grep -rn '\.apply(' adapters/ application/ core/ --include='*.ts'` 仅剩 applyBatch 内部委托,无直接调用
- [ ] bun test 全绿、tsc 通过

## Notes

- 选方案 A(删接口)而非方案 B(修语义):apply 无生产调用、无测试,删除即消除地雷,且接口缩小为
  "一个安全写入路径"的语义更清晰。
