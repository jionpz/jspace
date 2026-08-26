# P1: 调度可靠性三件套（issue #8 #5 + #6 + #7）

## Goal

修复 cron 定时轮三个「假成功 / 双跑 / 毒锁」可靠性缺陷：

- **#6** inbox-tidy 批次守卫默认方向写反：`isFile(batchLog)` 为假（无 filehub 或跑完日志文件仍未出现）时整段跳过，`batchChanged` 保持 `true` → harness exit 0 但从未创建/更新 `<filehub>/.jspace-logs/inbox-batch.md` 也记 ok。
- **#5** spawn 超时只发 SIGTERM：harness 忽略 SIGTERM 则 `child.on("exit")` 永不结束 → CLI 挂死、锁不释放 → ~1h 后锁 stale 再起一个 harness（双跑）；`timedOut` 是墙钟比较（`spawn.ts:90`）会把恰在超时后正常退出的 harness 误标 failed。
- **#7** `acquireLock` 把 `openSync("wx")` 成功后 `writeSync`/`closeSync` 抛错（ENOSPC/EIO）当 EEXIST → 0 字节毒锁留盘，`staleMs`（默认 1h）内所有进程 skip。

父任务：`08-10-issue8-review-fixes`。

## Requirements

### #6（inbox 批次守卫）
1. `application/automation/execute.ts:232-236`：inbox 任务在 `batchLog === null`（无 filehub）**或** 跑完后文件仍不存在时强制 `batchChanged = false` → 走 batch-stale 失败分支（openOrUpdate 记 incident），不再假成功记 ok。
2. batchLog 存在且内容/大小有变 → `batchChanged = true`（ok）语义不变。
3. exitCode 语义不变：batch-stale 仍 exit 0（incident 记录类，非 harness 失败），`status==="failed"` 才 exit 1。

### #5（spawn 超时终止 + timedOut 标志）
4. `adapters/process/spawn.ts`：POSIX 超时先 SIGTERM → 宽限期（默认 3s，可注入 `killGraceMs`）→ 仍存活则 SIGKILL 进程组；win32 保持 taskkill /T /F（已强杀）。
5. `timedOut` 改用 timer 回调置位的 `killed` 标志，不再用 `Date.now() - started` 墙钟比较。
6. 忽略 SIGTERM 的 harness 必须能在宽限期后被强杀、`spawnProcess` 返回（不永久挂起）。

### #7（acquireLock 毒锁）
7. `application/automation/lock.ts`：区分 EEXIST（他人持锁 → stale 检查）与其它 errno（open 失败非 EEXIST，或 create 后 write/close 失败）。
8. `openSync("wx")` 成功后写失败（ENOSPC/EIO）→ `unlinkSync` 移除自建毒锁 → 重抛（向调用方暴露真实错误），不留 0 字节锁。
9. EEXIST 语义不变：新锁 skip、stale 锁摘除重试。

## Acceptance Criteria

- [x] #6：execute.test 新增——inbox-tidy + 无 filehub（`batchLog===null`）→ `lastRun.batchChanged === false` + batch-stale incident（改前 batchChanged=true 假 ok）。
- [x] #6：inbox-tidy + filehub 存在但跑完 batch 文件未出现 → `batch-stale` incident。
- [x] #6：inbox-tidy + batch 文件存在且被 harness 更新 → ok（正控制，batchChanged=true 无 incident）。
- [x] #5：spawn.test 新增 POSIX 用例——忽略 SIGTERM 的 harness（`trap '' TERM`）在小 timeoutMs + killGraceMs 下被 SIGKILL，`timedOut === true`、~350ms 返回、exit ≠ 0。
- [x] #5：正常快速退出 → `timedOut === false`、exit 0。
- [x] #7：lock.test 新增——fakeFs `writeSync` 抛 ENOSPC → `acquireLock` **抛错**（非 null）且毒锁被 `unlink`（files 清空）。
- [x] #7：EEXIST（他人持锁）→ 仍返回 null、锁不被触碰（现有用例保持绿）。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 510/510 绿（既有 timeout / lock stale / suspect 用例不回归）。

## Out of Scope（本批不做）

- #4/#3（ingest 越界 / cmd 注入）→ `08-10-issue8-p1-security-paths`。
- #8（pending realGbrain 下沉）→ `08-10-issue8-p1-pending-gbrain`。
