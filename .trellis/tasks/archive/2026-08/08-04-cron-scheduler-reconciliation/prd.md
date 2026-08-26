# cron 调用契约、scheduler 对账与 incidents

## 1. Goal

把 JSpace 的定时能力从「`cli/cron.ts` 单文件 + prose 日志」收敛为 **typed `CronRunInvocation` 契约 + scheduler/harness adapters + 结构化 runs/incidents + 运维命令**，闭合父任务 R5（cron 与 scheduler 运维状态机）。完成后应达到：

- **调用契约唯一**：CLI 解析器与所有 scheduler backend 消费同一个 `CronRunInvocation`，backend 生成的 argv 必被真实 parser 接受（修复审计 F1 的位置参数/`--id` 断裂）。
- **调度可对账**：scheduler install 执行 reconciliation（安装 enabled、更新 changed、移除 disabled/deleted/stale），任务 identity 含稳定 workbench 身份，多工作台互不覆盖。
- **失败可运营**：run 有结构化状态；失败打开 incident，成功 retry 自动 resolve，ack 保留证据；`cron check` 只对未确认 incident / actionable pending 返回非 0。
- **日志契约唯一**：inbox batch 执行日志位置与 asset-ingest skill 一致（修复审计 F3），不再出现「skill 写 A 处、cron 查 B 处」。

本任务是父任务「架构澄清与可持续演进重构」的 **Child C**。范围限定在 cron 调用契约、scheduler reconciliation、runs/incidents 结构化与运维命令；skill 完整生命周期 / harness 能力矩阵（Child D）、gbrain pending envelope 完整协议（Child E）不在此范围。

## 2. Context（现状基线）

审计确认的与本任务相关事实（详见父任务 prd §5 / §5.1）：

| 事实 | 证据 |
| --- | --- |
| cron 定义是手写 JSON 校验，无 typed contract | `cli/cron.ts:18-24,51-79`（`CronRecord` + `isCronRecord`） |
| **F1**：`cron run` 解析器要求位置参数 id，而 launchd/crontab/schtasks backend 生成 `--id`；系统生成的命令会以退出码 2 失败 | `cli/cron.ts:257,303`（backend argv 含 `--id`）；cron run spec 只有 positional id |
| 三个 backend 均在 `cli/cron.ts`：launchd plist / crontab managed block / schtasks | `cli/cron.ts:177-310` |
| **F3**：asset-ingest skill 写 `<filehub>/.jspace-logs/inbox-batch.md`，而 cron runner 检查工作台 `.jspace/logs/inbox-batch.md`；pending 在 `<filehub>/.jspace-logs/*.APPLY.md` | `skills/asset-ingest/SKILL.md:86`；`cli/cron.ts:578,712-720` |
| run 状态是 prose markdown（`.jspace/logs/cron/<id>/<stamp>.md`），failures 是 prose 行（`cron-failed.md`），无结构化 machine truth | `cli/cron.ts:634-657,686-700` |
| 已实现：restricted `parseSchedule`、`harnessArgv`（claude/codex/pi）、today-success skip、lock、batch log 变化守卫 | `cli/cron.ts:97-121,493-520,564-632` |
| scheduler 任务名无 workbench 隔离（launchd `com.jspace.cron.<id>.plist`；两个工作台同名 cron 冲突） | `cli/cron.ts:178-188` |
| cron 命令已登记 CommandSpec（Child B），handler 委托 `cmdCron*`（cwd 而非 `--dir`） | `cli/commands/registry.ts` cronSpec 族 |
| 无运维命令：rehearsal（仅 `--dry-run`）、enable/disable、retry/force、ack/resolve、reconciliation 均未实现 | `cli/cron.ts`（仅 add/list/remove/install/uninstall/run/status/failures） |

现有 128 个测试中 cron 相关（`cli/cron.test.ts`）测纯函数（parseSchedule/crontabBlock/schtasks/readCronFailed），不测 parser argv round-trip 与 reconciliation。

## 3. Requirements

### RC1. 唯一 CronRunInvocation 契约

- 定义 typed `CronRunInvocation { workbench, cronId, timeoutSec?, force? }`，作为 CLI codec 与所有 scheduler backend 序列化的同一来源。
- 提供单向序列化（invocation → argv）与解析（argv → invocation）函数，`--id` 为规范形式；`cron run` 同时接受 `--id ID` 与位置参数 `id`。
- 契约测试：三个 scheduler backend 生成的 argv feed 回真实 parser 必须成功解析出同一 invocation，且 `--dry-run` 无外部副作用。

