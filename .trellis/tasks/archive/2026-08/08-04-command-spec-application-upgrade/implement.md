# CommandSpec、application 层与 workspace 升级 — Implementation Plan

## Execution Strategy

按「先框架、后迁移、再升级」分 7 个里程碑顺序落地，每个里程碑保持主干可运行（`bunx tsc --noEmit` + `bun test` 绿 + 临时工作台 `init → doctor` 通过），独立提交、独立回滚点。所有外部副作用（文件写入、journal）只发生在临时 workbench fixture 上，不触碰真实用户环境。

## Milestones

### M1 — CommandSpec 框架（additive，不改变现有行为）

- [x] 新建 `application/commands/command.ts`：`PositionalSpec` / `OptionSpec` / `OptionGroup` / `CommandFeatures` / `CommandSpec` / `CmdContext` / `CmdResult` 类型。
- [x] 实现解析引擎：spec → help 生成、`collect` 选项收集（沿用 `cli/args.ts:341-392` 语义）、校验顺序（required → 互斥组 → validate → extra positional）、children 递归 dispatch。
- [x] 实现纯渲染 `render(ctx, result) -> string[]`；`cli/main.ts` 打印。
- [x] 注册一个 **fixture command**（测试专用）证明 AC-B1：只注册 spec，choices/help/校验/dispatch 全部自动生效。
- [x] 测试：engine 单测 + fixture command 的 human/JSON/exit code 断言 + 错误消息快照（与现有 argparse 措辞一致）。

验证门：

```bash
bunx tsc --noEmit
bun test
```

回滚点：M1 纯新增，不接线现有命令；问题直接删 `application/commands/` 即可。

### M2 — 命令迁入注册表（单一来源，删除 args.ts）

- [x] 建 `cli/commands/registry.ts` 顶层 `COMMANDS[]`。
- [x] 逐个注册：`init` / `doctor` / `domain{list,add,remove}` / `resource{list,add,remove}` / `filehub{init}` / `inbox{status}` / `update` —— handler 先经 `delegate()` 包装现有 `cmd*`，行为逐字节一致。
- [x] 注册 cron 全族：`add/list/remove/install/uninstall/run/status/failures|check`，spec 声明化（含 `--schedule/--harness/--prompt` required、`--timeout` Number 校验、`failures|check` alias、`run` 的 `--dir`），handler 委托现有 `cmdCron*`。
- [x] `cli/main.ts` 从 `COMMANDS[]` dispatch；删除 `cli/args.ts` 中的 `*_CHOICES`、`*_HELP`、`parseArgs` switch。
- [x] 逐命令对照：help 文本、`jspace <cmd>: error:` 措辞、退出码 2/1/0 与迁移前一致。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(109)、`--help` choices 一致、`cron run` 缺 id → exit 2 措辞一致、临时工作台 init→doctor→domain/resource/inbox/cron 全命令族一致。

验证门：

```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts --help          # 顶层 choices 一致
bun run cli/main.ts cron run        # 缺 id → 退出码 2、措辞一致
```

回滚点：M2 是提交级别的整块迁移；若某命令表面不一致，回退该命令的注册，保留旧 handler。删除 `args.ts` 前先确认 `cli/cron.test.ts`、`cli/init.test.ts` 全绿。

### M3 — application use case 迁移（非 cron）

- [x] `application/workspace/init.ts`：`cmdInit` 迁入，返回 `CmdResult`；保留 marker/local 写入、legacy-layout guard。
- [x] `application/workspace/doctor.ts`：`cmdDoctor` 迁入，包装 `inspectWorkbench`；JSON 输出保留 `code`/`severity`；errors → exit 1。
- [x] `application/registry/domain.ts` / `resource.ts`：`cmdDomain*` / `cmdResource*` 迁入；保留 `writeHubAtomic` / `writeHubAndLocal` 与 skeleton 回滚、孤儿 binding 检查。
- [x] `application/registry/filehub.ts` / `inbox.ts`：`cmdFilehubInit`（含 `registerFilehub`）/ `cmdInboxStatus` 迁入。
- [x] `cli/cmds.ts` 清理：业务逻辑移除后删除或降为薄 spec handler 绑定。
- [x] `cli/registry.ts` 的辅助函数（`isWithin`/`cleanTags`/`findIndex`/`loadHub`/`loadLocal`）决定归属：可被 `application/` 复用则上移，其余随 `cli/` 收敛。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(109)、`cli/cmds.ts`/`cli/init.ts` 已删除、`cli/registry.ts` 精简为 cron 用 helper、临时工作台 init→doctor→domain/resource/filehub/inbox 全命令族一致。doctor 的 warning 流从 stdout 收敛到 stderr（`CmdResult.warnings`），summary 仍在 stdout。

