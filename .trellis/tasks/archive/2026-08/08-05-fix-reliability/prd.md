# 数据一致性修补（P2×5）

## Goal

修补评审确认的数据一致性缺陷：错误状态标记、非原子写、TOCTOU、日志碰撞、误导性 dry-run、`init --force` 无披露覆盖。全部对齐项目「原子写 + 失败补偿 + 无假成功」纪律。

## Requirements

1. **failIngest 标记碰撞（P2✅）**：`failIngest` 在 `index` 步失败时 `failedStep=NEXT_STEP["index"]="committed"` 与 `isCleanupPending` 判定碰撞 → 被谎报 cleanup-pending、`--complete` 误删源并写假 committed。修法：`failedStep` 记录「进行中的步」（`j.status`）或新增区分值；`isCleanupPending` 仅由 `completeIngest` 能产生。补回归：index 步失败 → 可重试，`--complete` 不动源。
2. **run/incident 原子写（P2）**：`runs.ts:31` / `incidents.ts:56` 改 `writeBytesAtomic`；reader 不静默吞截断文件（至少 fail loud 或告警）。
3. **applyPending TOCTOU + 空页（P2）**：`apply.ts:42-43` get→put 加 put-if-absent / CAS（或文档化单用户限制）；空内容页视为「无内容」而非冲突覆盖。
4. **cron 日志秒级文件名（P2）**：`execute.ts:189` 日志名并入 run id（`${stamp}-${runId}.md`），同秒两次不互相覆盖。
5. **dry-run hub 迁移误报（P3）**：`workspace.ts` dry-run 对 `outcome.status === 'no-migration'` 不再列 `[migrate]` 步并谎报将升级；与真实路径一致（提示 manual upgrade 或失败）。
6. **init --force 覆盖披露/备份（P2）**：`init.ts:47-49` + `embed.ts:100-102` 在 `--force` 下先检测模板路径碰撞文件：列出「将覆盖 N 个文件」并确认，或备份为 `<name>.jspace-bak`（对照 install.sh 的 rc 备份惯例）。

## Acceptance Criteria

- [ ] 每项修复有针对性回归测试；注入失败/中断不产生损坏状态文件。
- [ ] failIngest：index 步失败后可 retry，`ingest status` 不谎报 cleanup pending，`--complete` 不误删源。
- [ ] applyPending：空页可写入；并发场景（若实现 CAS）不覆盖第三方写入。
- [ ] 同秒两次 cron run 日志不互相覆盖。
- [ ] dry-run 与真实 upgrade 的 hub 迁移结论一致（no-migration 不再显示为将迁移）。
- [ ] `init --force` 覆盖前有披露/备份；`bun test` + `tsc --noEmit` 全绿。
- [ ] 不破坏现有 ingest/pending/workspace 契约（既有测试全过）。

## Notes

- 复杂任务：需 `design.md` + `implement.md` 后 start。
- init --force 涉及 CLI 交互（确认提示），需与现有 `fail()` 交互风格一致。
