# 架构债务清理 — 技术设计

> 基于 2026-08-05 全项目架构分析的 5 项债务收敛。证据清单（重复代码/门面/逃逸位置）见 `research/architecture-analysis.md`。本文件只写设计决策与契约，执行顺序与验证命令见 `implement.md`。

## 1. 架构与边界

层结构（backend spec 确认）：`core/contracts` → `core/registry` → `adapters` → `application` → `cli`。

- **红线**：application 不 import cli；重构不得扩大层环。
- **事实**：adapters 已 import `application/errors.ts`（叶子工具模块）——adapters→application 的单向叶子依赖是本仓库既有惯例。`application/fs.ts`（无 import 的叶子）同理，可被 adapters/cli 安全引用，不构成环。

| 交付物 | 落点 | 边界 |
|--------|------|------|
| `application/time.ts`（新） | localDate / localStamp 单一实现 | 纯函数，无 IO |
| `application/fs.ts`（扩） | isFile 唯一 + `readJsonRecords<T>` | 只依赖 node:fs/node:path |
| `application/automation/status.ts`（新） | cron status/failures/check 门面迁入 | 返回 CmdResult；只 import application 层 |
| `scripts/clean-bun-build.ts`（新） | 构建前置清理 | 只删根目录 `.*.bun-build`，纯 node:fs，跨平台 |
| `cli/cron.ts`（缩） | 收敛后仅剩 `jspaceBinary` + Platform 类型 | cli 层保留（路径/binary 解析是 cli 职责） |

## 2. 数据流与契约

### 2.1 CmdResult 契约（item 3）

`cmdCronStatus`/`cmdCronFailures` 从 `void + console.log + process.exitCode` 改为返回 `CmdResult`：

- **human 模式** → `{ lines: string[] }`，输出内容逐字不变。
- **`--json` 模式** → `{ data: { incidents, open_incidents, acknowledged_incidents, pending_applies, crons, summary } }`；`render()`（`application/commands/command.ts:512`）在 `ctx.json && data !== undefined` 时输出 `JSON.stringify(data, null, 2)`，形状不变。
- **退出码** → `exitCode: needsAttention > 0 ? 1 : undefined`。`main.ts:46` 应用 exitCode；clean 时不设（默认 0）与旧 `process.exitCode = 0` 等价。
- **SessionStart hook 兼容**：`templates/workbench/.claude/settings.json` 依赖 `jspace cron check` 退出 1 做 `|| echo` 探测；`check` 是 `failures` 的 alias（registry.ts `cronFailuresSpec`），退出语义经 CmdResult 原样保留。

### 2.2 时间/fs 去重（item 5）

`application/time.ts`：
- `localDate(): string` → `YYYY-MM-DD`
- `localStamp(): string` → `YYYY-MM-DDTHHMMSS`（`${localDate()}T${HHMMSS}`）
- ingest 的 `now()` 更名为 `localStamp()`，**不保留 `now` 函数名**（保证 `rg 'function now\b'` 零匹配，验收可解释为「各指单一实现」）。

`application/fs.ts` 新增：

```ts
export function readJsonRecords<T>(
  dir: string,
  opts: { ext: string; decode: (raw: unknown) => T | null; sort?: (a: T, b: T) => number },
): T[]
```

收敛 readdir+parse+skip-corrupt 循环；4 个调用方差异全部参数化：

| 调用方 | ext | decode | sort |
|--------|-----|--------|------|
| `readEnvelopes` | `.APPLY.json` | `decodePendingEnvelope` → `.value`/null | createdAt → id |
| `readJournals` | `.json` | `decodeIngestJournal` → `.value`/null | createdAt |
| `readRuns` | `.json` | 类型守卫 `status` | startedAt |
| `readIncidents` | `.json` | 类型守卫 `status` | openedAt |

### 2.3 invocation 单一来源（item 4）