验证门：

```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts init <tmp> && bun run cli/main.ts doctor --dir <tmp>
bun run cli/main.ts domain list --dir <tmp> --json
bun run cli/main.ts resource add --dir <tmp> --domain files --path /tmp/x demo   # 互斥/校验一致
```

回滚点：use case 逐命令迁移并独立提交；`cli/cmds.ts` 只在全部 use case 就位后删除。

### M4 — context / 渲染 / 退出码统一

- [x] 所有 workbench 命令 spec 声明 `features: { dir: true }`，引擎统一注入 `--dir`；`--json` 注入 read/status；`--dry-run` 注入 mutating。
- [x] 读/状态命令（domain list / resource list / inbox status / cron list / cron failures）JSON schema 集中定义并有断言测试。
- [x] 退出码约定写入命令 help/文档：0 成功；1 业务失败/不健康；2 参数错误。
- [x] mutating 命令（resource add/remove、domain add/remove、filehub init、workspace upgrade）支持 `--dry-run`：返回 plan，不写文件（可用 `git` 或文件树 hash 断言无副作用）。
- [x] `cli/` 内不再散落 `console.log(JSON.stringify(...))`（AC-B9）。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(116)、`--dry-run` 后 hub/local/文件树逐字节不变（hash 断言）、`--dir` 对 domain/resource/filehub/inbox 生效、顶层 `--help` 含退出码说明。注：cron 命令族的 `--dir` 统一留给 Child C（委托 `cmdCron*` 仍用 cwd；`cron run --dir` 保持显式）。`--dry-run` 的 args key 用 `dest: "dryRun"` 映射（`--dry-run` → `dry_run` 默认转换不匹配）。

验证门：

```bash
bunx tsc --noEmit
bun test
# dry-run 后 workbench 文件树逐字节一致（含 .jspace/state/journal 未产生）
```

回滚点：context 注入与渲染集中，若破坏某命令输出，仅回退该命令的 `features` 声明。

### M5 — bundle manifest 与 freshness

- [x] `scripts/gen-assets.ts` 扩展：输出 `cli/manifest.generated.ts`（`BUNDLE_MANIFEST: DistributionManifestV1`，`bundle_version = VERSION`，`files[]` 含 `sha256` + `ownership`）。
- [x] `ownershipFor(rel)` 前缀规则单一来源（`skills/** → seed`，其余模板 → managed）。
- [x] 抽取 `materializedRel(key)` 路径映射（复用 `cli/embed.ts:85-95` 逻辑）。
- [x] 实现 freshness 检查（`application/workspace/` 内纯函数）：期望 hash（manifest 原始内容）vs 当前 hash vs journal hash 三态判定。
- [x] 测试：gen 无 git diff、manifest decode ok、freshness 识别 create/update/conflict/no-op。

验证门（已通过）：`bun run scripts/gen-assets.ts` 后 `cli/assets.generated.ts` 无 git diff（20 文件,内容一致）；`cli/manifest.generated.ts` 首次生成（20 文件,13 seed + 7 managed,decode ok）；freshness 5 判定（create/no-op/update/conflict/skip/stale）测试；`bun test`(121)、`bunx tsc --noEmit` 全绿。freshness 与 `workspace diff` 命令接线在 M6。

验证门：

```bash
bun run scripts/gen-assets.ts && git diff --exit-code cli/assets.generated.ts cli/manifest.generated.ts
bunx tsc --noEmit
bun test
```

回滚点：gen-assets 变更独立提交；manifest 与 ownership 规则在共享模块，出问题只影响 diff（upgrade 未开放前无数据风险）。

### M6 — workspace diff / upgrade

