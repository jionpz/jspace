# 设计：cron 子系统收敛

## 目标架构

**单一身份源**：tag-scoped `adapters/scheduler/*`（`com.jspace.cron.<tag>.<id>` / `JSpaceCron_<tag>_<id>` / crontab managed-block comment）成为 install / uninstall / doctor / 提示的唯一事实源；删除 legacy `cli/cron.ts` 的无 tag 身份读取（`plistPath`/`installedPlists`/`installedCronIds`/`shortHash`/`plistExists`）。`cronInstall`/`cronUninstall` 已走 adapters（无需改）；doctor 与 cron add/remove 提示改为 tag-scoped。

**层环打破**：`parseSchedule`/`ScheduleDict` 下沉到 `adapters/scheduler/schedule.ts`；`adapters/scheduler/*` 只依赖同层 `./schedule.ts` + `fail`（adapters 既有反向边）。`application/automation/definitions.ts` 从 adapters 导入并 re-export（保持 cli/cron.ts、registry.ts、cli/cron.test.ts 的 `from definitions` 导入不破）。

## 变更清单

### C1. 层环修复（Req 10）— 纯移动，先做
- 新建 `adapters/scheduler/schedule.ts`：`ScheduleDict` interface + `parseSchedule`（从 definitions.ts 逐字搬移；`fail` 来自 application/errors.ts——adapters 既有反向边）。
- `adapters/scheduler/types.ts:8`：`import type { ScheduleDict } from "./schedule.ts"`。
- `adapters/scheduler/linux.ts:9`、`win32.ts:6`：`import { parseSchedule } from "./schedule.ts"`。
- `application/automation/definitions.ts`：删本地定义，`import { parseSchedule, type ScheduleDict } from "../../adapters/scheduler/schedule.ts"` 并 `export { parseSchedule }; export type { ScheduleDict };`（definitions 现有消费方不破）。
- `application/automation/scheduler.ts:6` workbenchTag re-export 保留（app→adapters 允许）。
- 核验：`grep -rn 'from "../../application' adapters/scheduler/` 为空。

### C2. Win32 argv 有损往返（Req 1，P1）
- `cli/commands/registry.ts` contentFor win32 分支：`return JSON.stringify(args);`（替代 `args.join(" ")`）。
- `adapters/scheduler/win32.ts` apply：`const args = JSON.parse(op.content) as string[];`（替代 `split(" ")`）。
- 提取纯函数 `parseOpContent(content): string[]`（= `JSON.parse`，失败 fail）供测试。

### C3. linux inspect：tag 下标 + 真实 schedule/argv（Req 4+5，P2）
- 提取纯函数 `parseManagedLine(line: string, tag: string): InstalledTask | null`（从 linux.ts inspect 逻辑）。
  - 正则（兼容 `--dir`/`--id` 两种顺序）：`/^(\S+ \S+ \S+ \S+ \S+)  cd '([^']*)' .* cron run (?:--dir '([^']*)' --id '([^']+)'|--id '([^']+)' --dir '([^']*)').*# (com\.jspace\.cron\.\S+)/`
  - tag 解析：`taskId.replace(/^com\.jspace\.cron\./, "").split(".")[0]`（修复 `split(".")[2]` 恒等 `"cron"` 的 bug）。
  - schedule = 前 5 字段 `${min} ${hour} ${dom} ${mon} ${dow}`；argv = `cron run --id ${id} --dir ${root}`（与 buildDesired 格式一致 → no-op 判定成立）。
  - tag 不匹配 → null（跨工作台隔离）。
- `linuxAdapter.inspect` 用 `parseManagedLine` 遍历，空 crontab 返回 []。

### C4. win32 inspect：真实 schedule/argv（Req 5，P2）
- 提取纯函数 `parseSchtasksXml(xml: string): { schedule: string; argv: string } | null`：
  - `<StartBoundary>YYYY-MM-DDTHH:mm:ss</StartBoundary>` → `HH:mm` → `${min} ${hour} * * *`。
  - `<ScheduleByDay>` → DAILY（dow `*`）；`<ScheduleByWeek><DaysOfWeek><X/></DaysOfWeek>` → WEEKLY + dow（X→0..6，SUN=0）。
  - `<Arguments>` 提取 `--dir "<root>"` 与 `--id <id>` → argv = `cron run --id <id> --dir <root>`。
  - 任一解析失败 → null（inspect 回退空 schedule/argv → 保守出 update op）。
- `win32Adapter.inspect`：每任务 `schtasks /query /tn <task> /xml`（spawnSync）→ parseSchtasksXml；queryTasks 仍用于存在性。
- 风险标注：真实 schtasks 集成需 Windows 真机回归（CI 仅 ubuntu）；纯解析器用 fixture XML 在本机测。

