# 设计：数据一致性修补（fix-reliability）

## 总览

6 项修补，全部对齐项目「原子写 + 失败补偿 + 无假成功」纪律。每项改动小、可独立验证。

## 变更清单

### R1. failIngest 标记碰撞（P2，已核验）
- **根因**：`failIngest` 记 `failedStep = NEXT_STEP[j.status]`；`NEXT_STEP["index"]="committed"` 与 `isCleanupPending`（`failed/failedStep==="committed"`）碰撞 → 失败的 index 步被谎报 cleanup-pending，`--complete` 会误删源并写假 committed。
- **修法**：`failedStep` 改记「最后完成的步」= `j.status`（永不产出 "committed"）。`isCleanupPending` 保持只认 "committed"（现仅由 `completeIngest` 产生 → 语义收紧为真 cleanup-pending）。
- **联动**：
  - `application/ingest/use-cases.ts:108` 提示 `if (j.failedStep === "gbrain")` → `"staged"`（补偿恰在 status==="staged" 时发生）。
  - 测试更新：journal.test.ts:141 `"gbrain"`→`"staged"`；:155 `"index"`→`"gbrain"`；**改写 :344-361**（原测试把碰撞固化为预期，改为断言修复后行为：fail-at-index → failedStep "index"、非 cleanup-pending、`--complete` 拒绝、源未删、可重新 begin）。
  - use-cases.test.ts 的 cleanup-pending 测试走 `ingestAdvance --complete`（genuine），不受影响。
- **行为**：`--complete` 对 plain-failed 拒绝（`completeIngest` 仅接受 status "index" 或 cleanup-pending）；恢复路径 = 重新 `ingest begin`（新 journal，源在 inbox）。

### R2. run/incident 原子写（P2）
- `application/automation/runs.ts:31` `writeRun`、`application/automation/incidents.ts:56` `writeIncident`：`writeFileSync` → `writeBytesAtomic`（import `adapters/fs/workbench-state.ts`，与 ingest/pending 同款）。原子写使截断不可能；reader 的静默跳过保留为纵深防御（真实损坏文件仍被跳过，不再因截断产生）。

### R3. applyPending TOCTOU + 空页（P2）
- `application/pending/apply.ts:43`：`existing.ok && existing.content !== undefined` → `&& existing.content !== ""`（空内容页视为无内容，允许写入，消除「空页被误判冲突」）。
- TOCTOU：gbrain.put 为外部 CLI，无法本地 CAS → 加注释文档化「get→put 非原子、单用户本地 CLI 限制；并发外部写入不保证」。

### R4. cron 日志秒级文件名（P2）
- `application/automation/execute.ts:189`：`runId` 提前生成，日志名 `localStamp()-runId前8位.md`，同秒两次运行不互相覆盖。`writeRun` 复用同一 runId。

### R5. dry-run hub 迁移误报（P3）
- `application/workspace/workspace.ts` dry-run 分支：仅当 `hubMigration.outcome.status === "migrated"` 才加 `[migrate]` 并计入文件数；`no-migration` 改为 `[manual]` 注记（不计入，提示真实 upgrade 将拒绝）——dry-run 与真实路径结论一致。
- 真实路径（:183-187 no-migration fail）不变。

### R6. init --force 覆盖披露/备份（P2）
- `application/workspace/init.ts`：force 时，materialize 前用 `deps.manifest.files` → `materializedRel` 枚举模板目标 rel，对 target 下已存在的**文件**（`statSync.isFile`）备份为 `<rel>.jspace-bak`（对照 install.sh rc 备份），输出行报告「backed up N file(s)」。空目录正常 init 不受影响。
- `cli/embed.ts` materializeTree 不改（备份在前，材料化照旧写）。

## 不做

- 不改 runs/incidents 的 reader 静默跳过（原子写已消除截断根因）。
- 不给 gbrain 加 CAS（外部系统，超范围；注释文档化）。
- 不改 `ingest list`/`status` 的 cleanup-pending 文案（genuine 路径不变）。

## 测试计划

- 改写 journal.test.ts:344-361（fail-at-index 不再 cleanup-pending）+ 更新 :141/:155。
- 新增：fail-at-index 后 `--complete` 拒绝 + 重新 begin 可恢复（并入改写测试）。
- 新增 workspace.test.ts dry-run no-migration 用例（dry-run 不再谎报 [migrate]，标 [manual]）。
- 新增 apply.test.ts 空页用例（空内容页可写入，非 terminal）。
- R2/R4/R6 以现有测试套件回归（原子写/日志名/init 不破坏既有）。

## 验证

- `bunx tsc --noEmit` + `bun test` 全绿。
- 无模板改动 → gen-assets 门禁不受影响（仍跑确认）。
- 工作树干净、diff 仅限预期文件。
