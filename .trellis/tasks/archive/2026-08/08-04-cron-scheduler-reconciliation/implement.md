# Cron 调用契约、Scheduler 对账与 Incidents — Implementation Plan

## Execution Strategy

按「契约 → 定义/运维 → 结构化状态 → 执行 → scheduler → 平台矩阵」6 个里程碑顺序落地。每个里程碑保持主干可运行（`bunx tsc --noEmit` + `bun test` 绿 + 临时工作台 cron 命令可用），独立提交、独立回滚点。所有 scheduler/run 测试只发生在临时 fixture 与注入依赖上，**绝不触碰真实 launchd / crontab / schtasks / harness 进程**。

## Milestones

### M1 — CronRunInvocation 契约 + F1 修复

- [x] `core/contracts/cron.ts`：`CronDefinition`（id/schedule/harness/prompt/enabled）+ `CronRunInvocation`（workbench/cronId/timeoutSec?/force?）+ `decodeCrons`（复用 diagnostics 模式）。
- [x] `application/automation/invocation.ts`：`invocationArgv(inv)` 单向序列化（`cron run --id <id> --dir <wb> [--force] [--timeout N]`）。
- [x] cron run spec：加 `--id`（dest `id`，与位置参数互斥：两者都给报 ambiguous）、`--force`（dest `force`）、`--timeout`（已有）、`--dir`（已有）。
- [x] **contract test**：三平台（darwin/linux/win32）生成的 argv feed 回真实 `parse`，解析出的 handler args == invocation 字段；`--dry-run` 无副作用。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(133)；CLI `cron run --id <id> --dir <wb> --force --timeout 600 --dry-run` 成功（F1 关闭，原 exit 2）、位置参数等价、两者都给 → ambiguous exit 2。框架 `buildArgs` 增强：positional 无值时不再用 `undefined` 覆盖 option 值（保留 `--id` 提供的结果）。

验证门：

```bash
bunx tsc --noEmit
bun test
# invocationArgv(...) -> parse 成功;cron run <id> 与 --id <id> 语义一致
```

回滚点：M1 纯新增契约 + spec 选项；不接线执行逻辑，问题直接回退 spec 增项。

### M2 — definitions + 运维 use cases（迁出 cli/cron.ts）

- [x] `application/automation/definitions.ts`：`decodeCrons`/`loadCrons`/`saveCrons`/`parseSchedule` 迁入（纯逻辑从 `cli/cron.ts` 搬，测试同步迁移）。
- [x] use cases：`cronAdd`/`cronList`/`cronRemove`/`cronEnable`/`cronDisable`（返回 `CmdResult`；enable/disable 改 `enabled` 并 hint 重跑 install）。
- [x] registry cron spec handler 从委托 `cmdCron*` 改为调 use case（`add/list/remove` + 新 `enable/disable`）。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(133)；CLI `cron add/list/remove/enable/disable --dir <wb>` 全部生效（use case + `--dir` 统一）；`cron.ts` 的 load/save/schedule 迁出去重（`CronRecord`→`CronDefinition`、`plistExists` export）。

验证门：

```bash
bunx tsc --noEmit
bun test
# cron add/list/remove/enable/disable 在临时工作台可用,JSON/退出码一致
```

回滚点：use case 逐命令迁移并独立提交；`cli/cron.ts` 保留到 M4 执行迁移后才删。

### M3 — runs/incidents 结构化状态

- [x] `application/automation/runs.ts`：`RunRecord`（id/cronId/startedAt/exit/status/timedOut/outputLog/batchChanged）写 `.jspace/state/runs/<cron>/<id>.json`；`lastRun`/`runsSince`。
- [x] `application/automation/incidents.ts`：`Incident`（cronId/failureClass/status open|acknowledged|resolved/evidence）+ `openOrUpdate`/`resolveIncidents`/`ackIncidents`/`unresolvedIncidents`。
- [x] `cron status` / `cron failures` use cases 从结构化状态计算（不再 parse prose）；prose 日志保留为 output payload。
- [x] `cron ack [id]` use case：open → acknowledged（保留证据）。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(134)；CLI 全链 `cron run` 写 RunRecord + incident → `cron status`(结构化)→ `cron failures`(open incident → exit 1)→ `cron ack` → 再查 open=0/needs_attention=0/exit 0。删除 prose 读取（`readCronFailed`/`lastStatusFor`），doctor 改从 incidents 检查（`cron.open_incidents`）。`cron.test` 改为结构化 fixtures。

验证门：

```bash
bunx tsc --noEmit
bun test
# 失败 run → incident open;成功 → resolve;ack → 不再告警;cron check 非 0 仅未 ack open / actionable pending
```

回滚点：runs/incidents 是新增状态层（gitignored）；迁移 `status`/`failures` 前旧 prose 读取逻辑保留一行，直到结构化就绪。

### M4 — execution + F3 统一日志契约