- [x] `application/workspace/diff.ts`：`workspace diff [--dir] [--json]`，输出 `DiffEntry[]`（create/update/conflict/stale/no-op/migrate），不修改文件。
- [x] init 时写物化 journal `.jspace/state/materialized.json`（gitignored）。
- [x] `application/workspace/upgrade.ts`：`workspace upgrade [--dir] [--dry-run] [--accept-conflicts]` —— diff → 冲突默认拒绝 → backup `before/` + journal → 原子 apply → 刷新 journal → 更新 marker `template_version` → doctor 收尾。
- [x] `--rollback <id>`：从 journal + backup 恢复，回退 marker。
- [x] `migrate` 钩子预留（本 child 为空实现，schema 版本差走显式迁移）。
- [x] 明确 `workspace upgrade` 永不触碰 gitignored（local.json/state/logs）、用户 scheduler、用户 cron。
- [x] 测试 fixture：
  - 新 init → diff 全 no-op；
  - 老 fixture（低 `template_version`、无 journal）→ `diff → upgrade → doctor`，user 文件保留；
  - managed 文件被改 → conflict + 默认拒绝；
  - seed 文件被改 → upgrade 不覆盖；
  - apply 中途失败注入 → journal `failed` + `--rollback` 恢复字节。

验证门（已通过）：`bunx tsc --noEmit`、`bun test`(127)、CLI 全链 `init → workspace diff(no-op) → 老 fixture diff → upgrade --accept-conflicts → doctor → 再次 diff(no-op) → managed 修改 → conflict 拒绝 → upgrade --dry-run(plan 不 fail) → rollback 恢复`。`--accept-conflicts` 覆盖本地修改的 managed 文件；`--dry-run`/`--rollback` 不跑 follow-up doctor（预览/历史恢复均避免状态噪声）。upgrade 成功输出 journal id 供 `--rollback`。

验证门：

```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts init <tmp>
bun run cli/main.ts workspace diff --dir <tmp>       # 全 no-op
# 老 fixture：diff → upgrade → doctor；冲突拒绝；rollback 恢复
```

回滚点：upgrade 的 backup/journal 全在 gitignored `.jspace/state/`；开放 apply 前所有 pure/fixture 测试通过；真实用户工作台永不作为自动测试对象。

### M7 — `init --force` 禁令 + CI 质量门

- [x] `init` 对已存在 marker 的工作台一律拒绝（含 `--force`），提示 `jspace workspace upgrade`；`--force` 仅保留"非空非工作台目录初始化"语义。
- [x] CI / 本地验证脚本加入：type-check、unit、`gen-assets` freshness、manifest decode、init integration（AC-B8/AC13）。
- [x] 全链验收：`init → doctor → domain/resource → filehub → cron rehearsal(只读) → workspace diff → workspace upgrade` 在临时 fixture 上通过，且不触碰真实系统状态。
- [ ] `.trellis/spec/backend/` 真实目录/错误/日志约定由父任务 Child F 填充（本任务交付的 CommandSpec/退出码/JSON 契约已在代码与顶层 help 固化）。

验证门（已通过）：新增 `.github/workflows/verify.yml`（PR/push：tsc → `bun test` → office-extract → gen-assets freshness → init integration）；本地跑 verify 全流程通过（128 测试、asset 无 diff、doctor ok + workspace diff no-op）；`init --force` 对已初始化工作台拒绝（测试 + CLI 验证）。

验证门：

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts && git diff --exit-code cli/assets.generated.ts cli/manifest.generated.ts
# 临时工作台全链；init --force 对已初始化被拒绝
```

回滚点：M7 只改 init guard 与 CI，独立提交；guard 回归仅影响 init 语义，可单条回滚。

## Review Gates

- [x] M1/M2 完成后 review CommandSpec 框架与迁移面（错误消息一致性、fixture 命令 AC-B1）。
- [x] M5/M6 完成后 review manifest/ownership 规则与 diff/upgrade 判定表（对照 design §8.3）。
- [ ] 每个里程碑完成时运行 `trellis-check`（M7 后执行最终全量）。
- [x] 不在任何 automated test 中修改真实用户 home harness 配置、真实 scheduler 或真实 filehub。
- [ ] 任务收尾：父任务 acceptance mapping 更新（AC4/AC5/AC13/AC16 及 AC-B1~B10），Child C/D/E 的依赖契约（CommandSpec 形状、manifest 路径映射、journal 位置）定稿后可被引用。

## Pre-Start Checklist

- [x] 用户已审阅并批准本 task 的 Goal、Requirements、Acceptance Criteria、Key Decisions。
- [x] 批准后 `task.py start`，从 M1 开始逐里程碑实施。
- [x] 父任务保持 planning；本任务为父任务第一个激活的 child。
