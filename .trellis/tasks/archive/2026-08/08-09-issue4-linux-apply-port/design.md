# issue4 linux apply() 接口收缩 — 设计

## 目标

把 `SchedulerAdapter.apply()` 从接口删除,使 `applyBatch` 成为唯一写入端口,消除 linux
「单行 content 被当整块 block 替换」的接口地雷。

## 影响面(已核实)

| 文件 | 现状 | 改动 |
|---|---|---|
| `adapters/scheduler/types.ts:65` | `apply(op, tag, root, env): string[]` 接口声明 | 删除该字段 |
| `adapters/scheduler/linux.ts:164–187` | `apply()` create/update 分支 `replaceManagedBlock(existing, op.content, tag)` ← 地雷 | 删除整个 `apply` 方法 |
| `adapters/scheduler/darwin.ts:145–163` | `apply()` 实现;`applyBatch` 内 `this.apply` 委托 | `apply` → 模块级私有 `applyOne`;`applyBatch` 调 `applyOne` |
| `adapters/scheduler/win32.ts:125–136` | 同上 | 同上 |
| `application/automation/use-cases.test.ts:42–45` | fakeAdapter 实现 `apply`(类型标注 `SchedulerAdapter`,多余属性会报错) | 删除 `apply` 属性;`applyBatch` 已有 per-op `onApply` 委托,语义不变 |

**确认无其它引用**:`grep '.apply(' adapters/ application/ core/` 仅命中 darwin/win32 的
`applyBatch` 内部委托;`scheduler-service.ts` 只调 `applyBatch`;`scheduler.test.ts` 无 `apply` 引用。

## 设计决策

### 1. 接口只留 `applyBatch`(types.ts)

删除 `apply` 字段。`applyBatch` 现有注释已说明 whole-file 语义,保留并在 linux 文件头补一句
「managed block 的唯一安全写入路径是 applyBatch」。

### 2. darwin/win32:apply → 私有 `applyOne`

对象字面量里的 `this.apply` 依赖接口方法存在;删除接口后 `this.apply` 不再可调。
把原 `apply` 方法体提取为同文件模块级函数:

```ts
function applyOne(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[] {
  // 原 apply 方法体,不变
}
```

`applyBatch` 改为 `ops.flatMap((o) => applyOne(o, tag, root, env))`。
行为零变化:逐 op 安装、逐 op 报错(plutil lint / schtasks status fail)语义保留。

### 3. linux:删除 `apply`,只留 `applyBatch`

`apply()` 的 delete 分支语义已被 `applyBatch` 覆盖(delete op 不进 enabled set,整块重建时该行
自动消失;空 enabled 则整块移除)。create/update 分支是地雷本体。整个方法删除,无行为损失。
文件头注释补充:「crontab 是 whole-file;本 workbench managed block 的唯一安全写入路径是 applyBatch」。

### 4. fakeAdapter(use-cases.test.ts)

`apply` 属性删除。`applyBatch` 内已 `ops.flatMap(op => { opts.onApply?.(op); ... })`,现有测试的
`onApply` 断言(如 `applied!.action`)全部经由 applyBatch 触发,不依赖 `apply` 字段存在。

## 兼容性 / 回滚

- 纯删除,无新增行为;darwin/win32 对外行为与改动前逐位一致。
- 回滚:git revert 即恢复原接口。
- 风险点:若有漏网的 `apply` 引用,tsc 编译即报错(接口收紧的正面效应),修复路径明确。

## 验证

- `grep -rn '\.apply(' adapters/ application/ core/ --include='*.ts'` → 仅剩 `applyOne` 调用与 `applyBatch` 内部,无 `this.apply` / `.apply(` 直接调用
- `bun test` 全绿(use-cases.test.ts 的 fakeAdapter 改动是关键回归面)
- `tsc` 通过(接口删字段后所有 adapter/调用方编译)
