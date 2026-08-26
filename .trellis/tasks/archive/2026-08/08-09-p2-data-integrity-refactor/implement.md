# P2 数据完整性 + 长函数 — 执行计划

## 执行顺序(依赖驱动)

### 1. P2-6 pending / ingest issues 转发(数据完整性优先)
1. 读 `application/pending/envelope.ts:27–36` `readEnvelopes`、`application/ingest/journal.ts:91–97` `readJournals`。
2. 改签名返回 `{ records, issues }`(复用 `core/contracts/diagnostics.ts` 的 IssueCollector / Diagnostic 形态)。
3. 更新全部调用点:`application/pending/status.ts:22–26`、`application/workspace/doctor.ts:185`、`application/context/collect.ts:126–128`、cron-check —— 合并 issues 到健康面,severity=warning(参照 damaged incident 处理)。
4. 回归用例:往临时工作台 `.jspace/pending/` 塞 malformed `.APPLY.json` → doctor / context / cron check 均 report。

### 2. P2-2 schema 版本统一
1. **先读** 本机 `~/jspace-work/.jspace/hub.json` 确认当前 hub `version` 字段形态与值,决定重建 / 兼容读策略。
2. `core/contracts/hub.ts`:`version: string` → `schema_version: number = 1`;同步 `decodeHub`/`encodeHub`;`decodeHub` 对「无 schema_version」判 damaged。
3. `core/contracts/workbench.ts` 已用 `schema_version: number`(核对保持一致);其它 contract 核对统一。
4. 更新 `core/contracts/distribution.ts`、`hub.ts` 头部过时 "Child A/B" 注释。
5. 重写 `core/registry/migrations.test.ts` 期望值。
6. **Review gate**:本机主工作台 hub.json 迁移 / 重建后 `jspace doctor` 0 warning 保持。

### 3. P2-4 doctor / cronRun 拆分(架构批前提)
1. `application/workspace/doctor.ts` 拆 `checkCrons`/`checkPending`/`checkGBrain`/`checkInbox`/`checkSkills`(各返回 `Diagnostic[]`),`doctorWorkbench` 只编排 + severity 聚合。
2. `application/automation/execute.ts` 提取常量 `MAX_OUTPUT_BYTES=1_048_576`、`LOG_TRUNCATE_BYTES=64_000`、`LOG_KEEP=30`、`LOCK_STALE_MS_MULTIPLE=2`(带单位注释);IIFE 拆 `validateInboxGuard`/`spawnHarness`/`recordRun`;`spawnHarness` 返回 `{ child, timer, collector }`。
3. `cli/helpers.ts` 加 `optS(v)`。
4. 回归:doctor / execute 既有测试全绿;医生输出行为不变(只拆代码,不改文案/severity)。

## 验证命令
- `bun test application/workspace/doctor.test.ts application/automation/execute.test.ts application/pending application/ingest core/registry/migrations.test.ts core/contracts`
- `bun test`(全仓)+ `bunx tsc --noEmit`
- 主工作台:`cd ~/jspace-work && jspace doctor`(0 warning)

## Review Gates
- P2-2 是唯一改真实数据形态的点:改前备份 hub.json、改后确认主工作台可用。
- P2-4 拆分后 doctor 输出 diff 为空(仅内部重构)。
