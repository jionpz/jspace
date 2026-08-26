# CommandSpec、application 层与 workspace 升级

## 1. Goal

把 JSpace 的命令面从「手写 parser + 分散 handler」收敛为 **declarative CommandSpec 单一来源 + application use cases + 统一渲染**，并为工作台建立 **manifest 驱动的 diff / upgrade / ownership / recovery** 生命周期，从而闭合父任务 R3（稳定且可演进的 CLI 产品契约）与 R4（分离 CLI 生命周期与工作台生命周期）。

完成后应达到两个可观察结果：

- **命令面可演进**：新增或调整命令时，不再需要在独立 choices / help / dispatch switch 中重复登记；human 输出、JSON 输出和退出码由同一命令定义驱动并有测试。
- **工作台可安全升级**：`jspace update` 只更新 CLI 二进制；工作台内容通过 `workspace diff` / `workspace upgrade` 按 ownership（managed / seed / user）变更，冲突可检测、失败可恢复；`init --force` 不再充当升级命令。

本任务是父任务「架构澄清与可持续演进重构」的 **Child B**。范围限定在 CommandSpec 基础设施、application 层迁移和 workspace 升级；cron 与 scheduler（Child C）、asset-ingest 恢复（Child E）、skill 完整生命周期与 harness 能力矩阵（Child D）不在此范围。

## 2. Context（现状基线）

审计确认的与本任务相关事实（详见父任务 prd §5 / §5.1）：

| 现状 | 证据 |
| --- | --- |
| 命令定义三处分离：`CHOICES` 常量、各 `*_HELP` 文本、`parseXXX` switch | `cli/args.ts:21-26`、`cli/args.ts:55-299`、`cli/args.ts:416-768` |
| handler 散落在 `cli/`：`cmdInit` / `cmdDoctor` / `cmdDomain*` / `cmdResource*` / `cmdFilehubInit` / `cmdInboxStatus` / `cmdCron*` / `cmdUpdate` | `cli/init.ts`、`cli/cmds.ts`、`cli/cron.ts`、`cli/update.ts` |
| workbench 根解析不统一：`workbenchRoot() = cwd`；仅 `doctor --dir`、`cron run --dir` 支持 `--dir` | `cli/registry.ts:22-24`、`cli/args.ts:473-483`、`cli/args.ts:736-749` |
| JSON 输出由各命令手动 `JSON.stringify`，schema 无集中定义 | `cli/cmds.ts:209-219,363-383,626-639`、`cli/cron.ts`（failures JSON） |
| dry-run 仅 `cron run --dry-run`；mutating 命令无 plan / dry-run 契约 | `cli/args.ts:258-268` |
| bundle 无 manifest：`gen-assets.ts` 只生成内容 map；`DistributionManifestV1` 契约已存在但未消费 | `scripts/gen-assets.ts:32-42`、`core/contracts/distribution.ts` |
| marker v1 已落地（`workbench_id` / `template_version`），是 upgrade 版本基础 | `core/contracts/workbench.ts`、`cli/init.ts:54-61` |
| `init --force` 会对已初始化目录重新物化覆盖 | `cli/init.ts:27-31,47` |
| 物化模板时替换 `__DEV_ROOT__` 占位符，影响内容 hash 计算 | `cli/embed.ts:75-101` |

现有 95 个测试（9 个文件）不锁定 argparse 错误消息文本（cron/update 测纯函数、init 测产物），命令面迁移的回归风险可控。

## 3. Requirements

### RB1. 命令定义单一来源

- 每个命令的 name、aliases、options、positionals、help、handler 必须来自同一个 `CommandSpec` 定义；顶层/子命令的 choices 与 help 由框架从注册表生成。
- 新增一个命令时，不得修改独立的 choices 常量、help 常量或 dispatch switch。
- 参数校验（required、互斥组、类型/枚举、positionals 数量）必须声明化并由框架统一执行；错误消息与现有行为保持一致。

### RB2. 共享 workspace context 与统一 `--dir`

- 所有作用于工作台的命令通过同一 context 解析 workbench root：显式 `--dir` 优先，否则 cwd。
- `--dir` 作为框架注入的公共选项，无需每个 spec 重复声明；`doctor --dir`、`cron run --dir` 现有行为不回退。
- root 解析统一使用 `resolvePath(expandTilde())`，与现有 `cli/paths.ts`、`cli/registry.ts` 语义一致。

### RB3. 结构化结果、JSON、退出码与 dry-run 契约

