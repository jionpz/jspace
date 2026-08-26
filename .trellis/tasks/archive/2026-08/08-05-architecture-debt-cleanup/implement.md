# 架构债务清理 — 执行计划

> 顺序：**A(dedup) → B(tsc-gap) → C(bun-build) → D(facade) → E(invocation)**。A 先于 B：去重先移除死代码（cli/cron.ts 的 shq/localDate/localStamp），缩小 noUnusedLocals 的爆炸面；D/E 涉及 cron 行为殿后。风险文件用 ⚠️ 标注。
> 全程门禁：`bunx tsc --noEmit` + `bun test` 全绿（297 + 新增回归）。

## A. 重复代码去重（item 5，低风险）

**A1. 新建 `application/time.ts`**
- `localDate()`（YYYY-MM-DD）、`localStamp()`（YYYY-MM-DDTHHMMSS，复用 localDate）。
- 不导出 `now`。

**A2. 扩展 `application/fs.ts`**
- 保留唯一 `isFile`；新增 `readJsonRecords<T>(dir, {ext, decode, sort})`（签名见 design 2.2）。
- 保持零 import（除 node:fs/node:path），叶子性质。

**A3. 重接 7 个时间调用方**
- `application/workspace/journal.ts`、`application/workspace/init.ts`、`application/automation/execute.ts`、`application/automation/incidents.ts`、`application/pending/envelope.ts`、`application/ingest/journal.ts`（`now()`→`localStamp()`）、`cli/cron.ts`。
- 删除各自本地 `localDate`/`localStamp`/`now`，import 自 `application/time.ts`。

**A4. 重接 isFile 调用方 + readJsonRecords 收敛**
- `adapters/fs/workbench-state.ts`、`cli/paths.ts`：删本地 `isFile`，import 自 `application/fs.ts`。
- 4 个仓储循环改调 `readJsonRecords`：`readEnvelopes`（envelope.ts）、`readJournals`（ingest/journal.ts）、`readRuns`（runs.ts）、`readIncidents`（incidents.ts）。排序/解码按 design 2.2 表参数化。

**A5. 清理 cli/cron.ts 重复 CRON_FILE**
- `cli/cron.ts:17` 的 `CRON_FILE` 与 `application/automation/definitions.ts:21` 重复且未被使用 → 删除。

**A6. 测试**
- 新增 `application/time.test.ts`（格式 + 不随 UTC 偏移）。
- `readJsonRecords` 由既有 envelope/journal/runs/incidents 测试覆盖（行为不变），如缺单测则补 1 条 corrupt-json 跳过用例。

**验证**：`rg 'function localDate|function localStamp|function now\b' --glob '*.ts'` → 仅 `application/time.ts` 两处；`rg 'function isFile' --glob '*.ts'` → 仅 `application/fs.ts`（测试文件除外）。

## B. tsc 盲区（item 1）

**B1. `tsconfig.json` include 增加 `"application/**/*.ts"`**，开启 `noUnusedLocals` + `noUnusedParameters`。

**B2. `bunx tsc --noEmit` 迭代修零** ⚠️ 波及全程序
- 未用局部/参数逐个处理（删，或按仓库惯例前缀 `_`，如 handler 的 `_ctx`）。
- 预期重点：cli/cron.ts 残余（A5 后应已消掉 shq/localDate/localStamp）、core/adapters 中既有未用项。

**验证**：
- `bunx tsc --noEmit --listFiles | rg 'application/.*\.test\.'` 非空。
- `bunx tsc --noEmit` 零报错。

**回滚点**：若 B2 爆炸不可控，先只加 include 不开 flag（中间态 commit），再增量开 flag。

## C. .bun-build 残留清理（item 2）

**C1. 新建 `scripts/clean-bun-build.ts`**：`readdirSync(根目录)`，删除匹配 `/^\..*\.bun-build$/` 的条目（`rmSync recursive`），打印删除数。

**C2. 接线构建链**
- `package.json`：`build`/`build:win`/`build:linux` 前置 `bun run scripts/clean-bun-build.ts && `。
- `scripts/build-all.ts` 顶部调用同一清理（或 spawn 该脚本），`build:all` 不重复接线。

