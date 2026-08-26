# P2: 架构清净(P2-1 / P2-3 / P2-7)

## Goal

三处架构问题:application 反向穿透 hexagonal(平台 content 编译放 application)、workspace↔automation 目录环、win32-spawn / CLI 平台细节放错位置。这是本 issue 最需思考的一批,依赖 p2-data-integrity-refactor 先完成(doctor 拆分是 P2-3 前提)。

## Requirements

### P2-1 Application 反向穿透 hexagonal

- **位置**: `application/automation/scheduler-service.ts:29–41` `contentFor` 按 `adapter.platform` switch 调用 `buildPlist`/`crontabBlock`/`schtasksArgs`;`adapters/scheduler/types.ts:95–131` 把 darwin 的 `buildPlist` 放在共享契约文件。
- **修复**:scheduler 端口重构——
  1. content 编译下沉 adapter:每个 adapter 暴露 `buildContent(cron, tag, root, env) -> string`,application 不再 switch。
  2. `buildPlist` 移出 `adapters/scheduler/types.ts` → `adapters/scheduler/darwin.ts`。
  3. linux 仍返回 cron.id 占位(真正 block 在 apply 时整体重建)—— adapter 内部细节,application 不需知道。
- **注意**:P1-3(08-09-p1-ci-gaps)已把 SchedulerEnv 瘦身,本项在其上重构端口形状;检查 `scheduler-service.test.ts`、`use-cases.test.ts` 仍过。

### P2-3 application 目录环

- **位置**: `application/automation/definitions.ts:11`→workspace/manifest;`application/automation/execute.ts:22–23`→workspace/manifest|journal;`application/workspace/doctor.ts:13`→automation/incidents。`import-boundary.test.ts` 只禁跨层,不检子模块环。
- **修复**:设计「诊断聚合」位置 —— doctor 跨域检查逻辑从 `application/workspace/doctor.ts` 移出到新位置(建议 `application/diagnostics/`),或 doctor.ts 只留 workbench lifecycle 检查、跨域聚合搬到 CLI 层(CLI 本是聚合层)。**依赖**:P2-4 已把 doctor 拆成 5 个 check 函数,本项把跨域部分归位。
- 同步:从 `automation/definitions.ts`、`execute.ts` 移除对 `workspace/*` 的 import —— `skillRoot`/`readMaterializedJournal` 通过 deps 注入;`import-boundary.test.ts` 增加子模块环检查规则(application/{A}/ 不能 import application/{B}/ 除 diagnostics)。

### P2-7 win32-spawn / CLI 平台细节归位

- **位置**: `application/automation/win32-spawn.ts`(Windows .cmd/.bat 进程启动);`application/automation/execute.ts:150–172` 直接 `spawn`/`taskkill` 未走 adapter;`cli/commands/context.ts:24–45` stdin timeout + `process.exit(0)` 绕过 main 的 exitCode 协议。
- **修复**:
  1. `application/automation/win32-spawn.ts` → `adapters/harness/spawn.ts`(平台 I/O 细节);`win32-spawn.test.ts` 跟随。
  2. `execute.ts` 的 `spawn`/`taskkill` 抽到新 adapter `adapters/process/spawn.ts`,暴露 `spawnProcess(argv, opts) -> Promise<{exit, output, timedOut}>`;execute 只传 argv + 配置。
  3. `cli/commands/context.ts` 不 `process.exit(0)`,改用 `return { exitCode: 0, lines: [] }`(CmdResult 协议);stdin timeout 逻辑下沉到 `application/context/collect.ts` 或独立 `readHookPrompt()`;CLI 层只做 args → use case。

## Acceptance Criteria

- [ ] `adapters/scheduler/*.ts` 每个 adapter 有 `buildContent`;`types.ts` 无 `buildPlist`(已在 darwin.ts);`scheduler-service.ts` 无 platform switch 编译内容。
- [ ] doctor 跨域检查不在 `application/workspace/doctor.ts`(移 `application/diagnostics/` 或 CLI 聚合层);`automation/definitions.ts`、`execute.ts` 无 `workspace/*` import(经 deps 注入)。
- [ ] `import-boundary.test.ts` 有子模块环检查规则并生效。
- [ ] `win32-spawn.ts` 在 `adapters/` 下;`execute.ts` 无裸 `spawn`/`taskkill`(走 `adapters/process/spawn.ts`);`context.ts` 无 `process.exit`。
- [ ] `bun test application/automation application/workspace cli adapters/scheduler adapters/harness` 全绿(含既有 scheduler-service.test.ts / use-cases.test.ts)。
- [ ] `bunx tsc --noEmit` 通过;主工作台 doctor 0 warning 保持。

## Notes

- 依赖:本批 P2-3 前提是 08-09-p2-data-integrity-refactor 的 P2-4 已拆 doctor;P2-1 前提是 08-09-p1-ci-gaps 的 P1-3 已瘦身 SchedulerEnv。确保子任务顺序执行。
- 最需思考的一批,如有设计取舍(如 diagnostics 位置 vs CLI 聚合)先在 design 讨论再动手。
