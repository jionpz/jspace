# issue4 applyBatch 直测 + 版本报错指引 — 实施清单

## 前置依赖

- [ ] child2(08-09-issue4-linux-apply-port)已 start 并完成:linux.ts 已删 `apply()`,只留 applyBatch
- [ ] 基线:bun test 全绿 / tsc 通过

## 实施步骤(顺序执行)

### Part A — linux applyBatch 直测(第 5 项)

1. **linux.ts 加注入 seam**
   - 定义 `export interface CrontabIO { readCrontab(): string; writeCrontab(content: string): void }`
   - 把现有 `readCrontab()` / `writeCrontab()` 函数体收进 `const defaultIO: CrontabIO = {...}`
   - `linuxAdapter` 类型改 `SchedulerAdapter & { io?: CrontabIO }`
   - `inspect` / `applyBatch` / `uninstallAll` 内改取 `const io = linuxAdapter.io ?? defaultIO`,所有 crontab 读写走 io
   - 确认无直接 `readCrontab()`/`writeCrontab()` 调用残留(模块内)

2. **scheduler.test.ts 加 2 用例**
   - 用例 1 空 enabled 清块:系统行 + tagA 块(2 cron) + tagB 块 → applyBatch(ops, [], "tagA", ...)
     → 写回不含 tagA marker、含 tagB 块与系统行
   - 用例 2 非空 enabled 整块重建:块含 a+b 两行、marker 完整、幂等(跑两遍结果一致)
   - 注入方式:临时 `linuxAdapter.io = { readCrontab, writeCrontab }`(try/finally 还原),不触真实 crontab

### Part B — 版本报错指引(第 6 项)

3. **diagnostics.ts**:导出 `SCHEMA_VERSION_REPAIR_HINT` 常量(文案见 design)
4. **inspect.ts `asErrors`**:对 `code.endsWith(".version.unsupported")` 的 issue 追加 hint(覆盖 marker/hub/local)
5. **definitions.ts `loadCrons`**:fail 消息对 version.unsupported issue 追加 hint
6. **definitions.test.ts**:新用例——旧 `cron.json`(`version: 1` 而非 schema_version)→ loadCrons 抛错含
   "init" 或 "schema_version" 字样

## 验证

- [ ] `bun test`(全量,重点 scheduler/definitions/inspect/doctor/use-cases)
- [ ] `bun run tsc`(或 package.json 等价命令)
- [ ] `grep -rn 'readCrontab()' adapters/scheduler/linux.ts` 无直接调用(只剩 defaultIO 内)

## 提交

- 单 commit:`fix(review): issue4 linux applyBatch 直测 + 旧版本契约报错指引 (issue #4)`

## Review gate

- [ ] applyBatch 两用例通过,未触真实 crontab
- [ ] inspect.ts 的 version.unsupported(hub/local/marker)报错含修复指引
- [ ] loadCrons 报错含修复指引;新单测覆盖
- [ ] bun test 全绿 / tsc 通过
