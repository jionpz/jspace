# P2-5 补漏: contract decoder 共享 helper + 严格度统一

## Goal

issue #2 的 P2-5 在首轮任务拆解时被遗漏(20 项修了 19 项)。补上:收敛 contract decoder 的复制粘贴样板,统一严格度(枚举 / uuid / bool / version 走共享 helper),`decodeCrons` 对 schedule 强制校验。

## Requirements

- **共享 helpers**(`core/contracts/diagnostics.ts`,与既有 `readRequiredString` 同风格,保留调用方自定义 code 以维持 decoder issue-code 契约):
  - `readEnum<T>(issues, code, path, value, allowed)` — 非空 string 且 ∈ allowed,否则 issue。
  - `readUuid(issues, code, path, value)` — uuid 形态(`/^[0-9a-f-]{36}$/i`,同 ingest.ts 现有校验),否则 issue。
  - `readBool(issues, code, path, value)` — 严格 boolean,否则 issue。
  - `readVersion(issues, code, path, value, expected[])` — number 且 ∈ expected,否则 issue。
- **切到 helper**(code 保持各 decoder 现有值,不破坏 doctor/cron check 依赖的稳定 code):
  - `run-record.ts`: id→readUuid, status→readEnum, timedOut/batchChanged→readBool, version→readVersion。
  - `pending.ts`: id→readUuid, status→readEnum, version→readVersion;retryCount 保持整数校验。
  - `incident.ts`: id→readUuid, failureClass/status→readEnum, version→readVersion;evidence 保持数组校验。
  - `cron.ts`: harness→readEnum, enabled→readBool, version→readVersion。
- **decodeCrons 强制 schedule 校验**: `cron.ts` 对每条 cron 的 schedule 调用 `parseSchedule`(core/shared/schedule.ts),失败则给该 cron 下 `cron.schedule.invalid` issue(不再是只靠 cronAdd/doctor 才警告)。
- **hub.ts**: `schema_version` 改用 `readVersion`(expected [1]),保持「旧 version:"4" 兼容读入」的既有语义。

## Acceptance Criteria

- [ ] `diagnostics.ts` 含 4 个 helper + uuid 形态常量;全部 decoder 编译通过。
- [ ] `run-record.ts` / `pending.ts` / `incident.ts` 的 id 校验为 uuid 形态(非 uuid 的 id → issue,同 ingest)。
- [ ] `decodeCrons` 对非法 schedule(如 `*/5 * * * *`)直接下 issue;合法 schedule 不误报。
- [ ] `bun test`(全仓)全绿;`bunx tsc --noEmit` 无错。
- [ ] 新增/更新 decoder 测试覆盖:非 uuid id 拒绝、非法 schedule 拒绝。

## Notes

- 这是轻量补漏任务,PRD-only。code 契约(issue code 字符串)是稳定面,必须保持既有值。
- `parseSchedule` 抛错语义:参考 `application/automation/definitions.ts` 的用法(try/catch)。
