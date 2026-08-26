# 发布前架构收敛

## 1. Goal

在首次正式发布前完成一次有边界的架构收敛：修复 scheduler 在多工作台和 Windows 上无法可靠收敛的问题，统一恢复关键 machine truth 的合同与写入纪律，并清理会持续放大维护成本的依赖边界。

本任务不追求整体重写或理论上的 Clean Architecture。用户价值是让 JSpace 在真实多机、多工作台、跨平台环境中可预测、可恢复、可持续演进。

## 2. Background

- 当前项目已形成 `core/contracts -> core/registry -> adapters + application -> cli` 的实用分层，且 init、doctor、registry、filehub、cron dry-run、workspace diff/upgrade 全链 smoke 已通过。
- 当前质量基线为 `bunx tsc --noEmit` 通过、`bun test` 305 pass / 0 fail、skill manifest 与 generated asset freshness 检查通过。
- Linux scheduler 的 managed block marker 是进程用户级全局常量，不含 workbench tag。第二个工作台安装会替换第一个工作台的 block，任一工作台卸载会移除全部 JSpace cron。证据：`adapters/scheduler/linux.ts:13-14,47-69,140-152`。
- Windows desired task id 为 `com.jspace.cron.<tag>.<id>`，但 `schtasks` inspect 返回 `JSpaceCron_<tag>_<id>`；reconciliation 按 `taskId` 匹配，可能生成 create 后紧接 delete 的计划。证据：`cli/commands/registry.ts:328-363`、`adapters/scheduler/win32.ts:99-108`、`application/automation/scheduler.ts:33-50`。
- run、incident、materialized journal、upgrade journal 的运行时解码和原子写纪律不一致。恢复证据损坏时，部分路径会静默当成记录不存在。证据：`application/automation/runs.ts:36-44`、`application/automation/incidents.ts:32-40`、`application/workspace/journal.ts:30-51`、`application/workspace/workspace.ts:104-125`。
- application 与 adapters 之间仍存在少量双向引用；`application/fs.ts`、`application/errors.ts` 和纯 schedule parser 实际承担 shared-kernel 职责。
- `cli/commands/registry.ts` 是 683 行热点，cron install handler 同时承担命令绑定、desired task 编译和平台 batching。
- `GOAL.md` 仍是最高对齐物：不引入常驻运行时、事件网关、自研执行器、自研同步或重资产全量 embedding。

## 3. Requirements

### R1. Scheduler identity 与多工作台所有权（P0）

- Linux managed block 的 start/end marker 必须包含稳定 workbench tag。
- install、update、delete、uninstall 只能修改当前 workbench 的 block，必须保留用户 crontab 内容及其他工作台 block。
- Windows desired、inspect、apply、delete 必须共享同一个 canonical platform task identity。
- scheduler reconciliation 必须满足幂等和收敛：首次 install 为 create；相同配置再次 install 为 no-op；schedule/argv 改变为 update；disable/remove 为 delete。
- 未发布阶段不承担旧版无 tag block 的兼容迁移；遇到 legacy block 时必须采用明确、可诊断且不会误删其他内容的处理策略。

### R2. Machine truth 合同与持久化纪律（P1）

- RunRecord、Incident、MaterializedJournal、UpgradeJournal 都必须有版本化运行时 decoder，并严格校验恢复或状态判断所依赖的字段。
- recovery-critical journal 损坏必须 fail loud，错误应指出文件和修复方向，不能退化成“不存在”。
- run/incident 中的损坏记录必须产生可观测 diagnostics，不能被 `readJsonRecords()` 静默跳过。
- 所有上述状态写入统一采用同文件系统内 atomic replace；不得留下可被读取为完整状态的部分 JSON。
- 新合同遵守项目现有 strict decoder、stable diagnostic code 和 unsupported-version 约定。

### R3. 依赖边界收敛（P1）

- 消除 production adapters 对 application utility 模块的反向依赖；通用 error、JSON/fs helper、纯 schedule 解析归入明确 shared boundary。
- application 不引用 cli；core 不引用 application、adapters 或 cli。
- 增加可自动执行的 import-boundary gate，防止层级环重新出现。
- 不引入 DI container、动态插件系统、framework 或 monorepo 拆分。

### R4. CLI 与 automation 可维护性（P2）

- 将 cron desired compilation 和平台 reconciliation wiring 从 CLI command handler 收敛到明确的 application/platform service；CLI 只负责组合依赖和参数绑定。
- 按 command family 拆分 `cli/commands/registry.ts`，保持 CommandSpec 行为、help、输出和 exit code 不变。
- executor lock 使用排他创建并在 `finally` 清理；输出上限按 byte/count 累计，避免重复 join；覆盖 Windows `.cmd/.bat` argv/quoting 风险。
- 删除确认无生产消费者的死门面；对 `Project.status=archived` 与 CLI 生命周期能力不对称作出显式决定。

