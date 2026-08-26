# P2: 数据完整性 + 长函数拆分(P2-6 / P2-2 / P2-4)

## Goal

修 3 项:损坏的 pending / ingest 历史集合被静默丢弃(P2-6)、schema 版本字段三种形态并存(P2-2)、doctor / cronRun 长函数 + 魔法数(P2-4)。数据完整性优先(2-6),再统一版本(2-2),最后可读性(2-4)。

## Requirements

### P2-6 Pending / Ingest 集合解码失败转发 issues

- **位置**: `application/pending/envelope.ts:27–36` `readEnvelopes()` 只返回 `.records`;`application/ingest/journal.ts:91–97` `readJournals()` 同。
- 现状:`application/pending/status.ts:22–26`、`application/workspace/doctor.ts:185`、`application/context/collect.ts:126–128` 看不见损坏的 `.APPLY.json` / ingest journal。与 incidents/runs 在 doctor.ts:453–470 / status.ts:50–68 正确转发 issues 不一致。
- **修复**:两函数改为返回 `{ records, issues }`;所有调用点(status.ts / doctor.ts / collect.ts / cron-check)合并 issues 到健康面,severity 参照 damaged incident 处理(warning)。
- **回归用例**:往 `.jspace/pending/` 塞 malformed `.APPLY.json`,断言 doctor / context / cron check 都 report。

### P2-2 schema 版本字段统一

- **位置**: `core/contracts/workbench.ts:18, 35–36`(schema_version: number)、`core/contracts/hub.ts:56–57, 290–293`(hub version: string,全 schema 唯一字符串版本,显式拒 v3)、其它 contract(version: number)。`distribution.ts:1–4`、`hub.ts:5–6` 注释引用过时 "Child A/B" 术语;`migrations.ts:14–17` 迁移表为空。
- **修复**:
  1. hub.ts: `version: string` → `schema_version: number = 1`,同步 `decodeHub`/`encodeHub`。验证历史 hub.json(本机 `~/jspace-work/.jspace/hub.json`)是否需要丢弃重建 —— 无真实数据负担(仓库定位无兼容性负担),但主工作台要能迁移。
  2. `decodeHub` 拒绝逻辑改为「无 schema_version 直接判 damaged」。
  3. 更新 `core/contracts/distribution.ts`、`hub.ts` 头部过时 "Child A/B" 注释。
  4. `core/registry/migrations.test.ts` 重写期望值;全 test 套件跑。
- **注意**:本机主工作台 `~/jspace-work` 是真实环境(schema v4),改动需保证它能平滑读或重建。

### P2-4 doctor / cronRun 长函数 + 魔法数

- **位置**: `application/workspace/doctor.ts:146–484` `doctorWorkbench` ~340 行内嵌 cron/pending/gbrain/inbox/skill drift;`application/automation/execute.ts:79–238` `cronRun` ~160 行 IIFE(115–234),魔法数 `timeoutSec*2000`(110)、`MAX_OUT=1_000_000`(142)、log 截断 `64_000`(210)、`pruneLogs(...,30)`(212)。
- **修复**:
  - doctor.ts 拆 `checkCrons`/`checkPending`/`checkGBrain`/`checkInbox`/`checkSkills` 五个独立函数(各返回 `Diagnostic[]`);`doctorWorkbench` 只做编排 + severity 聚合。
  - execute.ts 提取常量 `MAX_OUTPUT_BYTES=1_048_576`、`LOG_TRUNCATE_BYTES=64_000`、`LOG_KEEP=30`、`LOCK_STALE_MS_MULTIPLE=2`(带单位注释);IIFE 拆 `validateInboxGuard`/`spawnHarness`/`recordRun` 命名函数;`spawnHarness` 返回 `{ child, timer, collector }` 便于独立测 timeout/kill/collect。
  - `cli/helpers.ts` 加 `optS(v)` helper 收敛「可选字符串参数 + try/catch → warnings」样板。
- **注意**:P2-4 的 doctor 拆分是 P2-3(目录环解耦)的前提 —— 先做本项。

## Acceptance Criteria

- [ ] `readEnvelopes` / `readJournals` 返回 `{ records, issues }`;全部调用点合并 issues;malformed `.APPLY.json` 在 doctor / context / cron check 均 report(回归用例)。
- [ ] hub contract 用 `schema_version: number = 1`;`decodeHub` 对无 schema_version 判 damaged;`migrations.test.ts` 重写后绿。
- [ ] 本机 `~/jspace-work` 的 hub.json 能迁移 / 重建成功,doctor 0 warning 保持。
- [ ] doctor.ts 拆出 5 个 check 函数,`doctorWorkbench` 只编排;execute.ts 常量 + 3 个命名函数;`cli/helpers.ts` 有 `optS`。
- [ ] `bun test application/workspace/doctor.test.ts application/automation/execute.test.ts application/pending/*.test.ts application/ingest/*.test.ts core/registry/migrations.test.ts core/contracts/*.test.ts` 全绿。
- [ ] `bunx tsc --noEmit` 通过。

## Notes

- 依赖:本项 P2-4 拆分是 08-09-p2-architecture-cleanup 的 P2-3 前提(doctor 跨域检查搬走),两批次有先后,先本批后架构批。
- 仓库 PUBLIC:迁移 / 测试用中性路径。
