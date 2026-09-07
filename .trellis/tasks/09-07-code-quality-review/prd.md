# Code quality review pass: fail-closed, confinement, injection

## Goal

对当前 main（v1.0.18）做一轮多方位质量审查，并落地**有证据的** P1 行为缺陷与少量高杠杆 P2（回归测试 + 文档口径），不借机做大重构。

## Background

仓库刚合入 #37–#40。历史 Round 5–8.5 已清过一轮 P0/P1。本轮只修审查能在代码路径上证明的问题：假成功出口、路径收容缺口、Windows `/tr` 引号注入、损坏态静默、薄链假绿。

## Requirements

### R1 Fail-closed（inbox batch-stale）

- inbox-tidy 在无法验证 batch 日志变化时，不得把 `RunRecord.status` 写成 `"ok"`，不得 `exitCode` 默认 0 并打印 `jspace: ok:`。
- 同日二次触发不得因假成功被 `todaySuccess` skip。
- 仍开 `batch-stale` incident。

### R2 路径收容

- `ingest begin` 的 target 必须经 `confinedWithin`（symlink-aware），不能只做词法 `relative`。
- `filehubOps.copyFile` 与 unlink 一样收容到 filehub 根；begin 走 `filehubOps` 而非裸 `copyFileSync`。
- `skills install` 的落盘改走 `writeBytesAtomic`（rename 替换 symlink，不写穿）。

### R3 Windows schtasks 注入

- `schtasksArgs` 的 `/tr` 对 `jspaceBin` / `root` / `cron.id` 拒绝 `"`, `\n`, `\r`, `\0`（对齐 linux/darwin 的 control-char 守卫）。

### R4 假成功 exit

- `harness wire --harness cursor` 的 skills 链接失败必须进 `errors` + `exitCode: 1`，不得只塞 stdout 仍 exit 0。

### R5 损坏态可见

- `pending list` / `pending apply` 转发损坏 envelope 的 `issues` 为 warnings；仅损坏、无合法记录时不得宣称 `ok: no pending envelopes`。
- session-start / turn 渲染 `pendingDamaged` / `ingestDamaged`（collect 已采集，payload 不得再静默）。
- `loadHub` / `loadLocal` 的 `*.version.unsupported` 附带 `SCHEMA_VERSION_REPAIR_HINT`（与 `loadCrons` 同形）。

### R6 超时红线

- `resolveHarnessBin` 的 `which`/`where` 带短 timeout。
- win32 `taskkill` spawnSync 带 timeout。

### R7 测试与文档防漂移

- init 端到端断言投影目录是 symlink（issue #39 假绿缺口）。
- CI full-chain 加 `test -L` 薄链检查。
- darwin P0 收敛测走 `darwinAdapter.buildContent`（对齐 win32 / issue #8 #1）。
- `capabilities.yaml` 投影注释改为 dir symlink（copy 仅 fallback）。
- quality-guidelines 去掉过时测试计数。
- AGENTS.md 命令面补 `harness init|wire`。

## Acceptance Criteria

- [x] AC1: inbox-tidy 无 filehub / batch 日志不变 → `last.status !== "ok"`、`exitCode === 1`、开 batch-stale；二次 run 不 skip。
- [x] AC2: ingest target 经目录 symlink 逃出 filehub → throw，外部无文件被写出。
- [x] AC3: `writeBytesAtomic` 替换 symlink 而不写穿目标；`skills install` 使用它。
- [x] AC4: `schtasksArgs` 对含 `"` 的 root/bin/id throw。
- [x] AC5: cursor skills 链接失败 → `errors` 非空且调用方可设 `exitCode: 1`。
- [x] AC6: pending list 在仅损坏时不宣称 empty ok；payload 渲染 damaged 计数。
- [x] AC7: `bunx tsc --noEmit` 与 `bun test` 全绿；改 yaml 后 `gen-assets` 无意外 diff（注释不进生成物）。
- [x] AC8: 不改产品路由/记忆协议；不引入新命令面；不碰真实 home/scheduler/gbrain。

## Out of Scope

- 新建 `briefing.json` 契约 decoder（P2，独立任务）。
- 收敛全仓 `isWithin` / `safeReadFile` 副本。
- hub migration 写前 `decodeHub`（现有升级测试用未入 decoder 的假 v2 文档）。
- `package.json` 增加 `test`/`check` scripts。

## Constraints

- 行为变化仅限「假成功 → 失败可见」与「收容/注入守卫」；合法成功路径不变。
- 每条 P1 必须有回归测试走生产函数，不得手拼内部 payload。
