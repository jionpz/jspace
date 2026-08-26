# 架构债务清理：tsc 盲区 + 重复代码 + 遗留门面收敛

## Goal

基于 2026-08-05 全项目架构分析（本会话）的债务清理任务。范围：① tsconfig 类型检查盲区（application 测试文件 + invocation.ts 逃逸）；② 根目录 .bun-build 残留清理；③ cli/cron.ts 遗留门面迁入 application；④ invocation 单一来源脱节；⑤ 时间戳/isFile/readJsonRecords 重复代码去重。P3 项（registry 拆分/biome/术语）在 Notes 中列为暂缓。

## Requirement Map

| # | 项目 | 现状（证据） | 动作 |
|---|------|------------|------|
| 1 | `tsc-gap`（P1） | `tsconfig.json` include 缺 `application/`；18 个 `application/**/*.test.ts` + `application/automation/invocation.ts` 不在 tsc 程序内（`bun test` 只转译不查型） | include 补 `application/**/*.ts`；开启 `noUnusedLocals` + `noUnusedParameters` |
| 2 | `bun-build-cleanup`（P1 卫生） | 根目录 50 个 `.18c*.bun-build` 约 3GB（已 gitignore，未清理） | `build`/`build:all` 脚本前置清理 `.*.bun-build`（或加 `clean` 步骤） |
| 3 | `cli-cron-facade`（P1） | `cli/cron.ts` 的 `cmdCronStatus`/`cmdCronFailures`（含 check alias）直接 console.log + void，绕过 CmdResult 契约；`findPendingApplies`/`filehubRoot`/`linuxCronHealth` 留在 cli 层；`linuxCronHealth` 与 `linuxAdapter.health()`（linux.ts:155）逐行重复；`cli/cron.ts` 的 `CRON_FILE`（:17）与 definitions.ts 重复且未用 | 迁入 `application/automation/`；`cli/commands/registry.ts` 的 cron status/failures/check 接线改走 CmdResult；`linuxCronHealth` 改走 adapter health 注入；facade 收缩时删 cli/cron.ts 重复 `CRON_FILE` |
| 4 | `invocation-single-source`（P1/P2） | `invocationArgv()`（application/automation/invocation.ts）声明为唯一来源，但生产路径无人调用：`cli/commands/registry.ts:333` 的 `buildDesired` 手写同形 argv（`cron run --id ... --dir ...`），`adapters/scheduler/darwin.ts` 的 `plistArgv()` 反向手写解析——同一形状三处手写，codec 仅测试引用 | `buildDesired` 改用 `invocationArgv()`（序列化方向）；`plistArgv` 保留反解析并加 round-trip 契约测试钉住 |
| 5 | `dedup`（P2） | `localDate`/`localStamp`/`now()` 复制 7 份；`isFile` 复制 4 份；readdir+parse+skip-corrupt 仓储循环复制 4 份 | 各抽单一实现：`application/time.ts`、`application/fs.ts`（isFile 唯一）+ `readJsonRecords<T>` |

## Notes

- 执行顺序：A(dedup)→B(tsc-gap)→C(bun-build)→D(facade)→E(invocation)。去重先于 tsc 严格 flag（移除 cli/cron.ts 死代码，缩小 noUnusedLocals 爆炸面）；D/E 涉及 cron 行为，需小心回归。设计决策见 `design.md`，逐步执行见 `implement.md`。
- P3 暂缓项（不在本任务范围）：`cli/commands/registry.ts` 689 行按命令组拆分、biome 引入、README 术语收敛（JWorkspace→workbench）、skills-manifest `version` 字段去留。
- 分析详情见本会话 2026-08-05 架构分析（层结构/契约/状态机/分发链路）。

## Constraints

- 每项改动必须补/改回归单测；`bunx tsc --noEmit` + `bun test` 全绿。
- 层依赖纪律：application 不 import cli；重构不得扩大层环（definitions.ts re-export parseSchedule 的既有例外保持原样）。
- cron/ingest/pending 行为契约不可破坏：幂等 no-op、ownership 三态、cleanup-pending 语义、pending 不覆盖异内容页。
- item 3 迁移必须保留 `jspace cron check` 的退出码语义（`cli/cron.ts:152` `needsAttention > 0 → exit 1`）：工作台 SessionStart hook（`templates/workbench/.claude/settings.json`）依赖该退出码做 `|| echo` 探测。
- 改动模板/skills 后必须重跑 `scripts/gen-assets.ts` 并 `git diff --exit-code cli/*.generated.ts`。
- `.bun-build` 清理只删构建残留文件，不碰 git 历史与已跟踪文件。

## Acceptance Criteria

- [ ] `bunx tsc --noEmit --listFiles | rg 'application/.*\.test\.'` 非空（测试文件进入类型检查程序）。
- [ ] `noUnusedLocals`/`noUnusedParameters` 开启且 tsc 零报错。
- [ ] `rg 'function localDate|function localStamp|function now\b'` 与 `rg 'function isFile'` 各指向单一实现（测试文件除外；`localDate`/`localStamp` 均只定义在 `application/time.ts`，`now` 重命名后零匹配；`isFile` 仅 `application/fs.ts`）。
- [ ] `cron status` / `cron failures` / `cron check` 走 CmdResult 契约（registry.ts 不再直连 console.log 门面）。
- [ ] 构建后根目录无 `.*.bun-build` 残留。
- [ ] `bun test` 全绿（现有 297 用例 + 新增回归）。