### R5. Release gate 一致性（P2）

- CI 增加 Linux 双工作台 block convergence 和 Windows adapter identity convergence 测试，不依赖真实用户 scheduler。
- 评估并统一 `.github/workflows/build.yml` 与 `scripts/build-all.ts` 的 Windows x64 target；发布兼容性说明必须与实际 target 一致。
- 保持模板、skills、generated assets 和 CLI smoke 的既有质量门。

## 4. Acceptance Criteria

- [ ] **AC1 / R1**：两个 Linux workbench 依次 install 后各自 block 同时存在；更新或卸载其中一个不会改变另一个 block或用户 crontab 行。
- [ ] **AC2 / R1**：Windows reconciliation 测试证明 create -> no-op -> update -> delete 的完整收敛序列，不出现同一实际 task 的 create+delete 计划。
- [ ] **AC3 / R1**：Darwin、Linux、Windows 的 desired identity、inspect identity 和 apply handle 契约均有 adapter-specific 测试。
- [ ] **AC4 / R2**：四类 machine truth 均有 versioned decoder；valid、invalid、unknown field、unsupported version 和 truncated JSON 测试通过。
- [ ] **AC5 / R2**：materialized/upgrade journal 损坏会给出明确错误；run/incident 损坏产生 diagnostics；所有关键写入通过 atomic-write fault tests。
- [ ] **AC6 / R3**：自动边界检查通过，production adapters 不再 import application，application/core 的禁止方向均被 gate 覆盖。
- [ ] **AC7 / R4**：cron CLI handler 不再编译平台任务内容；命令拆分后现有 command/help/exit-code snapshots 或等价测试无回归。
- [ ] **AC8 / R4**：executor lock 竞争、异常清理、输出上限和 Windows argv 情形有测试，失败后不会永久遗留无效 lock。
- [ ] **AC9 / R5**：Windows x64 build target 只有一个权威选择，CI、本地 build 脚本及兼容性文档一致。
- [ ] **AC10 / 全局**：`bunx tsc --noEmit`、`bun test`、`bun run scripts/check-skills.ts` 和临时工作台 full-chain smoke 全部通过。
- [ ] **AC11 / 全局**：实现保持 GOAL.md 非目标，不引入 daemon、事件网关、自研执行器、自研同步、插件框架或兼容层。

## 5. Out of Scope

- 整体重写 JSpace 或替换 Bun/TypeScript 技术栈。
- 把模块化单体拆成 monorepo、服务或动态插件架构。
- 封装 gbrain、实现新的 harness runtime 或文件同步系统。
- 扩展 cron schedule 产品能力；本任务只修 identity、ownership、reconciliation 和可靠性。
- 对从未正式发布的 scheduler marker 提供长期迁移/弃用通道。
- 与本任务无关的 CLI 文案、模板内容和 domain/resource schema 重构。

## 6. Key Decisions

- **不整体重写**：保留 portable/local registry、strict contracts、ingest 状态机、workspace ownership/upgrade、skill manifest 和 Bun 单仓结构。
- **逻辑身份与平台 handle 分离**：reconciliation 的身份必须由 adapter 契约统一产生，不能由 CLI 与 adapter 各自拼接。
- **恢复证据优先 fail loud**：upgrade/materialized journal 的错误不能被容错读取掩盖；运行历史可继续读取其他记录，但必须报告损坏项。
- **小范围 shared boundary**：只移动确实被双向依赖的通用模块，并用 gate 固化，不做全量 ports-and-adapters 改写。
- **阶段交付**：P0 scheduler 修复先独立通过；P1 state contracts 和 boundaries 其次；P2 可维护性整理最后进行，任何阶段不得以扩大重构范围为代价。

## 7. Risks And Deferred Items

- 真实 scheduler apply 会改变机器级状态；自动测试以纯函数、fake process/fs port 和临时目录为主，真机验证应使用专用测试条目和可回滚步骤。
- Windows `schtasks` XML 与 shell quoting 需要平台 runner 验证；非 Windows 主机上的单元测试不能替代 release matrix。
- CLI 文件拆分容易产生 generated asset 或 help 顺序漂移，必须使用现有输出测试约束。
- Project archive 命令是否进入本任务，取决于实现阶段确认其是否已有产品需求；若没有，只记录决策并留后续任务，不为对称性强行加功能。

## 8. Planning Status

- 架构与代码证据审计完成，无阻塞性产品开放问题。
- `design.md` 和 `implement.md` 已建立；task 保持 `planning`。
- 下一步是用户 review 本规划；只有后续明确批准后才运行 `task.py start` 并进入实现。