### RC2. scheduler adapter 与 reconciliation

- 抽象 scheduler adapter：`inspect(workbenchId) -> InstalledTask[]`、`plan(desired, installed) -> Op[]`（create/update/delete）、`apply(plan) -> results`。
- launchd / crontab / schtasks 各自实现 adapter；平台差异（任务名、log 重定向、权限）封装在 adapter 内。
- `cron install` 执行 reconciliation：创建 enabled、更新 changed（schedule/prompt/harness 变化）、移除 disabled/deleted/stale 任务。
- 任务 identity 必须包含稳定 workbench 身份（marker `workbench_id` 或 derived hash），禁止不同工作台互相覆盖或卸载对方任务。

### RC3. 结构化 runs / incidents

- 每次 run 写结构化记录到 `.jspace/state/runs/<cron>/<run-id>.json`（exit/status/timeout/output 指针/batch 变化），prose 日志保留人类可读但不再是机器真理。
- failed/suspect run 打开或更新 incident（keyed by cron + failure class）；成功 retry 自动 resolve；`cron ack` 记录"已确认"但保留证据。
- `cron check` / `cron failures` 基于结构化状态：仅未 ack 的 open incident 或 actionable pending write 使其返回非 0；已 ack 的不重复告警。

### RC4. 运维命令

- `cron run` 支持 `--force`（跳过 today-success skip）与 `--timeout`；`--dry-run` 打印将执行的 argv 无副作用（已有，保留）。
- `cron enable <id>` / `cron disable <id>`：修改 cron 定义 enabled 标志；install 后下次 reconciliation 应用。
- `cron ack [id]`：确认仍 open 的 incident（不删除证据）；`cron resolve <id>` 可选。
- `cron status [id]` 基于结构化 runs 输出最近状态；`cron failures` 整合 incidents + pending。

### RC5. F3 统一 inbox batch 日志契约

- inbox batch 执行日志与 pending APPLY 扫描使用同一 `<filehub>/.jspace-logs/` 位置；cron runner 的 batch 变化守卫读取与 asset-ingest skill 写入的同一文件。
- 移除「skill 写 A、cron 查 B」的双路径；doctor / failures / run 守卫共享同一解析逻辑。

### RC6. 平台能力如实表达

- macOS / Linux / Windows 的 scheduler 能力（launchd / crontab / schtasks）与 harness argv 在支持矩阵中如实标注 automated / best-effort / manual / unsupported。
- 无法在 CI 验证的真机 scheduler 行为进入手动验证矩阵，不由纯函数测试宣称已验证。

## 4. Acceptance Criteria

### Release-Blocking

- [x] **AC-C1 / RC1**：`CronRunInvocation` 序列化→argv→解析 round-trip 测试通过；三个 backend 生成的 argv 均被真实 parser 接受并解析为同一 invocation；`--dry-run` 不产生任何文件/系统副作用。
- [x] **AC-C2 / RC1**：`cron run --id <id> --dir <root> --timeout N --force` 与位置参数 `cron run <id>` 均可用，语义一致；审计 F1 关闭（backend argv 不再退出码 2）。
- [x] **AC-C3 / RC2**：reconciliation 纯函数测试覆盖 create enabled / update changed / delete disabled+deleted+stale；两个 workbench 的 task identity 不冲突；uninstall 不影响另一工作台（纯函数 + dry-run 验证；真实 apply 的 tag 卸载为 M5 已知遗留，见 implement.md）。
- [x] **AC-C4 / RC3**：失败 run 打开 incident；成功 retry 后 incident 自动 resolve；ack 保留证据且不再重复告警；存在未 ack open incident 或 actionable pending 时 `cron check` 返回非 0，否则 0。
- [x] **AC-C5 / RC3**：runs 写入结构化 `.jspace/state/runs/` JSON（含 exit/status/timeout/out 指针）；`cron status` / `cron failures` 从结构化状态计算，prose 日志仅作人类 payload。
- [x] **AC-C6 / RC5**：cron runner 的 inbox batch 变化守卫与 asset-ingest skill 读取同一 `<filehub>/.jspace-logs/inbox-batch.md`；F3 关闭（无双路径）。
- [x] **AC-C7 / RC4**：`cron enable/disable/ack` 修改状态并有退出码；`cron run --force` 跳过 today-success；全部命令经 CommandSpec 单一来源 + use case，退出码契约一致。
- [x] **AC-C8 / RC6**：平台支持矩阵文档化（launchd/crontab/schtasks × automated/best-effort/manual/unsupported），真机行为列入手动验证矩阵。

