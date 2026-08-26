# Code Review Round 2 Follow-up: 修复 LOCK_STALE 回归 + 收尾 P2 部分修复

## Goal

修复 GitHub issue #3 列出的全部交付物:1 个正确性回归(P0-5 LOCK_STALE_MS 单位错误)+ 4 项 P2 收尾(P2-6 ingest issues 健康面 / P2-5 decoder helper / P2-1 scheduler 边界 / P2-2 schema 版本统一)+ P3/P4 小清理。完成后关闭 issue #3。

基线 HEAD `24818b3`,bun test 426/0 fail,tsc ✓。

## Requirements

### 交付物地图(6 个子任务)

| 子任务 | Issue 项 | 类型 | 独立验收 |
|---|---|---|---|
| `08-09-p0-lock-stale` | 🔴 P0-5 | 正确性回归 | execute.ts 单位换算正确 + 集成测试覆盖 |
| `08-09-p2-ingest-health` | 🟡 P2-6 | 对称性收尾 | ingest journal issues 进 doctor/context/cron check |
| `08-09-p2-decoder-helper` | 🟡 P2-5 | 一致性收尾 | 剩余 contract 切共享 decoder helper |
| `08-09-p2-scheduler-boundary` | 🟡 P2-1 | 架构清洁 | application 层无 linux 特判/crontabBlock import |
| `08-09-p2-schema-version` | 🟡 P2-2 | 破坏性 schema 统一 | 全库统一 `schema_version`,删 legacy 路径 |
| `08-09-p3-p4-cleanup` | 🟢 P3-1 / P4-2 / P4-1 | 小清理 | 文档措辞 + SKILL description + .trellis 说明 |

### 跨子任务约束

- **修复顺序**:P0-5 最先(正确性回归,可能正在生产中静默造成 cron 双跑);P2 对称性收尾次之;P2-1/P2-2 架构与 schema 统一靠后;最后 P3/P4 批量小清理。
- **P2-5 与 P2-2 的 hub/migrations 边界**:两个子任务都触达 `core/contracts/hub.ts` 的 legacy `version: "4"` 分支和 `core/registry/migrations.ts` 的 legacy 认读。为避免改同一处冲突,分工如下:
  - `p2-decoder-helper` 只处理 ingest/local/upgrade/distribution/workbench 这 5 个非 hub contract 的校验切 helper(workbench 是 `schema_version`,切 `readVersion` 后仍保持 `schema_version` 字段名)。
  - `p2-schema-version` 统一全库字段名 `version → schema_version`,并**在此任务内**删除 hub.ts 的 legacy `version: "4"` 接受分支和 migrations.ts 的 legacy 认读(破坏性变更的一部分)。
  - 执行顺序:p2-decoder-helper 先于 p2-schema-version,避免字段名改动与 helper 切换交织。
- **回归底线**:每个子任务完成时 `bun test` 全绿、`tsc --noEmit` 通过;全部完成后父任务做一次集成 review 并关闭 issue #3。
- **模板同步**:改动 contract 字段名时,`templates/workbench/.jspace/*.json` 同步升级;升级/重建产物依赖 `templates/workbench/` 时,需按仓库约定重跑 gen-assets.ts/build 同步嵌入式资产(见记忆:改 templates 后必须重跑)。

### 已研究确认的事实(与 issue 原文的差异)

- **acquireLock 调用点**:全库仅 `application/automation/execute.ts:204` 一处(`use-cases.ts`/`status.ts` 不直接调用),P0-5 只需修这一处 + 补集成测试。
- **P2-2 涉及的 `version` 字段 contract 实为 10 个**(issue 写 9 个):cron / local / ingest / pending / run-record / incident / skills / distribution / upgrade / materialized。另 workbench.ts 已用 `schema_version`。
- **`.trellis/` 当前正被激活使用**(本会话已用 task.py 创建 7 个任务),issue 所述「从未创建过任务」已不成立 → P4-1 的「删除」方案(A)作废,默认走 C(README 注明 vendored/正在使用)。

## Acceptance Criteria

- [x] P0-5:execute.ts 用 `timeoutSec × 2000ms` 计算 stale 阈值;新增集成测试证明默认 timeoutSec 下 1 小时内锁不 stale、超过后可按预期被抢;bun test + tsc 全绿
- [x] P2-6:doctor(ingest.journal_decode)、context(ingestDamaged)、cron check(damaged_state 聚合)三处都 report ingest journal 损坏;有对称 pending 的回归测试
- [x] P2-5:5 个非 hub contract 的版本/uuid 校验统一走 `readVersion/readUuid`;UUID_PATTERN 补注释
- [x] P2-1:application 层移除 linux 特判与 `crontabBlock` import,whole-block 语义下沉 linux adapter;cron install/dry-run/uninstall 全链回归不破坏
- [x] P2-2:全库统一 `schema_version`(10 个 contract + 模板 + migrations + fixtures),hub legacy `version: "4"` 与 migrations legacy 认读删除
- [x] P3/P4:PLATFORMS.md 措辞修正;两个 SKILL.md description 精简;.trellis 状态在文档中说明
- [x] 全部完成后父任务集成 review(bun test 432/0 fail,tsc ✓),关闭 issue #3 并附修复清单

## 完成记录(2026-08-09)

6 个子任务全部归档,集成验证全绿。提交序列(基线 24818b3 → 6 个 commit):
`4da75f0` P0-5 · `d81ff6f` P2-6 · `75c2492` P2-5 · `12a651f` P2-1 · `623e06c` P2-2 · `d143e79` P3/P4

## Notes

- 父任务只做需求集、任务地图、跨子任务验收与最终集成 review,不承担直接实现。
- 各子任务独立规划/实现/检查/归档;依赖关系(P2-5 → P2-2)写入子任务 prd.md/implement.md。
- 破坏性变更(P2-2)需在 commit 说明中提示已有用户 `rm ~/.jspace/state/*` 或手工 rename。