**验证**：`bun run build` 后 `ls -d .*.bun-build 2>/dev/null | wc -l` → 0；`bin/jspace` 可运行 `jspace --version`。

## D. cron 门面迁入 application（item 3，⚠️ cron 行为）

**D1. 新建 `application/automation/status.ts`**
- `cronLogDir(root, id)`（自 cli/cron.ts:55）。
- `findPendingApplies(root)`（自 cli/cron.ts:88，内部直接用 `resolveFilehubRoot`，不再经 `filehubRoot` 包装）。
- `cronStatus(root, id?): CmdResult`（自 cmdCronStatus，root 参数化，lines 逐字不变）。
- `cronFailures(root, json: boolean): CmdResult`（自 cmdCronFailures，human→lines、`--json`→data、`exitCode` 见 design 2.1）。

**D2. registry.ts 接线改走 CmdResult** ⚠️
- `cronStatusSpec.handler` → `return cronStatus(ctx.root, args.id === undefined ? undefined : s(args.id))`。
- `cronFailuresSpec.handler` → `return cronFailures(ctx.root, b(args.json))`。
- `cronRunSpec` 的 `logDir: cronLogDir` → import 自 status.ts。
- `cronDeps.linuxCronHealth` → `schedulerAdapter(process.platform)?.health?.(schedulerEnv()) ?? {crontab:false,service:false}`（design 2.4），移除 `../cron.ts` 的 linuxCronHealth 导入。

**D3. cli/cron.ts 收缩** ⚠️
- 删除 `cmdCronStatus`/`cmdCronFailures`/`filehubRoot`/`findPendingApplies`/`linuxCronHealth`/`cronLogDir` 及 `parseSchedule`/`ScheduleDict` re-export、相关 import（spawnSync/CONFIG_DIR/workbenchRoot/resolveFilehubRoot/loadCrons/lastRun/readIncidents/readEnvelopes/envelopePath）。
- 仅留 `Platform` 类型 + `jspaceBinary`（+ 其依赖 existsSync/join/devRoot/isCompiled/embed）。

**D4. 测试迁移**
- `cli/cron.test.ts`：jspaceBinary 用例留 cli；`filehubRoot`/`findPendingApplies`/`cmdCronFailures` 用例迁至 `application/automation/status.test.ts`，断言改为 CmdResult 返回（lines/data/exitCode），不再依赖 console.log 捕获 + process.exitCode。
- `cli/handler-wiring.test.ts` 补：`cron status`/`cron failures`/`cron check` 经真实解析器返回 CmdResult、`needsAttention>0 → exitCode 1`、`--json` 走 data。

**验证**：`bun test` 全绿；`rg 'console\.log' cli/cron.ts` 空；手动 `jspace cron check`（构建后）退出码语义不变。

## E. invocation 单一来源（item 4，⚠️ cron 行为）

**E1. `registry.ts` buildDesired 用 `invocationArgv`** ⚠️
- 第 333 行 `argv: \`cron run --id ${c.id} --dir ${ctx.root}\`` → `argv: invocationArgv({ cronId: c.id, workbench: ctx.root }).join(" ")`。
- import `invocationArgv` 自 `application/automation/invocation.ts`。

**E2. round-trip 契约测试**（放 `cli/handler-wiring.test.ts`，design 2.3）
- `parse(invocationArgv(inv), ROOT)` 解析回 `id`/`dir`/`force`/`timeout` 与原 invocation 一致（含/不含 force、timeout 各 1 例）。

**验证**：`bun test cli/handler-wiring.test.ts` 通过；`bunx tsc --noEmit` 零报错；`cron install` 幂等 no-op 回归（planReconciliation argv 相同 → 无 update op，既有用例覆盖）。

## 收尾

- **F1** `bunx tsc --noEmit` + `bun test` 全绿。
- **F2** 验收逐条核对（prd.md Acceptance Criteria，含 A 的 rg 断言、B 的 listFiles 断言、C 的残留断言、D 的 CmdResult 断言）。
- **F3** 每项独立 commit（A/B/C/D/E），commit message 按仓库风格 `fix(scope): ...` / `refactor(scope): ...` / `chore(scope): ...`。
- **F4** 不触碰 templates/skills → 无需 gen-assets（若实现中意外改动，须 `bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`）。