### C5. delete-only / 全禁用（Req 6，P2）
- `cli/commands/registry.ts` linux apply 分支：`enabled` 改用 `data.crons.filter((c) => c.enabled)`（完整 desired 集，非 ops 派生）。enabled 为空 → `crontabBlock([])` 产生仅标记块 → replaceManagedBlock 清除。
- `application/automation/use-cases.ts` `cronInstall`：删除 `enabled.length === 0` 的 early-return；改由 `planReconciliation([], installed)` 自然产出 delete ops（全禁用 → 卸载已装任务）。保留 `data.crons.length === 0` 的 fail。

### C6. doctor / 提示 tag-scoped + 删 legacy（Req 2+3，P1）
- 新建 `cli/scheduler.ts`：
  - `schedulerEnv(): SchedulerEnv`（jspaceBinary/home/path/resolvePath，从 cli/cron.ts + cli/paths.ts 组装）。
  - `workbenchTagFor(root: string): string`：marker 非 ok → `fail("missing .jspace/marker.json; repair before cron scheduling")`（Req 9，替代 `"unknown"` 回退）。
  - `installedCronIdsForRoot(root): string[]`：marker/adapter 缺失 → `[]`（doctor 健康检查不 throw）；否则 `adapter.inspect(workbenchTag(marker.workbench_id), schedulerEnv()).map(t => t.cronId)`。
  - `cronIsInstalledForRoot(root, id): boolean`：= 上述 set 包含。
- `cli/commands/registry.ts`：
  - `cronDeps.installedCronIds` → `installedCronIdsForRoot`（doctor 装配，registry.ts:71）。
  - cronInstallSpec/cronUninstallSpec：tag 改用 `workbenchTagFor(ctx.root)`；env 改用 `schedulerEnv()`（消除三处重复的 marker/adapter/env 装配）。
  - cronAdd/Remove 的 `{ isInstalled: plistExists }` → `{ isInstalled: (id) => cronIsInstalledForRoot(ctx.root, id) }`。
- 删除 `cli/cron.ts` 中无引用 legacy helper：`plistPath`/`plistExists`/`installedPlists`/`shortHash`/`installedCronIds`（cli/cron.test.ts 未测它们，安全）。保留 `jspaceBinary`/`linuxCronHealth`/`cmdCronStatus`/`cmdCronFailures`/`filehubRoot`/`findPendingApplies`/`cronLogDir`/`parseSchedule` re-export。
- `application/workspace/doctor.ts:109` stale 消息 `com.jspace.cron.${id}` → `${id}`（真实任务是 tag-scoped，硬编码无 tag 名误导）。

### C7. darwin env.home（Req 8，P3）
- `adapters/scheduler/darwin.ts`：`plistPath(tag, id, home)`、`listPlists(home)`、`plistSchedule(name, home)`、`plistArgv(name, home)`；`inspect(tag, env)`/`apply`/`uninstallAll` 用 `env.home`。
- 无外部 plistPath 消费者（grep 已确认仅 darwin.ts 内部），签名改动安全。

### C8. cron.json 原子写（Req 7，P2）
- `application/automation/definitions.ts` `saveCrons`：`writeFileSync` → `writeBytesAtomic`（import from `../../adapters/fs/workbench-state.ts`，与 ingest/pending 同款）。`mkdirSync` 保留。

### C9. 补测（各修复的针对性回归）
- `adapters/scheduler/schedule.test.ts`（或并入 scheduler.test.ts）：`parseSchedule` 行为不变（移动即回归）。
- win32：`parseOpContent(JSON.stringify(args))` 含空格路径/引号往返一致；`parseSchtasksXml` fixture（DAILY/WEEKLY/含空格 root/坏 XML → null）。
- linux：`parseManagedLine` fixture（tag 匹配/不匹配、schedule/argv 提取、`split(".")[2]` 修复后正确取 tag）。
- darwin：`plistPath(tag,id,home)` 组合、`parsePlistName`（导出）往返 + 异常。
- use-cases：`cronInstall` 全禁用 → desired=[] → 产出 delete ops（注入 stub inspect/apply）。

## 不做（范围边界）

- 不做 win32 真机集成测试（标注需真机回归）。
- 不动 `linuxCronHealth` 与 `linuxAdapter.health()` 的去重（P3 纯清理，归后续）。
- 不改 `cron run` 退出码 / `cron status --dir`（P3，归 fix-docs-spec/其他）。
- legacy plist 的「真实迁移/删除」仅做 doctor 不再误报 + 提示（Req 3 收敛为：install 写 tag-scoped，uninstall 清 tag-scoped；legacy 无 tag plist 由用户手动清理，不自动删——避免误删）。

## 验证

- `grep -rn 'from "../../application' adapters/scheduler/` → 空（层环修复）。
- `bunx tsc --noEmit` 绿；`bun test` 全绿（含新增 fixture）。
- 三平台幂等：darwin 用本机 LaunchAgents 冒烟（纯函数级 + 可选真机）；linux/win32 以 fixture 纯函数为准 + 真机标注。
