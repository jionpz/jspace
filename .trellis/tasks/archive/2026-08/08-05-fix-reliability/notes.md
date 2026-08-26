# Notes · 数据一致性修补（fix-reliability）

## 完成（2026-08-05，提交 `e916532`，11 文件 106+/33-）

**R1 failIngest 标记碰撞**（关键）：`failedStep` 改记 `j.status`（最后完成的步），永不产出 "committed"；cleanup-pending（`failed/failedStep=committed`）收紧为仅 `completeIngest`（源删除存疑）产生。失败 index 步 → 非 cleanup-pending、`--complete` 拒绝强制提交、源留 inbox（可重新 begin 恢复）。删除了不再使用的 NEXT_STEP 表。联动：use-cases 提示条件 gbrain→staged；改写 journal.test.ts:344-361（**该测试原先固化 bug**：断言 fail-at-index→cleanup-pending→complete 收敛，现改为断言修复后行为）+ 更新 :141/:155 两处断言。

**R2 run/incident 原子写**：`writeRun`（runs.ts）/`writeIncident`（incidents.ts）→ `writeBytesAtomic`；reader 静默跳过保留为纵深防御。

**R3 applyPending 空页**：空内容页（`content === ""`）视为无内容可写（原被误判「已存在不同内容」→ terminal）；get→put 非原子限制注释文档化（gbrain 外部 CLI，无 CAS，超范围）。

**R4 cron 日志文件名**：含 runId 前 8 位（`<stamp>-<runid>.md`），同秒两次运行不互相覆盖。

**R5 dry-run hub 迁移**：仅 `migrated` 列 `[migrate]` 并计入；`no-migration` 标 `[manual]` 不谎报（原 dry-run 显示将自动迁移而真实 upgrade 拒绝）。

**R6 init --force 防护**：force 时碰撞模板文件备份 `<rel>.jspace-bak`（statSync.isFile 守卫）+ 结果行披露。空目录正常 init 不受影响。

**测试**：277 pass（+2：apply 空页、workspace dry-run no-migration）；tsc + gen-assets 门禁绿；git 干净。

## 验证

- `bunx tsc --noEmit` 绿；`bun test` 277 pass。
- gen-assets 确定性 gate 绿；工作树干净。

## 遗留

- `ingest list`/`status` 对 plain-failed 的展示文案未改（genuine cleanup-pending 路径不变）。
- 恢复路径「重新 begin」会在 journal 留历史 failed 记录（预期，有据可查）。