- [x] `application/automation/execute.ts`：`cmdCronRun` 主体迁入——workbench 解析、today-success skip（`--force` 跳过）、lock、spawn harness、写 RunRecord + prose、incident open/resolve、退出码。
- [x] `adapters/harness/argv.ts`：`harnessArgv` + 二进制解析从 `cli/cron.ts` 移出（claude/codex/pi argv 不变）。
- [x] **F3 修复**：inbox batch 变化守卫改为读 `<filehub>/.jspace-logs/inbox-batch.md`（经 `filehubRoot` 解析），与 asset-ingest skill 写入同一位置；doctor/failures 共享该解析。
- [x] 注入依赖（spawn/clock/readFile）支持测试驱动状态（不真实 spawn harness）。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(134)；CLI `cron run --dry-run/--id/--force` 经 execute use case 正常；`cli/cron.ts` 的 `cmdCronRun` 删除（registry handler 调 `cronRun` use case）；batch 守卫读 `<filehub>/.jspace-logs/inbox-batch.md`（F3 关闭）；无 filehub 时降级不报错。

验证门：

```bash
bunx tsc --noEmit
bun test
# cron run --dry-run 打印 argv 无副作用;--force 跳过 today-success;batch 守卫读 filehub 路径(F3 关闭)
# 临时工作台 cron run(注入 fake harness)产生 RunRecord + incident 状态
```

回滚点：`cli/cron.ts` 在执行迁移 + F3 后删除；F3 路径修改独立提交，可单条回滚。

### M5 — scheduler adapters + reconciliation

- [x] `application/automation/scheduler.ts`：`InstalledTask`/`SchedulerOp`/`SchedulerAdapter` interface + **纯函数** `planReconciliation(desired, installed)`（create/update/delete by cronId + workbench tag）。
- [x] `cron install [--dry-run]` reconciliation use case：plan 输出 create/update/delete（带 workbench tag）；apply 走平台安装。
- [x] `workbenchTag(marker.workbench_id)`：稳定短 tag，注入 scheduler task identity（dry-run plan 已展示 `tag:cronId` vs 旧 `com.jspace.cron.<id>`）。
- [ ] adapter 独立文件迁移（launchd/crontab/schtasks 生成函数保留 `cli/cron.ts`，加 tag 的 plist 名/uninstall 按 tag 过滤留待后续）。
- [ ] `cron uninstall` 只删本 workbench tag 的任务（真实 apply 的 tag 隔离标注为已知遗留，真机验证）。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(139)；`planReconciliation` 纯测试 5/5（create/update/delete、两 workbench tag 不冲突、uninstall 只删本 tag）；CLI `cron install --dry-run` 输出 tagged plan（新带 tag create、旧无 tag delete）。注：真实 apply 的 op-based + plist 名加 tag 尚未完成（M5 部分交付，遗留标注）。

验证门：

```bash
bunx tsc --noEmit
bun test
# planReconciliation 纯测试:enabled→create,changed→update,disabled/deleted/stale→delete
# 两 workbench tag 任务 identity 不冲突;uninstall 不影响另一 tag
# cron install --dry-run 在临时工作台输出 plan 且不写真实 scheduler
```

回滚点：adapter 逐个提交；真实 apply 仅在 pure/fixture 全绿后开放（且默认 dry-run）。

### M6 — 平台矩阵 + 终验

- [x] `docs/PLATFORMS.md`（或新 `docs/CRON-PLATFORMS.md`）：launchd/crontab/schtasks × automated/best-effort/manual/unsupported + 真机手动验证矩阵（AC-C8）。
- [x] 全链验收（临时 fixture，不触碰真实系统）：`cron add → enable/disable → install --dry-run → run --dry-run/--force → status → failures → ack`，`cron check` 退出码随 incident 状态变化。
- [x] 父任务 AC6/AC7/AC8 映射 + 跨 child 契约（CronRunInvocation/incident/runs schema）定稿供 D/E 引用。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(139)、office-extract、gen-assets freshness；CLI 全链 `cron add/enable/disable → install --dry-run(tagged plan) → run --dry-run → status(结构化) → failures(open→exit 1) → ack → check(exit 0) → doctor` 通过。PLATFORMS.md 更新：incidents 取代 cron-failed.md、harness 能力矩阵（claude automated / codex·pi best-effort）、scheduler tag 隔离说明与 M5 遗留标注。

验证门：

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts && git diff --exit-code cli/assets.generated.ts cli/manifest.generated.ts
# 临时工作台 cron 全链 + 平台矩阵文档存在
```

## Review Gates

- [ ] M1 完成后 review 契约与 round-trip（F1 关闭、`--id`/位置参数双输入不回归）。
- [ ] M3/M5 完成后 review incidents 状态机与 reconciliation 判定表（对照 design §7/§6.1）。
- [ ] 每个里程碑完成时运行 `trellis-check`；不修改真实 scheduler/harness/home 配置。
- [ ] 任务收尾：父任务 AC6/AC7/AC8 映射更新，`CronRunInvocation`/incident/runs schema 定稿供 Child D/E。

## Pre-Start Checklist

- [ ] 用户已审阅并批准本 task 的 Goal、Requirements、Acceptance Criteria、Key Decisions。
- [ ] 批准后 `task.py start`，从 M1 开始逐里程碑实施。
