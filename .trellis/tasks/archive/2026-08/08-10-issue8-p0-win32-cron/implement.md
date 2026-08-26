# Implement: Win32 cron 任务名错位（#1）

## 前置

- [x] 父任务 `08-10-issue8-review-fixes` 已建，本子任务 prd.md + design.md 已评审通过。

## Ordered Checklist

1. **修 `adapters/scheduler/win32.ts`**：
   - 加模块级 `win32TaskName(tag, cronId)` 助手（`JSpaceCron_${tag}_${cronId}`）。
   - `identity()` 的 `taskId` 改用 `win32TaskName`。
   - `buildContent()` 的 `/tn` 改用 `win32TaskName(tag, cron.id)`。
   - （可选，低风险）`inspect()` cronId 切分 / `queryTasks` 前缀复用 `win32TaskName` 长度，去掉第二处手写拼接。
2. **改 `adapters/scheduler/scheduler.test.ts`**：
   - 新增 T1 回归（buildContent `/tn` === identity().taskId，DAILY+WEEKLY）。
   - 改造 P0 收敛测（T2）：content 改由 `win32Adapter.buildContent()` 产出。
3. **`application/automation/scheduler.test.ts`**：新增 T3（buildDesired content `/tn` === desired.taskId，win32 adapter）。
4. **验证**：
   - `bunx tsc --noEmit`
   - `bun test adapters/scheduler/scheduler.test.ts application/automation/scheduler.test.ts`
   - 全量 `bun test`（确认无意外回归）。
5. **收尾**：prd 验收项逐条打勾；prd Notes 记录一次性迁移提示（旧点形式孤儿任务手动删除）；提交信息 `fix(scheduler): P0 — Win32 cron 任务名与 identity/inspect 统一 (issue #8 #1)`。

## Validation Commands

```bash
bunx tsc --noEmit
bun test adapters/scheduler/scheduler.test.ts application/automation/scheduler.test.ts
bun test   # 全量，防回归
```

## Review Gates

- [ ] T1/T2/T3 全绿；T2 在修复前代码上应红（先写测后修复，或修后验证回归有效）。
- [ ] `tsc` 0 错误。
- [ ] darwin/linux 测试未受影响。

## Rollback Points

- 单文件改动 + 测试，无状态迁移；出问题直接 revert 本批提交即可。旧点形式孤儿任务不因 revert 消失（一次性手动清理），已在 prd Notes 记录。