- handler/use case 返回结构化 `CmdResult`（human 输出行 + 可选 `data` + 退出码 + warnings）；渲染层决定 human 还是 JSON，命令层不再直接 `console.log(JSON.stringify(...))`。
- read/status 命令提供稳定 JSON schema（字段名与当前输出兼容，集中定义并测试）。
- 退出码约定文档化：0 成功；1 业务失败；2 参数错误；健康检查类（doctor、cron check）不健康返回 1。
- mutating 命令支持 `--dry-run`：返回可检查的 plan，不产生任何外部副作用（不写文件、不碰 scheduler、不改 harness 配置）。

### RB4. application 层承载业务

- `init` / `doctor` / `domain` / `resource` / `filehub` / `inbox` 的 handler 迁移为 application use cases，返回结构化结果/plan，消费 core contracts 与 adapter 接口。
- `cli/` 只保留命令定义、参数绑定与渲染；不再在 `cli/` 内做业务分支。
- cron 命令族在 Child B 内完成 CommandSpec 注册（单一来源），但 handler 委托现有 `cmdCron*`，不在此迁移 use case（留给 Child C）。

### RB5. bundle manifest 与 freshness

- `gen-assets.ts` 生成与 `DistributionManifestV1` 契约一致的 bundle manifest（`bundle_version` + `files[]`：path / sha256 / ownership），嵌入 binary。
- 每条物化文件有 ownership：`managed`（distribution 可更新、本地修改 → conflict）、`seed`（仅缺失时创建、之后不覆盖）、`user`（schema 校验但内容不权威）。
- 提供 freshness 检查：对比 workbench 已物化文件与 manifest，能识别缺失、版本更新、本地修改与冲突；物化占位符（`__DEV_ROOT__`）的处理与 `materializeTree` 用同一纯函数，避免假阳性。
- CI 质量门包含 `bun run scripts/gen-assets.ts && git diff --exit-code`（generated asset freshness）。

### RB6. workspace diff / upgrade 生命周期

- `workspace diff`：比较 workbench 物化状态 + marker `template_version` 与 bundle manifest，输出逐条 `create / update / conflict / migrate / no-op`，不修改任何文件。
- `workspace upgrade`：基于 diff 计划执行；冲突默认拒绝（可显式覆盖授权）；修改前写 backup 快照与升级 journal，失败后可从 journal 恢复；完成后跑 doctor 验证。
- upgrade 不得触碰 gitignored 内容（`local.json`、`state/`、`logs/`）、用户 scheduler 绑定或用户 cron。
- schema 变化（如 hub 版本迁移）走显式 migrate 步骤，不隐式改写。
- `jspace update`（CLI binary）与 `workspace upgrade`（工作台内容）相互独立，互不触发。

### RB7. 禁止 `init --force` 充当升级命令

- 对已初始化工作台（存在 marker），`init` 即使带 `--force` 也拒绝重新物化，错误消息引导使用 `workspace upgrade`。
- `init` 仅用于创建新工作台；`--force` 只允许覆盖"非工作台内容的非空目录"这一原有场景。

## 4. Acceptance Criteria

### Release-Blocking

- [x] **AC-B1 / RB1**：新增一个 fixture command 只需注册 `CommandSpec`，其 top/子命令 choices、help、参数校验与 dispatch 全部自动生效；human 输出、JSON 输出与退出码均有测试。
- [x] **AC-B2 / RB2**：所有 workbench 命令接受 `--dir` 并遵循同一 cwd fallback；`doctor --dir <tmp>` 与 `cron run --dir <tmp>` 行为与迁移前一致。注：cron 命令族（除 `cron run`）的 `--dir` 统一由 Child C 完成。
- [x] **AC-B3 / RB3**：所有 read/status 命令有集中定义的稳定 JSON schema 测试；文档化退出码；mutating 命令 `--dry-run` 后 workbench 文件树与之前逐字节一致。
- [x] **AC-B4 / RB4**：`init`/`doctor`/`domain`/`resource`/`filehub`/`inbox` 的业务逻辑不再位于 `cli/`；cron 命令已在注册表登记且 handler 委托现状（行为不回退）。
- [x] **AC-B5 / RB5**：`bun run scripts/gen-assets.ts` 后无 git diff；manifest 通过 `decodeDistributionManifest`；freshness 能识别缺失文件、版本更新与本地修改。
- [x] **AC-B6 / RB6**：构造一个低 `template_version` 的旧工作台 fixture，可执行 `diff → upgrade → doctor` 全链且 user-owned 内容与本地修改不被静默覆盖；managed 文件被本地修改时 upgrade 默认拒绝并报告 conflict；upgrade 失败注入后可从 journal 恢复。
- [x] **AC-B7 / RB7**：对已初始化工作台执行 `init --force` 被拒绝并提示 `workspace upgrade`；对非工作台空目录 `init --force` 仍可初始化。
- [x] **AC-B8 / R10**：type-check、unit、asset freshness、contract、init integration 全绿；测试从 95 增至 128 不回退；临时工作台 `init → doctor → workspace diff（no-op）` 通过。

