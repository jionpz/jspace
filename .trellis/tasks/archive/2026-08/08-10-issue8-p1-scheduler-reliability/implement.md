# Implement: 调度可靠性三件套（#5 + #6 + #7）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

### #6（inbox 批次守卫）— `application/automation/execute.ts:232-236`
1. `batchChanged` 初始 `true` → inbox 任务当 `batchLog === null` 或文件不存在时强制 `false`。
2. `application/automation/execute.test.ts` 加 4 用例：
   - 无 filehub → `batch-stale`；
   - filehub 但文件未出现 → `batch-stale`；
   - 文件存在未更新 → `batch-stale`；
   - 正控制：fake harness 追加 batch 文件 → `ok`。

### #7（acquireLock 毒锁）— `application/automation/lock.ts`
3. 加 `isEexist` helper（code 或 message 兜底）；`acquireLock` 重构：`created` 标志 + 非 EEXIST 时清毒锁重抛 / EEXIST 走 stale 检查。
4. `application/automation/lock.test.ts` 加用例：`writeSync` 抛 `code:"ENOSPC"` → toThrow + `fs.files` 空（毒锁清掉）；现有 EEXIST 用例保持绿。

### #5（spawn 超时终止）— `adapters/process/spawn.ts`
5. `SIGKILL_GRACE_MS = 3000` + `SpawnOpts.killGraceMs?`；timer 置 `killed` + SIGTERM → 宽限 SIGKILL（POSIX）/ taskkill（win32）；`timedOut = killed`。
6. `adapters/process/spawn.test.ts` 加 POSIX 限定用例：忽略 SIGTERM harness（小 timeoutMs+killGraceMs）→ SIGKILL、`timedOut === true`、exit ≠ 0；正常快速退出 → `timedOut === false`。

### 验证
7. `bunx tsc --noEmit`
8. `bun test application/automation/execute.test.ts application/automation/lock.test.ts adapters/process/spawn.test.ts`
9. 全量 `bun test`

## Validation Commands

```bash
bunx tsc --noEmit
bun test application/automation/execute.test.ts application/automation/lock.test.ts adapters/process/spawn.test.ts
bun test   # 全量
```

## Review Gates

- [ ] #6 三组 batch-stale 用例改前红（现状记 ok）→ 改后绿。
- [ ] #7 毒锁用例：`acquireLock` 抛错（非 null）+ 毒锁被清。
- [ ] #5 忽略 SIGTERM 用例快速返回（SIGKILL 生效）。
- [ ] 既有 timeout（`sleep 30`）、lock stale、suspect 用例不回归。
- [ ] tsc 0 错；全量 `bun test` 绿。

## Rollback Points

- 三处均为局部改动 + 测试，无状态迁移；出问题 revert 本批提交即可。
- `SIGKILL_GRACE_MS`/`killGraceMs` 只影响超时终止路径，不影响正常退出。
