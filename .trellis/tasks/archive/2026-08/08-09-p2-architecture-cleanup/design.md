# P2 架构清净 — 技术设计

## 目标边界

在不改变 CLI 对外行为、不破坏 409+ 测试的前提下,消除 3 处架构债:
1. application 反向穿透 hexagonal(P2-1)
2. application 子模块目录环(P2-3)
3. 平台细节 / CLI 退出协议违规(P2-7)

## 设计决策

### P2-1 scheduler 端口形状

- 现状:`SchedulerService.contentFor` 按 `adapter.platform` switch,application 知道三套平台格式;`buildPlist` 在共享 types.ts。
- 目标:
  ```
  interface SchedulerAdapter {
    platform: Platform
    buildContent(cron: CronSpec, tag: string, root: string, env: SchedulerEnv): string  // 每个 adapter 各自实现
    // ... 既有 apply / inspect / uninstallAll 等
  }
  ```
- `buildPlist` → `adapters/scheduler/darwin.ts`(adapter 内私有,不再共享契约)。linux 的 `buildContent` 返回 cron.id 占位(真正 crontab block 在 apply 时整体重建)。
- `contentFor` 在 application 侧退化为 `adapter.buildContent(...)`,无 switch。`adapters/scheduler/types.ts` 删除 darwin 专属格式函数,保留端口接口。
- 依赖:P1-3(已去 resolvePath)在此之上重构端口形状。

### P2-3 诊断聚合位置 → `application/diagnostics/`

- 决策(父 design.md 决策 2):新建 `application/diagnostics/` 承载跨域诊断(doctor 的 cron/pending/gbrain/inbox/skill drift 检查)。
- 移动目标:`application/workspace/doctor.ts` 的跨域 check 函数(已由 P2-4 拆出)搬到 `application/diagnostics/`;`doctor.ts` 只留 workbench lifecycle 检查。
- 依赖注入:`automation/definitions.ts`、`automation/execute.ts` 对 `workspace/*` 的 import 改为 deps 注入(端口/依赖参数),打破目录环。
- `import-boundary.test.ts` 新增子模块环规则:`application/{A}/` 不得 import `application/{B}/`(B≠A),唯一豁免 `application/diagnostics/`(它可 import 其它 application 子模块,反向不允许)。

### P2-7 平台细节归位

- `application/automation/win32-spawn.ts` → `adapters/harness/spawn.ts`(平台 I/O)。
- `execute.ts` 裸 `spawn`/`taskkill` → 新 `adapters/process/spawn.ts` 暴露 `spawnProcess(argv, opts) -> Promise<{exit, output, timedOut}>`。
- `cli/commands/context.ts` 去 `process.exit(0)` → `return { exitCode: 0, lines: [] }`;stdin timeout 逻辑下沉 `application/context/collect.ts` 或独立 `readHookPrompt()`。

## 不变量

- 所有移动仅改变模块位置 / 依赖方向,**不改行为语义**;测试文件跟随移动,断言不变(除非 import 路径)。
- CLI 命令输出格式、退出码、cron 调度结果三者不变。
- 平台测试(win32-spawn.test.ts 等)随源文件移动并继续绿。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 移动文件后 import 遗漏 | `bunx tsc --noEmit` + `bun test` 全仓兜底 |
| diagnostics 位置引入反向依赖 | import-boundary.test.ts 子模块环规则硬校验 |
| spawn 抽象改变 execute 超时行为 | 回归执行 cronRun 超时用例;`spawnHarness` 返回 child/timer/collector 可独立测 |
| P2-1 多平台联动破坏 | 先 P1-3 瘦身再 P2-1;每步跑 scheduler-service.test.ts / use-cases.test.ts |