### Capability

- [x] **AC-B9 / RB3**：所有命令 human/JSON 输出由统一渲染层产生（`cli/` 内不再散落 `console.log(JSON.stringify(...))`）。
- [x] **AC-B10 / RB4**：application use case 返回结构化 plan/result，不再直接读写 process.stdout；`doctor` 的诊断分类（invalid/unbound/missing/drift）经 use case 透出并在 JSON 中保留 code/severity。

## 5. Scope

### In Scope

- `CommandSpec` 类型、注册表、解析/校验引擎与渲染层（含 fixture command 证明 AC-B1）。
- 所有现有命令迁入注册表（含 cron 命令的 spec 声明化，handler 委托现状）。
- `init`/`doctor`/`domain`/`resource`/`filehub`/`inbox` 的 application use case 迁移。
- 统一 `--dir` / `--json` / `--dry-run` context 注入与退出码契约。
- `gen-assets.ts` manifest 生成 + `DistributionManifestV1` 消费 + freshness 检查。
- `workspace diff` / `workspace upgrade`、ownership 规则、backup/journal/rollback、migrate 步、doctor 收尾。
- `init --force` 升级禁令。
- CI 质量门：type-check、unit、asset freshness、init integration。

### Out of Scope

- `project` CLI 命令（父任务 F7 的 CLI 部分，由后续 child 承担）。
- cron/scheduler 的 use case 迁移、`CronRunInvocation`、reconciliation、incidents（Child C）。
- asset-ingest journal/compensation（Child E）。
- skill 完整 manifest 生命周期、harness 能力矩阵（Child D）。
- local.json schema 升级（`harnesses`/`scheduler` 字段，触及 local v2 时由对应 child 处理）。
- 任何常驻运行时、远程插件市场或公共兼容层。

## 6. Constraints & Dependencies

- **依赖父任务已落地产物**：`core/contracts/{hub,local,workbench,distribution}.ts`、`core/registry/{effective,inspect}.ts`、`adapters/fs/workbench-state.ts`、`cli/embed.ts`（materializeTree）、marker v1。
- **依赖已存在测试**：95 个测试必须全部保持通过（迁移不得回退）。
- **不降低父任务 Product Invariants**：控制平面保持轻量可移植；不增加常驻运行时；语义判断与机械执行分离；外部变更默认可检查；本地优先且不泄密。
- **不修改真实用户环境**：upgrade 测试只在临时 workbench fixture 上执行；不得触碰真实 home harness 配置、真实 scheduler、真实 filehub。
- **manifest 与模板/物化的一致性**：所有权规则集中定义；占位符渲染逻辑单一来源。

## 7. Key Decisions

- **CommandSpec 注册表统一所有命令（含 cron）**：为保证 R3「单一来源」全面成立，cron 命令也在本任务登记 spec，但 handler 委托现有实现；use case 迁移留给 Child C。这使 Child B/C 边界清晰且互不阻塞。
- **`cli/commands/` 持 spec 与渲染，`application/` 持 use cases**：遵循父任务 design §3 目标布局；CommandSpec 定义（含 help 文本等用户面）在 cli 层，业务在 application 层。
- **失败建模沿用 `fail()` / `CliError`**：迁移期 use case 内部可抛错终止；结构化 `CmdResult` 为主路径，`CliError` 为终止/异常路径，退出码语义保持。
- **manifest 用路径前缀规则判定 ownership**：managed 模板/文档、seed skills、user 由用户创建内容；规则集中且可测，避免逐文件手写。
- **upgrade 默认保守**：任何 conflict 默认拒绝并列出，需显式授权才覆盖；备份快照 + journal 先于写操作；不触碰 gitignored 状态。
- **init 不再重新物化已初始化工作台**：`init --force` 的覆盖语义从「重新物化」收敛为「仅非空目录初始化」，升级一律走 `workspace upgrade`。
