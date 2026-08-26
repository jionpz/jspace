# P2 架构清净 — 执行计划

## 执行顺序

### 1. P2-7 平台细节归位(机械性最高,先做)
1. `application/automation/win32-spawn.ts` → `adapters/harness/spawn.ts`(+ 测试文件跟随,更新 import)。
2. 新 `adapters/process/spawn.ts`:`spawnProcess(argv, opts) -> Promise<{exit, output, timedOut}>`;`execute.ts:150–172` 的 `spawn`/`taskkill` 改走它。
3. `cli/commands/context.ts:24–45` 去 `process.exit(0)` → `return { exitCode: 0, lines: [] }`;stdin timeout 下沉 `application/context/collect.ts` 或 `readHookPrompt()`。
4. 验证:`bun test application/automation cli adapters/harness adapters/process`。

### 2. P2-1 scheduler 端口下沉(依赖 P1-3 已完成)
1. `adapters/scheduler/darwin.ts` 收编 `buildPlist`;`types.ts` 删 darwin 格式函数。
2. 每个 adapter(darwin/linux/win32)实现 `buildContent(cron, tag, root, env)`。
3. `application/automation/scheduler-service.ts:29–41` `contentFor` 改为调 `adapter.buildContent`,删 platform switch。
4. 验证:`bun test adapters/scheduler application/automation/scheduler-service.test.ts application/automation/use-cases.test.ts`。

### 3. P2-3 目录环解耦(依赖 P2-4 已拆 doctor)
1. 建 `application/diagnostics/`;把 `doctor.ts` 的跨域 check(cron/pending/gbrain/inbox/skill drift)搬入,`doctor.ts` 只留 workbench lifecycle。
2. `automation/definitions.ts`、`execute.ts` 对 `workspace/*` 的 import 改 deps 注入(`skillRoot`/`readMaterializedJournal`)。
3. `import-boundary.test.ts` 加子模块环规则(唯一豁免 diagnostics)。
4. 验证:`bun test application` + `bunx tsc --noEmit`。

## 验证命令
- 每步后:`bun test`(全仓)+ `bunx tsc --noEmit`
- 主工作台:`cd ~/jspace-work && jspace doctor`(0 warning 保持)
- 移动文件后确认 git 跟踪到 rename(减少 review 噪音)

## Review Gates
- 每步独立 commit,便于回滚。
- P2-1 改完跑完整 `bun test`(scheduler 三平台测试可能用平台守卫,确认 darwin 本机绿)。
