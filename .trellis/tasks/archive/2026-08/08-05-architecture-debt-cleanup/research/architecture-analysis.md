# 架构分析证据 — 2026-08-05 全项目扫描（本任务上下文）

> 供子代理 / 后续会话使用。所有 file:line 以当前 main 为准；设计决策见 `design.md`，执行见 `implement.md`。

## 层结构（backend spec 确认）

`core/contracts`（纯 decoder）→ `core/registry`（effective merge）→ `adapters`（fs/scheduler 平台适配）→ `application`（use case + CommandSpec + CmdResult）→ `cli`（CommandSpec 树 + 生成资产 + 遗留门面）。

依赖纪律：application 不 import cli；adapters 已 import `application/errors.ts`（叶子工具，既有惯例，非环）。

## 重复代码清单

### 时间辅助（7 文件）
- `localDate()`（YYYY-MM-DD）：`application/workspace/journal.ts:21`、`application/workspace/init.ts:34`、`application/automation/execute.ts:52`、`cli/cron.ts:28`
- `localStamp()`（YYYY-MM-DDTHHMMSS）：`application/pending/envelope.ts:21`、`application/automation/incidents.ts:30`、`application/automation/execute.ts:56`、`cli/cron.ts:32`
- `now()`（同 localStamp 形状）：`application/ingest/journal.ts:84`

### isFile（非测试 3 份 + 测试 1 份）
- `application/fs.ts:6`（export）、`adapters/fs/workbench-state.ts:24`、`cli/paths.ts:30`、`cli/init.test.ts`（测试，豁免）

### readdir+parse+skip-corrupt 仓储循环（4 份）
- `readEnvelopes`：`application/pending/envelope.ts:30`（ext `.APPLY.json`，decodePendingEnvelope，sort createdAt→id）
- `readJournals`：`application/ingest/journal.ts:95`（ext `.json`，decodeIngestJournal，sort createdAt）
- `readRuns`：`application/automation/runs.ts:35`（ext `.json`，类型守卫 status，sort startedAt）
- `readIncidents`：`application/automation/incidents.ts:35`（ext `.json`，类型守卫 status，sort openedAt）

### 其他重复
- `CRON_FILE`：`cli/cron.ts:17` 与 `application/automation/definitions.ts:21` 重复；只有 definitions.ts 被使用。
- `linuxCronHealth`：`cli/cron.ts:48` 与 `linuxAdapter.health()`（`adapters/scheduler/linux.ts:155`）逐行重复。

## tsc 盲区（item 1）

- `tsconfig.json` include：`cli/**/*.ts`、`scripts/**/*.ts`、`core/**/*.ts`、`adapters/**/*.ts` —— **缺 `application/**/*.ts`**。
- `bun test` 只转译不查型；`application/` 下 18 个 `.test.ts` + `application/automation/invocation.ts` 等全部逃逸类型检查。
- 未开启 `noUnusedLocals` / `noUnusedParameters`。
- 测试基数：297 用例。

## .bun-build 残留（item 2）

- 根目录 50 个 `.*.bun-build`（约 3GB），已 gitignore、从未清理。
- `package.json` build 链：`build`/`build:win`/`build:linux` 均先 `gen-version && gen-assets && bun build --compile`；`build:all` 走 `scripts/build-all.ts`（6 平台矩阵）。

## cron 门面现状（item 3）

- `cli/cron.ts`：`cmdCronStatus`（:59，void+console.log）、`cmdCronFailures`（:100，void+console.log+process.exitCode；`check` 是 `failures` 的 alias）、`filehubRoot`（:81，包装 resolveFilehubRoot）、`findPendingApplies`（:88）、`cronLogDir`（:55）、`linuxCronHealth`（:48）、`jspaceBinary`（:38）。
- `cli/commands/registry.ts`：cronStatusSpec（:444）/cronFailuresSpec（:454）handler 调 cli/cron.ts 后返回 `{ lines: [] }`；cronRunSpec（:404）用 `cronLogDir`；cronDeps（:65）注入 `linuxCronHealth`。
- `CmdResult` 契约：`application/commands/command.ts:78`（exitCode/lines/errors/warnings/data）；`render()`（:512）在 `ctx.json && data !== undefined` 时输出 `JSON.stringify(data, null, 2)`。
- 退出码语义：`needsAttention > 0 → exit 1`；SessionStart hook（`templates/workbench/.claude/settings.json`）依赖 `jspace cron check` 退出码做 `|| echo` 探测。

## invocation 单一来源脱节（item 4）

- `application/automation/invocation.ts`：`invocationArgv(inv)`（:9）声明为唯一来源，产出 `["cron","run","--id",id,"--dir",dir,(--force),(--timeout,n)]`；**生产路径无人调用**（仅测试引用）。
- `cli/commands/registry.ts:333` buildDesired 手写 `argv: \`cron run --id ${c.id} --dir ${ctx.root}\`` —— 同形 argv 三处手写。
- 反解析（保留）：`adapters/scheduler/darwin.ts` `plistArgv`（:58，从 plist 文件名+WorkingDirectory 重建规范形）；`adapters/scheduler/linux.ts` `parseManagedLine`（:91，正则解析 crontab 行重建规范形）。
- `planReconciliation`（`application/automation/scheduler.ts:33`）：`inst.argv !== d.argv` → update op；规范形一致 → no-op。

## 测试与门禁

- `cli/handler-wiring.test.ts`：已 import `parse`/`COMMANDS`，`run(argv)` 走真实解析器 → round-trip 测试落点。
- `cli/cron.test.ts`：覆盖 `jspaceBinary`/`filehubRoot`/`findPendingApplies`/`cmdCronFailures` —— item 3 需迁移（改断言 CmdResult）。
- 门禁：`bunx tsc --noEmit`、`bun test`、改模板后 `gen-assets && git diff --exit-code cli/*.generated.ts`。