- **序列化方向**：`registry.ts:333` buildDesired 的 `argv: \`cron run --id ${c.id} --dir ${ctx.root}\`` → `argv: invocationArgv({ cronId: c.id, workbench: ctx.root }).join(" ")`。
- **输出不变**：`invocationArgv` 产出 `["cron","run","--id",id,"--dir",root]` → join 后与 darwin `plistArgv`（darwin.ts:69）、linux `parseManagedLine`（linux.ts:101）重建的规范形 `cron run --id <id> --dir <root>` 逐字一致 → `planReconciliation` 的 `argv` 相同判定（scheduler.ts:40）不受影响，幂等 no-op 保持。
- **反解析方向**：darwin `plistArgv`、linux `parseManagedLine` 保留不动（从安装态重建 argv）。
- **契约测试**：round-trip 钉在 `cli/handler-wiring.test.ts`（已 import `parse` + `COMMANDS`）——`parse(invocationArgv(inv), ROOT)` 走真实 CLI 解析器，断言解析回 `id`/`dir`/`force`/`timeout` 与原 invocation 一致。测试放 cli 层是刻意的：真实解析器 + `cron run` spec 在 cli/registry.ts，application 测试不可 import cli。

### 2.4 linuxCronHealth 去重（item 3 附属）

`cli/cron.ts:48` `linuxCronHealth()` 与 `linuxAdapter.health()`（linux.ts:155）逐行重复。doctor 的 `CronHealthDeps.linuxCronHealth` 注入改为在 registry.ts 接线：

```ts
linuxCronHealth: () => schedulerAdapter(process.platform)?.health?.(schedulerEnv()) ?? { crontab: false, service: false },
```

doctor 仅在 linux 平台调用；其余平台 `?.health?.(...)` → undefined → 兜底 `{false,false}`，行为一致。删除 cli/cron.ts 的实现。

## 3. 兼容与迁移

- **用户可见行为零变化**：cron status/failures/check 的 stdout 行、`--json` 结构、退出码逐字保留；`cron check` alias 不变。
- **状态格式不动**：`cron.json`、`state/runs|incidents|ingest`、`.jspace-logs` envelope 均不改 schema。
- **构建脚本加前置 clean**：对产出的 binary 无行为影响；旧残留（~50 个、~3GB）在下一次构建时被一次性清理。
- **tsconfig 变更**：include 增加 `application/**/*.ts`；开启 `noUnusedLocals` + `noUnusedParameters`（对**整个程序**生效，不限于 application——见 trade-off）。
- **无关项**：本次 5 项均不触碰 templates/skills，无需重跑 gen-assets（约束中该条仅对改模板生效）。

## 4. 关键权衡

- **`noUnusedLocals`/`noUnusedParameters` 波及全程序**：开启后 cli/scripts/core/adapters/application 中所有未用局部变量/参数都会爆出。缓解：先做 item 5（去重移除 cli/cron.ts 的 `shq`/`localDate`/`localStamp` 等死代码）+ item 3（门面迁走），再开 flag，缩小爆炸面；tsc 迭代修零。若仍不可控，回退为「先加 include 不开 flag」的中间态（见 implement.md rollback）。
- **`isFile` 留在 `application/fs.ts`**：形成 adapters→application 的叶子导入。与既有 `adapters→application/errors.ts` 惯例一致，不引入新模块、不构成环；代价是该文件承担跨层共享工具角色，需保持零依赖叶子。
- **status 门面迁入 application 但 `jspaceBinary` 留在 cli**：binary/路径解析依赖 `devRoot`/`isCompiled`（embed.ts，cli 资产），迁出会让 application 依赖 cli 资产，违反红线。职责切分：application 管「状态查询/契约」，cli 管「在哪、用什么跑」。
- **round-trip 测试放 cli 层**：见 2.3，牺牲「application 测试自治」换取「真实解析器契约」。
- **execution order 微调**：PRD「1→2→5 先行」。实践上 item 5 先于 item 1（去重先于严格 flag），仍是「低风险组先行、cron 组殿后」的分组，仅组内次序调整，理由已记录在 implement.md。

## 5. 运维与回滚

- 每项独立 commit、独立可回退；风险点文件：`cli/commands/registry.ts`（3+4）、`cli/cron.ts`（3）、`tsconfig.json`（1）、`adapters/scheduler/darwin.ts`（4，仅加测试不改实现）。
- item 3 迁移时保留旧实现直到新实现 + 测试就绪再删，避免半迁移态。
- 构建 clean 只删 `^\..*\.bun-build$`（gitignore 构建残留），不碰 git 历史/已跟踪文件；`rmSync recursive` 对 Windows 安全。
- 全程门禁：`bunx tsc --noEmit` + `bun test` 全绿（297 + 新增回归）。