### Capability

- [x] **AC-C9 / RC2**：`cron install` 在 reconciliation 后报告 create/update/delete 清单（dry-run 可预演），真实 scheduler 变更仅在实际 apply 时发生。
- [x] **AC-C10 / RC3**：incident 结构化状态与 runs 可被 doctor / `cron check` / 未来 skill 一致消费（单一 reader 不 re-parse prose）。

## 5. Scope

### In Scope

- `CronRunInvocation` 契约 + argv codec + parser 集成（含 `--id`/`--force`/`--timeout`/`--dir`）。
- scheduler adapter interfaces + launchd/crontab/schtasks 实现 + inspect/plan/apply reconciliation + workbench-scoped identity。
- runs/incidents 结构化状态（`.jspace/state/`）+ 迁移 prose → JSON。
- 运维命令 use cases：`cron run --force/--dry-run`、`enable/disable`、`ack`、`status`、`failures`。
- F3 统一 inbox batch 日志契约（`<filehub>/.jspace-logs/`）。
- harness adapter（claude/codex/pi argv 生成）抽为独立模块。
- 纯函数 + fixture 测试（argv round-trip、reconciliation、incidents、run 状态迁移）；不触碰真实 scheduler。
- 平台支持矩阵文档。

### Out of Scope

- skill 完整 manifest 生命周期、harness 能力矩阵、默认 cron skill targets（Child D）。
- gbrain pending write envelope 完整协议（producer/apply/ack/retry；Child E）；本任务仅保留 APPLY.md 扫描。
- local.json schema 升级（`harnesses`/`scheduler` 字段）。
- 真实系统 scheduler 的自动安装/卸载测试（保持手动验证矩阵）。
- 任何常驻 daemon 或事件网关。

## 6. Constraints & Dependencies

- **依赖 Child B 已落地产物**：CommandSpec 框架、application/commands/command.ts、`application/errors.ts`、`cli/commands/registry.ts` cron spec 族（handler 待从委托迁入 use cases）、`.jspace/state/` 预留、marker v1（workbench_id）、core/registry effective/inspect。
- **依赖已存在测试**：128 个测试必须全部保持通过（cron 迁移不得回退）。
- **不降低父任务 Product Invariants**：不增加常驻运行时；外部变更默认可检查（reconciliation 先 plan/dry-run）；本地优先且不泄密（incident/run 不记录密钥）。
- **不修改真实用户环境**：所有 reconciliation/install/run 测试只发生在临时 fixture；不触碰真实 launchd/crontab/schtasks。
- **结构化状态位置**：runs/incidents 在 `.jspace/state/`（gitignored），与 materialized journal（Child B）一致。
- **跨 child 契约**：`CronRunInvocation` 形状、incident 状态机、runs 记录 schema 定稿后可被 Child D/E 引用。

## 7. Key Decisions

- **`--id` 为 scheduler 规范 argv 形式**：`cron run --id <id> --dir <root> [--timeout] [--force]`；位置参数保留为交互便捷形式。修复 F1 且不破坏现有 cron run 用法。
- **workbench 身份用 marker `workbench_id` 派生**：scheduler task 名含稳定 workbench 标识（launchd plist 名 / crontab 注释 / schtasks 任务名），跨工作台互不覆盖；短 hash 用于平台名长度限制。
- **reconciliation 默认 dry-run 可预演**：`cron install` 输出 create/update/delete 计划；真实 apply 是显式动作（或 `--apply` 确认）。
- **incident 只对 open 且未 ack 的告警**：`cron check` 非 0 仅当存在未 ack open incident 或 actionable pending write；已 ack 保留证据但静默。
- **prose 日志降级为人类 payload**：结构化 runs/incidents 是机器真理；`cron status`/`failures`/doctor 一律从结构化状态计算。
- **scheduler 能力如实分级**：不把「launchd 只在 macOS」描述为全平台；平台矩阵标注 automated/best-effort/manual/unsupported。
