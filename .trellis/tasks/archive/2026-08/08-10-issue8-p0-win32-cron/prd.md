# P0: Win32 cron 任务名错位（issue #8 #1）

## Goal

修复 `adapters/scheduler/win32.ts` 的任务名错位：install / inspect / uninstall 三个路径对同一 cron 使用**同一个** schtasks 任务名 handle，消除「每次 install 永远 create、uninstall 删不掉、孤儿任务继续跑」的确定性失效，并让现有绿测不再绕过 `buildContent`。

父任务：`08-10-issue8-review-fixes`（本批为第一个子任务，先于其它批）。

## Background（根因）

- `application/automation/scheduler-service.ts:27-35` `buildDesired`：desired 的 `taskId = adapter.identity(tag, c.id).taskId`（=`JSpaceCron_<tag>_<id>`），`content = adapter.buildContent(...)`。
- `win32Adapter.buildContent`（`win32.ts:120-125`）：`/tn` 用 `taskIdFor(tag, cron.id)`（=`com.jspace.cron.<tag>.<id>`，POSIX 点形式）。
- `win32Adapter.inspect`（`win32.ts:127-138`）经 `queryTasks(tag)` 只认 `JSpaceCron_${tag}_` 前缀 → 永远查不到点形式任务 → 每次 `cron install` 都 create（`/f` 覆盖旧错误名任务）。
- `uninstallAll`（`win32.ts:145-155`）同一前缀 → 报「no jspace scheduled tasks」→ 孤儿任务继续跑。
- `adapters/scheduler/scheduler.test.ts:267-279`（P0 收敛测）手搓 `JSON.stringify(schtasksArgs(cron, ..., taskId))`，**从不调用 `win32Adapter.buildContent()`** → 绿测挡不住。

## Requirements

1. `win32Adapter.buildContent()` 产出的 schtasks argv 的 `/tn` 值 === `win32Adapter.identity(tag, cron.id).taskId`，即 `JSpaceCron_<tag>_<id>`（与 inspect/uninstallAll 一致）。
2. 任务名格式保持单一事实源：`identity` / `buildContent` / `queryTasks` 前缀 / `inspect` 的 cronId 切分不出现第二处手写 `JSpaceCron_${tag}_${id}` 拼接（或至少 buildContent 与 identity 走同一函数）。
3. 不改变 POSIX 侧（darwin/linux 仍用点形式 `taskIdFor`）；`logicalId` 语义不变。

## Acceptance Criteria

- [x] `win32Adapter.buildContent(cron, tag, root, env)` 返回的 JSON argv 中 `/tn` 的值 === `win32Adapter.identity(tag, cron.id).taskId` === `JSpaceCron_${tag}_${cron.id}`。
- [x] `adapters/scheduler/scheduler.test.ts` 的 P0 收敛测（win32）改用 `win32Adapter.buildContent()` 生成 content，不再手搓 `schtasksArgs` → 仍收敛（create/no-op/update/delete 四例全过）。
- [x] 新增 service↔adapter 一致性回归：`buildDesired(...)`（win32 adapter）产出每个 desired 的 `JSON.parse(content)` argv 含 `/tn` 且值 === `desired.taskId`。
- [x] `parseOpContent` / `parseSchtasksXml` 不受影响（不改契约）。
- [x] `bunx tsc --noEmit` 0 错误；`bun test adapters/scheduler/scheduler.test.ts application/automation/scheduler.test.ts` 全绿（38/38）；全量 `bun test` 492/492。

## Out of Scope（本批不做）

- #11（Win32 dow=7 round-trip）→ 归 `08-10-issue8-p2-contracts-doctor`。
- 真实 schtasks「install → inspect → uninstall」Windows 冒烟测试（CI 无 Windows 测试机）→ 记为手动验证项。

## Notes

- **一次性迁移**：修复前已用点形式 `com.jspace.cron.<tag>.<id>` 安装的旧任务不会被 `inspect`/`uninstallAll` 识别（前缀不匹配）。升级后需在 Windows 手动 `schtasks /delete /tn com.jspace.cron.<tag>.<id> /f` 清理一次（或首次 `cron install` 创建正确名任务后残留旧任务）。
- 本批为全量 7 批的第一批；收尾后按父任务 prd 的 Cross-Child Acceptance 跑基线。
