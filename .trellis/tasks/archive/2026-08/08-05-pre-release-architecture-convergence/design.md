# 发布前架构收敛：技术设计

## 1. Design Principles

1. 保留现有模块化单体，只修复会破坏状态安全、跨平台收敛和依赖可守性的边界。
2. logical cron identity、platform task handle 和 scheduler content 分开建模，平台命名只能由 adapter 的单一实现产生。
3. machine truth 必须满足 typed contract、runtime decode、version、diagnostics、atomic write 五项要求。
4. CLI 是 composition root，不拥有 scheduler 领域决策或平台内容编译。
5. 每个重构步骤先用 characterization test 固定现状，再移动职责，避免把结构调整和行为变化混在一起。

## 2. Target Boundaries

```text
core/contracts
  - versioned machine-state schemas and decoders
  - no filesystem/process/application imports

core/registry
  - portable/local effective registry logic

shared (exact directory chosen against existing spec before implementation)
  - CliError/fail primitives
  - generic atomic JSON/fs helpers
  - pure schedule parsing where shared by application and adapters

application
  - use cases and reconciliation decisions
  - logical cron model
  - workspace/ingest/automation state machines

adapters
  - canonical platform task identity
  - inspect/apply/uninstall and platform content compilation
  - filesystem/process implementations

cli
  - CommandSpec tree, argument binding and dependency composition
```

禁止方向由自动 gate 表达，而不是依赖文档记忆：`core -> higher layers`、`application -> cli`、`adapters -> application` 均禁止。若 shared 的最终落点不是 `core/shared`，仍需保持其不依赖 application/adapter/cli。

## 3. Scheduler Model

### 3.1 Identity

每个平台 adapter 提供唯一 identity function，例如：

```ts
interface SchedulerIdentity {
  logicalId: string;   // stable workbenchTag + cronId identity
  taskId: string;      // platform inspect/apply handle
}

interface SchedulerAdapter {
  identity(tag: string, cronId: string): SchedulerIdentity;
  inspect(tag: string, env: SchedulerEnv): InstalledTask[];
  apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[];
}
```

`DesiredTask.taskId` 和 `InstalledTask.taskId` 必须来自同一个 adapter identity。`cronId` 保留为业务字段，但 reconciliation 不再依赖 CLI 拼接平台名称。

Darwin/Linux 可继续使用 `com.jspace.cron.<tag>.<id>`；Windows 使用实际 `schtasks` handle `JSpaceCron_<tag>_<id>`。是否保留额外 logicalId 在实现前以最小改动原则决定，但不得存在两个互不一致的 taskId 生成点。

### 3.2 Linux Block Ownership

marker 采用 tag-scoped 形式：

```text
# jspace crons <tag> (managed) DO NOT EDIT
...
# end jspace <tag>
```

block parser/replacer 接收 tag，只定位该 tag 的一对 marker。它必须：

- 保留 marker 外所有字节语义和其他 JSpace block。
- 检测当前 tag 的 duplicate、unterminated、stray、out-of-order marker 并 fail loud。
- 空 desired set 只移除当前 tag block。
- legacy untagged marker 不被隐式认领；返回明确诊断，要求清理或使用一次性显式处理。

Linux apply 仍可一次重建当前 workbench 的完整 block，因为 crontab 的写入原语是整文件替换；batching 由 scheduler service 管理，不留在 CLI handler。

### 3.3 Reconciliation Invariants

对每个平台都验证以下状态转换：

| Desired | Installed | Operation |
| --- | --- | --- |
| present | absent | create |
| same schedule + argv | same identity | no-op |
| changed schedule or argv | same identity | update |
| absent | present | delete |

`apply(plan(desired, inspect(after apply)))` 必须得到空 plan。两工作台的 desired/installed 集合必须互不影响。

## 4. Machine-State Contracts

为四类状态建立 `core/contracts` decoder：

- `RunRecordV1`
- `IncidentV1`
- `MaterializedJournalV1`
- `UpgradeJournalV1`

合同统一包含 `version: 1`，strict unknown-field 策略遵循现有 contract spec。decoder 返回项目现有 diagnostics 结构，不以 TypeScript cast 代替运行时校验。

读取策略分两类：

- **Recovery critical**：materialized/upgrade journal 无效时抛出带路径的 `CliError`，禁止返回 `null`。只有文件确实不存在才返回 `null`。
- **Historical collection**：run/incident 单个损坏文件不阻断其余记录读取，但 API 必须同时返回 diagnostics，供 status/doctor 展示；不得静默过滤。

写入统一复用一个 atomic helper：同目录临时文件、完整写入、必要时 flush、rename replace、失败清理临时文件。fault test 覆盖写中断和 rename 失败，不破坏旧有效文件。

## 5. CLI And Service Split

新增或扩展 scheduler application service，输入为 root、cron definitions、adapter、env 和 skill-target validator，输出 `CmdResult`。service 负责：

- 过滤 enabled cron。
- 调用 adapter identity/content compiler 构造 desired tasks。
- inspect、plan reconciliation、dry-run rendering。
- Linux whole-block batch 与其他平台 per-task apply 的统一调度。

CLI handler 仅解析 `--dir/--dry-run`、选择平台 adapter、注入 generated manifests 和调用 service。

随后把 command registry 按现有 family 拆成 registry、project/filehub、cron、workspace/update 等模块；根 registry 只组装顺序。CommandSpec engine 的目录移动只在不扩大变更面时进行，否则延期。

## 6. Executor Hardening

- lock 使用 `openSync(path, "wx")` 或注入的等价 exclusive-create port。
- 从取得 lock 后开始由单个 `try/finally` 负责释放；释放时校验 ownership token，避免删除后来进程的 lock。
- stdout/stderr 分别累计长度或 byte count，达到上限后停止追加，不在每个 chunk 上 `join()`。
- Windows `.cmd/.bat` 通过参数数组和可测试 command builder 处理；必要的 `shell: true` 行为用 Windows runner 验证，不拼接未经引用的命令字符串。

## 7. Compatibility And Rollback

- 项目未正式发布，scheduler marker/schema 不提供兼容层；错误必须可诊断，避免默默迁移错误状态。
- 每个 phase 保持独立提交能力。P0 scheduler 修改不得依赖 P1/P2 才能正确运行。
- state contract 上线前先增加 decoder characterization tests；若读取策略导致现有 fixture 暴露损坏，修复 fixture 或明确数据处理，不降低 decoder。
- CLI 拆分只移动代码，不改变 public command surface；任何输出变化必须在 PRD 中另行批准。

## 8. Verification Strategy

- Pure tests：identity、reconciliation table、Linux tagged block parser/replacer、decoders。
- Adapter tests：fake `spawnSync`/fs 验证 inspect/apply handle 一致。
- Fault tests：atomic state writes、exclusive lock、cleanup finally。
- Integration：临时工作台 full chain；scheduler 使用隔离 fake 或 dry-run，不触碰真实用户 crontab/launchd/schtasks。
- Platform matrix：Windows runner 验证 `schtasks` name/argv；release build 验证 x64 target 一致。
