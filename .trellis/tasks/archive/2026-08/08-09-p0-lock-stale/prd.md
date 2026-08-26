# P0-5 修复 LOCK_STALE_MS 单位错误

## Goal

修复 `application/automation/execute.ts` 中 stale 阈值单位错误:当前 `opts.timeoutSec * LOCK_STALE_MS_MULTIPLE(2)` 被当作毫秒传给 `acquireLock(staleMs)`,实际是 timeoutSec 的两倍秒数,导致默认 1800s 时 stale 阈值仅 3.6s,cron 启动数秒后即可被新进程抢锁 → **同一 cron 双进程并发运行**。

## Requirements

- `application/automation/execute.ts:37` 常量改名并修正单位语义:`LOCK_STALE_MS_MULTIPLE = 2` → `LOCK_STALE_MS_PER_TIMEOUT_SEC = 2000`(timeoutSec 每秒对应 2000ms stale 容忍度;2x = run 最长持锁 timeoutSec,stale 在 2 倍处)。JSDoc 明确「ms of stale tolerance per second of timeoutSec」。
- `application/automation/execute.ts:204` 调用处同步:`acquireLock(lockPath, token, opts.timeoutSec * LOCK_STALE_MS_PER_TIMEOUT_SEC)`。默认 timeoutSec=1800 → stale 阈值 3,600,000ms(1 小时)。
- 补集成级单测(不只对 lock.ts 参数化):在 `cli/cron.test.ts` 或 `application/automation/execute.test.ts` 用 timeoutSec=1800 模拟「3.6s 时锁应新鲜、1h+ 时应可被抢」,验证单位换算正确。
- 确认其它 acquireLock 调用点无同类问题(已研究确认:全库仅 execute.ts:204 一处;lock.ts 本身 `staleMs` JSDoc 已注明毫秒,无需改动)。

## Acceptance Criteria

- [ ] execute.ts:37 常量已改名 `LOCK_STALE_MS_PER_TIMEOUT_SEC = 2000`,JSDoc 标注单位
- [ ] execute.ts:204 传入 `timeoutSec * LOCK_STALE_MS_PER_TIMEOUT_SEC`(=timeoutSec × 2000ms)
- [ ] 新增集成测试:timeoutSec=1800 时,3.6s 龄锁视为新鲜(返回 skip)、1h+ 龄锁视为 stale(可被抢),断言在 execute 层(非 lock.ts 单测)
- [ ] 全库 grep 确认无第二处 staleMs 单位换算错误
- [ ] `bun test` 全绿、`tsc --noEmit` 通过

## Notes

- 只修单位语义,不改锁的获取/释放语义(lock.ts 不变)。
- 这是正确性回归,优先级最高,第一个实现。
