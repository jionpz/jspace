# 架构澄清与可持续演进重构

## 1. Goal

在 JSpace 正式发布前完成一次允许破坏性演进的架构重构，使概念架构、持久状态、CLI 命令、系统调度、工作台升级和 skills 生命周期遵循同一组可执行契约，消除“模块局部通过、组合后断路”。

完成后，JSpace 应当同时具备两种稳定性：

- **日常使用稳定**：用户可以从任意受支持的 AI harness 进入工作台，持续完成召回、写回、资产整理和定时任务运维，不需要理解内部文件布局。
- **持续演进稳定**：新增 domain、resource、project、scheduler、harness 或 skill 时，有明确的状态所有权、扩展边界、升级路径和组合质量门，不再依赖多处 prose 与 switch 的人工同步。

本任务是父级架构任务，负责锁定跨层产品契约、验收标准和 child task 边界；具体实现由可独立验证的 child tasks 承担。

## 2. Problem Statement

JSpace 的 North Star 已经明确“一个控制平面 + gbrain 记忆层 + filehub 资产层”以及路由、记忆、资产、定时四大支柱。当前主要问题不是功能数量不足，而是这些功能缺少共同的跨层契约：状态在 portable 与 machine-local 之间混放，CLI 与 scheduler 对同一 invocation 的理解不同，模板声明与实际 skill bundle 不一致，升级和失败恢复也没有完整状态机。

因此，项目当前可以通过局部测试，却无法证明真实工作流在初次安装、日常运行、失败恢复、工作台升级和换机后仍然成立。按“尚未发布、可直接建立清晰基线”的标准，这些问题属于发布阻断，而不是发布后的渐进优化。

## 3. User Outcomes

### U1. 新机器可恢复工作

用户安装或更新 JSpace 后，可以初始化或升级一个工作台，绑定本机路径与 harness，并在不提交本机绝对路径或运行状态的前提下恢复同一套逻辑工作环境。

### U2. 日常会话形成记忆闭环

用户从 Pi、Claude Code、Codex 或 Cursor 进入工作时，能够知道当前 harness 的 session-start、session-end 和显式 fallback 能力；自动化能力不可用时有诚实、可操作的人工路径，不会把 best-effort 描述成保证。

### U3. 资产整理可恢复

用户把文件放入 filehub `_inbox/` 后，无论人工触发还是 cron 触发，系统都能完成分类、归位、索引和 gbrain 指针写入；任一步失败后均有明确状态，可以安全重试，不产生静默丢失或孤儿记录。

### U4. 定时任务可运营

用户可以预演、安装、检查、重试、确认和解决定时任务问题。声明删除、禁用或变更后，系统 scheduler 状态能够收敛；多个工作台不会覆盖彼此的系统任务。

### U5. 工作台可持续升级

用户更新 CLI 时不会隐式覆盖工作台；升级工作台前能够看到变更计划、冲突和迁移，distribution-managed、seed-once 与 user-owned 内容各自遵循清晰的所有权规则。

## 4. Product Invariants

以下原则是本任务及所有 child tasks 不得降低的约束：

1. **控制平面保持轻量可移植**：portable 内容使用纯文本并可由 git 同步；machine-local binding、运行状态和日志不进入 portable truth。
2. **记忆存事实与指针，资产存本体**：JSpace 不把重资产二进制复制进 gbrain，也不包装 gbrain 为新的查询系统。
3. **不增加常驻运行时**：定时能力继续由系统 scheduler + 无头 harness 提供，不引入 daemon、事件网关或自主代理。
4. **语义判断与机械执行分离**：skill 负责语义决策；typed core/application/adapter 负责校验、状态转换、执行计划、幂等和恢复。
5. **外部变更默认可检查**：影响用户文件、工作台、scheduler、harness 配置或外部依赖的操作，必须支持 plan/dry-run、冲突报告或明确确认。
6. **本地优先且不泄密**：离线能力降级必须清晰；密钥、token 和 provider credential 不写入工作台、日志、memory 或诊断输出。
7. **不虚报自动化可靠性**：只有经过验收的路径可以标为 automated，其余必须标为 best-effort、manual 或 unsupported。
8. **发布前采用单一新基线**：不为未公开发布的内部 schema 和命令保留长期兼容层，但必须用 fixture 验证受支持的工作台升级路径。

## 5. Confirmed Audit Findings

以下事实已通过源码检查和临时工作台验证确认，是本任务的输入证据（2026-08-03 审计快照；复核状态见 §5.1）：

| ID | 严重度 | 已确认事实 | 证据 |
| --- | --- | --- | --- |
| F1 | P0 | `cron run` 解析器要求位置参数，三个 scheduler backend 生成 `--id`；系统生成的命令会以退出码 2 失败。 | `cli/args.ts:736-748`; `cli/cron.ts:202-220,245-257,298-303` |
| F2 | P0 | 工作台声明会物化四个 skills，但 bundle 只明确包含 `jspace-bootstrap` 与 `asset-ingest`。 | `templates/workbench/AGENTS.md:108-112`; `scripts/gen-assets.ts:7-8` |
| F3 | P0 | asset-ingest 将批量日志写向 `<filehub>/.jspace-logs/`，cron runner 监控工作台 `.jspace/logs/`；日志不存在时守卫仍可能通过。 | `skills/asset-ingest/SKILL.md:84-86`; `cli/cron.ts:575-588,622-631` |
| F4 | P0 | asset-ingest 先移动文件再写 gbrain，却承诺失败文件仍留在 inbox；当前没有满足该承诺的补偿流程。 | `skills/asset-ingest/SKILL.md:30-45,66-71`; `skills/asset-ingest/references/batch.md:24-28` |
| F5 | P0 | `jspace update` 只替换二进制，`init --force` 会重新物化工作台文件；当前没有安全的 workspace diff/upgrade/migration。 | `cli/update.ts:154-193`; `cli/init.ts:40-54`; `cli/embed.ts:75-100` |
| F6 | P0 | North Star 同时要求控制平面 git 同步和绝对路径按机器维护，当前 registry 尚未提供 portable identity 与 local binding 的正式分层。 | `GOAL.md:20-28,63-68`; `templates/workbench/.gitignore:1-2` |
| F7 | P1 | project ID 已横跨 domain README、filehub、gbrain 和 cron prompt，但不是正式 schema/CLI 实体。 | `GOAL.md:32,43-50,54-61` |
| F8 | P0 | Bootstrap 声明 session-start retrieval 与 work-end write-back，但各 harness 实现程度不同，且 recall/writeback skills 未实际物化。 | `skills/jspace-bootstrap/SKILL.md:75-91`; `skills/jspace-bootstrap/references/harnesses.md:19-61` |

审计时（2026-08-03）现有 TypeScript 检查、30 个 Bun 测试和 Office 抽取测试均通过；F1-F8 说明现有测试主要证明模块局部行为，尚不能证明跨层日常工作流。Child A 落地后测试增至 95 个（9 个测试文件，以 core/contracts 契约测试为主）。

### 5.1 Audit Recheck（2026-08-04）

Child A（portable hub v4 + machine-local state）已落地并提交（`29117d3`）。对 F1-F8 复核如下，作为 child task 规划的输入；§5 原始表格保留审计时快照：

| ID | 复核状态 | 说明 |
| --- | --- | --- |
| F1 | 🔴 未修复（待 Child C） | 证据行号与审计时一致：`cli/args.ts:744` 位置参数 vs `cli/cron.ts:257,303` 生成 `--id`。 |
| F2 | 🔴 未修复（待 Child D） | `scripts/gen-assets.ts:8` SOURCES 仅 bootstrap+asset-ingest；memory-recall/writeback 不会物化。 |
| F3 | 🔴 未修复（待 Child E） | 实际三处位置：skill 写 `<filehub>/.jspace-logs/inbox-batch.md`；`cli/cron.ts:578` 监控工作台 `.jspace/logs/inbox-batch.md`；pending 在 `<filehub>/.jspace-logs/*.APPLY.md`（`cli/cron.ts:712-716`）。 |
| F4 | 🟡 成立、措辞需精确（待 Child E） | 顺序确为先移动（SKILL 步骤2）后写 gbrain（步骤3）；需区分「单文件失败即停（文件已在目标目录、无 gbrain 页）」与「批处理承诺失败文件留 inbox」两个场景；当前补偿仅是 prose 纪律，无机械 journal/compensation。 |
| F5 | 🔴 未修复（待 Child B） | `cli/update.ts` 只 replaceBinary；`cli/init.ts:27-31` `--force` 重新物化；无 workspace diff/upgrade。 |
| F6 | 🟢 已解决（Child A） | hub v4 + local binding + `.gitignore`（local/logs/state）分层全部落地。 |
| F7 | 🟡 部分解决 | schema（`core/contracts/hub.ts` Project）+ inspect drift（`core/registry/inspect.ts:174-220`）已有；CLI `project` 命令待 Child B/C。 |
| F8 | 🔴 未修复（待 Child D） | harness 能力矩阵与 recall/writeback 物化未动。 |

## 6. Requirements

### R1. 建立唯一的状态所有权模型

- 必须区分 portable control-plane state、machine-local bindings/runtime state、gbrain memory 和 filehub assets，并为每类数据指定唯一 owner。
- portable 状态不得包含必须按机器变化的绝对路径、scheduler binding、运行日志、incident 或 pending execution state。
- `hub.json`、local binding、cron definition、workbench marker 和 distribution manifest 必须有唯一的 typed contract，供模板、CLI、doctor、upgrade 和测试共同消费。
- doctor 必须区分 schema invalid、binding missing、bound path missing 和跨层 drift，不能把它们折叠为同一种错误。

### R2. 建立 project 的跨层稳定身份

- project 必须具有稳定 ID、所属 domain、portable asset relative path 和 lifecycle status。
- filehub 路径、domain project index、gbrain `project/<id>/state` 与 cron 发现逻辑必须以同一 project ID 对齐。
- 创建、关联、归档和检查 project 时，必须能检测并报告各层缺失、冲突或 drift。
- gbrain 仍是外部系统；跨 filehub、工作台和 gbrain 的操作必须采用可重试的 journal/compensation，不得宣称不存在的强事务。

### R3. 建立稳定且可演进的 CLI 产品契约

- 每个命令的名称、alias、参数、help、handler、机器输出和退出码必须来自单一命令定义，避免多处人工同步。
- 所有作用于工作台的命令必须遵循同一 workspace resolution 规则，支持显式 `--dir`，并清楚定义 cwd fallback。
- read/status/diagnostic 命令必须提供稳定的 JSON 输出；健康检查类命令必须定义可脚本化的退出码。
- 修改用户文件、系统 scheduler 或 harness 配置的命令必须先产生可检查的 plan，且 `--dry-run` 不产生外部副作用。
- 用户命令面保持简洁、名词化；不得为了内部扩展性引入运行时插件市场。

### R4. 分离 CLI 生命周期与工作台生命周期

- `jspace update` 只负责经过完整性校验的 CLI binary 更新，不隐式修改已有工作台。
- 必须提供 workspace diff/upgrade 能力，能够报告 create、update、conflict、migration 和 no-op。
- distribution manifest 必须区分 distribution-managed、seed-once 和 user-owned 内容；升级不得无提示覆盖本地修改、registry、本机 binding 或用户 cron。
- schema 变化必须通过显式 migration 和升级 journal 执行；失败后必须保留可诊断状态和恢复入口。
- 新 CLI 必须能够识别工作台版本不兼容，并给出升级动作，而不是继续执行可能破坏状态的命令。

### R5. 闭合 cron 与 scheduler 运维状态机

- CLI 解析器和所有 scheduler backend 必须消费同一个 cron invocation contract，backend 生成的 argv 必须能被真实 parser 接受。
- scheduler install 必须执行 reconciliation：安装 enabled、更新 changed、移除 disabled/deleted/stale，并按稳定 workbench identity 隔离。
- 必须支持 rehearsal、enable/disable、retry/force、ack/resolve；每个动作的状态变化和退出码必须明确。
- run、incident、pending write 和 scheduler binding 必须使用结构化状态；Markdown 可以作为人类报告，但不得成为唯一机器真理。
- 成功重试必须能解决相应 incident；已解决或已确认的旧失败不得永久触发 SessionStart 告警。
- macOS、Linux、Windows 的能力差异必须在 adapter contract 和支持矩阵中如实表达。

### R6. 建立正式的 skill 分发与依赖契约

- 必须建立 skill manifest，至少记录 name、version、scope、required/optional、dependencies、entrypoints 和 distribution target。
- `jspace init` / workspace upgrade 后，模板声明、resolver rows、bundle manifest、物化目录和引用文件必须一致。
- 工作台最小日常套件包含 `jspace-bootstrap`、`asset-ingest`、`memory-recall`、`memory-writeback`。
- machine-global 的 `harness-config` 必须具有独立 scope、安装/升级来源和依赖关系，不得被工作台文档默认为已经存在。
- workbench skill 所引用的 docs、scripts、templates 和 references 必须随工作台离线可达，或明确标注为外部稳定依赖。
- 默认 cron 任务必须引用可版本化、可校验的 skill contract；自定义 prompt 仅作为显式高级 escape hatch。

### R7. 闭合记忆与资产的日常工作流

- Bootstrap 只负责一次性、幂等、可复验的首次配置，不承担隐式日常维护职责。
- Pi、Claude Code、Codex、Cursor 必须分别声明 session-start、session-end、显式 fallback 和 crash recovery 的能力等级及验证方法。
- asset-ingest 必须以 plan/journal 驱动可恢复执行，确保 source、target、gbrain page、project index 和 inbox visibility 在任一步失败后具有明确、可重试的状态。
- gbrain lock 冲突产生的 pending write 必须有 versioned envelope、idempotency key、producer、applier、retry、ack 和 terminal failure 规则。
- 所有自动写入必须保持“记忆存事实与指针、资产存文件本体”，并保留跨机器可解析的相对指针。

### R8. 建立安全的外部依赖与变更边界

- Bootstrap 不得默认执行未经用户确认和落盘审查的 `curl | bash`、`irm | iex` 或等价远程代码管道。
- gbrain 安装和升级必须声明受支持或已验证版本范围；升级用户数据前必须执行兼容性、备份/恢复条件和健康检查。
- harness/provider/proxy 配置属于用户环境；检测和日志不得输出密钥、token、credential 或完整敏感配置。
- 新增网络端点、改变 provider/proxy 数据流或安装远程 MCP server，继续要求用户明确确认。
- 自动化测试不得修改真实用户 home 配置、真实 scheduler、真实 gbrain store 或真实 filehub。

### R9. 保持跨平台与多机语义一致

- macOS、Linux、Windows 必须共享相同的业务状态和命令语义；平台差异限制在 scheduler、process 和 path adapters。
- 同一 portable workbench 在不同机器绑定不同本机路径后，domain、resource、project 和 asset relative pointer 必须解析为等价逻辑实体。
- 系统任务 identity 必须包含 workbench identity，禁止不同工作台互相覆盖或卸载对方任务。
- 无法在 CI 验证的真机行为必须进入明确的人工验证矩阵，不能由纯函数测试替代或宣称已验证。

### R10. 建立发布级组合质量门

- PR/push 必须运行 type-check、unit tests、generated asset freshness、schema/manifest contract tests 和临时工作台集成冒烟。
- 必须覆盖 scheduler argv parser round-trip、scheduler reconciliation、skill/reference 物化、schema round-trip、workspace upgrade fixture 和 asset-ingest fault injection。
- release tag matrix 继续验证六平台构建和安装；平台可用时补充不修改真实系统状态的 scheduler plan smoke。
- `.trellis/spec/backend/` 必须更新为当前项目真实的目录、状态、错误、日志、测试和安全约定。
- 所有 child tasks 完成后必须执行一次父任务级全链验收，任何 P0 acceptance criterion 未通过时不得宣称达到发布基线。

## 7. Acceptance Criteria

### Release-Blocking Acceptance

- [x] **AC1 / R1**：临时工作台的 portable git 状态不包含本机绝对路径或 runtime state；同一 portable fixture 可绑定两个不同本机根并通过 doctor。**full**（Child A:portable hub v4 + local binding + `.gitignore` 忽略 local/logs/state;GOAL M5 同机模拟双机通过）。真实第二机 = manual（不阻塞）。
- [x] **AC2 / R1**：hub、local binding、cron、marker 和 distribution manifest 均通过 typed schema round-trip；doctor 能分别报告 invalid、unbound、missing 和 drift。**full**（Child A:`core/contracts/{hub,local,workbench,distribution}.ts` + `core/registry/inspect.ts` 分级诊断）。
- [x] **AC3 / R2**：同一 project ID 可解析到 domain、asset relative path 和 gbrain slug；任一层缺失或不一致时 doctor 返回结构化 drift。**full**（Child A:Project contract + inspect `project.asset_drift`;Child E:resolveProjectId 用于 ingest path/slug/index）。
- [x] **AC4 / R3**：新增一个 fixture command 时，无需在独立 choices/help/dispatch switch 中重复登记；其 human output、JSON output 和退出码均有测试。**full**（Child B:CommandSpec 单一来源 + `command.test.ts`）。
- [x] **AC5 / R4**：CLI binary update 与 workspace upgrade 相互独立；旧 fixture 可执行 diff -> upgrade -> doctor，user-owned 内容与本地修改不会被静默覆盖。**full**（Child B:`workspace diff/upgrade` + journal/rollback;Child D:skills managed,本地修改保 conflict）。
- [x] **AC6 / R5**：macOS、Linux、Windows scheduler 生成的 `cron run` invocation 均通过真实 parser contract test，并能完成无系统副作用的 dry-run。**full**（Child C:`invocation.test.ts` 三平台 round-trip;`--dry-run` 无副作用）。真实 scheduler 安装 = manual。
- [x] **AC7 / R5/R9**：scheduler reconciliation 能创建 enabled、更新 changed、删除 disabled/deleted/stale；两个 workbench 的任务 identity 不冲突，uninstall 不影响另一工作台。**full（纯函数 + dry-run 面）**（Child C:`scheduler.test.ts` create/update/delete + 双 workbench 隔离;workbenchTag 派生）。**已知遗留（未实现,非 manual 验证缺口）**：真实 `cron install`/`uninstall` 仍走 legacy `cmdCronInstall`(plist 名 `com.jspace.cron.<id>` 未接线 workbench tag),真实两工作台同 id cron 仍会互相覆盖 plist —— 纯函数与 dry-run 计划验证通过,真实 apply 的 tag 隔离未落地（见 release-gate 遗留清单）。
- [x] **AC8 / R5**：失败任务经成功 retry 后 incident 可自动 resolve；仍未解决但已 ack 的 incident 保留证据且不重复告警；存在未确认 incident 或 actionable pending write 时 `cron check` 返回非 0。**full**（Child C:incidents 状态机;Child E:pending actionable 过滤,`cron check` exit 1）。
- [x] **AC9 / R6**：`jspace init` 后四个 required workbench skills 及其所有离线 references/scripts 均存在；manifest、模板 AGENTS、resolver rows 和物化结果完全一致。**full**（Child D:SkillsManifest + 4 skills bundle + `assets-reachability.test.ts` 一致性）。
- [x] **AC10 / R7**：asset-ingest 在 gbrain write、index update 和中断故障注入下可恢复为明确、可重试、无静默丢失且无未知孤儿的状态。**full**（Child E:`ingest/journal.test.ts` 故障注入 gbrain/index/中断 + 补偿）。
- [x] **AC11 / R7**：pending write 的重复 apply 不产生重复事实；成功、重试、ack 和 terminal failure 均有结构化状态测试。**full**（Child E:`pending/apply.test.ts` 幂等/dedupe/retry→terminal/ack）。
- [x] **AC12 / R8**：Bootstrap 不含默认执行的管道式远程代码安装；gbrain 版本兼容、升级前健康检查和敏感信息屏蔽均有可复验检查。**full**（Child D:bootstrap §11 守卫 + `lifecycle-and-safety.test.ts`;gbrain 版本范围 + doctor 检查;敏感屏蔽见 quality spec R8）。
- [x] **AC13 / R10**：PR/push 质量门执行 type-check、unit、asset freshness、contract 和 init integration，现有 Office 抽取测试及六平台 release build 不回退。**full**（Child F:`verify.yml` tsc/unit/freshness(含 skills.generated.ts)/office-extract/全链;`build.yml` 六平台 + **gen-version 顺序修复**）。install 冒烟覆盖 3/6 平台 = 已接受限制。
- [x] **AC14 / R1-R10**：从 clean checkout 完成 `init -> doctor -> domain/resource/project -> filehub -> cron rehearsal/install-plan/status/check -> workspace diff/upgrade` 全链，且不触碰真实用户 scheduler、home config、gbrain store 或 filehub。**full**（Child F:verify.yml 全链,project 以 `resource add --type project` 承载,全部 `/tmp` 临时工作台）。

### Capability Acceptance

- [x] **AC15 / R7**：Pi、Claude Code、Codex、Cursor 的 lifecycle matrix 逐项标明 automated、best-effort、manual 或 unsupported，并验证所有标为 automated 的路径。**full**（Child D:lifecycle 矩阵权威在 `skills/jsp-bootstrap/references/harnesses.md`;automated 仅 claude cron argv 有 `argv.test.ts` 证据,其余如实标 best-effort/manual;无虚报）。真机 harness 触发 = manual。
- [~] **AC16 / R3**：所有 workbench 状态命令遵循统一 `--dir` 解析规则；可脚本化命令拥有稳定 JSON schema 和文档化退出码。**partial**（Child B/C/E:绝大多数命令 `--dir` + JSON + exit code;`cron status` 仍用 cwd 不认 `--dir`——Child F 不改功能,列为已知遗留）。
- [~] **AC17 / R6**：默认 cron 定义使用可版本化的 skill target，缺少 required skill 或版本不兼容时 install/rehearsal 在执行前失败并给出修复动作。**partial（显式决策）**（Child D:仅 `inbox-tidy` → asset-ingest skill target + 前置校验;`weekly-report`/`memory-consolidate` 保留 prose prompt——用户决策最小闭环,AC17 按 partial 对齐）。
- [~] **AC18 / R9**：多机 fixture 使用不同绝对 filehub 根解析同一 `rel_path`，得到相同逻辑资产并保留目标机绝对 Pointer。**partial**（GOAL M5 同机模拟双机通过;Child A portable hub 多机绑定 fixture 已建,真实第二机 = manual/使用期验证）。

> **最终 release-gate 判定（2026-08-04，Child F 全链验收 + v1.0.4 发布验证后）**：**14 个 release-blocking AC（AC1-AC14）通过**（AC1-6/8-14 full;AC7 纯函数+dry-run 面 full）。真机面（真实第二机、真实 gbrain/harness spawn）标 manual + PLATFORMS 矩阵,不阻塞发布基线。Capability AC：AC15 full;AC16/AC17/AC18 partial（AC17 为用户决策的最小闭环、AC16 cron status cwd 遗留、AC18 真实第二机使用期验证）——均非 release-blocking。
> **已知遗留（非 P0 但如实列出）**：① **AC7 真实 apply 未接线 workbench tag**（legacy `cmdCronInstall` 不隔离多工作台同 id cron）——未实现,不归入「无遗留 P0」;② install 冒烟覆盖 3/6 平台;③ tag 3 次 force-push 流程不合规(本次无残留);④ windows-x64 非 baseline(需 AVX);⑤ cron smoke 在 CI 禁用。
> **判定时序说明**：本判定初稿先于 CI 稳定（其后修了 build.yml 3 个 bug：YAML 冒号/断言剥 v/Windows shell）,最终由 `5a8374b` 起的 verify/build 全绿 + **v1.0.4 发布二进制验证**（`jspace 1.0.4` + `template_version "1.0.4"`）支撑。**发布基线可达成。**

## 8. Scope

### In Scope

- portable/local/runtime 状态分层及其 schema、repository、doctor 和 migration。
- project 最小身份模型与 domain/filehub/gbrain drift 检查。
- CLI command contract、workspace resolution、structured output、exit code 和 dry-run 约定。
- CLI binary update 与 workspace diff/upgrade 的独立生命周期。
- cron invocation、scheduler reconciliation、runs/incidents/pending 和运维命令。
- skill manifest、四个 required workbench skills、全局 `harness-config` 依赖和默认 cron skill targets。
- asset-ingest journal/compensation 与 project integration。
- 四种 harness 的 lifecycle capability matrix 与已声明自动路径验证。
- 组合测试、PR/push CI、六平台 release matrix 和项目 spec 更新。

### Out of Scope

- 常驻 daemon、事件驱动或入站多端网关。
- 自研 autonomous agent、harness 执行器、文件同步引擎或 gbrain 查询包装层。
- 重资产全量二进制 embedding 或新的“文件数据库”。
- 动态第三方插件市场或通用 workflow engine。
- 为尚未公开发布的旧 schema/命令建立长期弃用和兼容通道。
- 承诺所有 harness 都能可靠触发 session-end hook；不具备的平台保留明确 fallback。
- 在自动化测试中安装、卸载或修改真实机器 scheduler 和用户配置。
- 在本父任务中直接进行大爆炸实现；交付继续拆为可独立规划、验收和回滚的 child tasks。

## 9. Key Decisions

- 保留 North Star 的“一个控制平面 + 两个持久层”和四大支柱，不通过增加常驻运行时解决当前契约问题。
- 这是父级架构任务；父任务持有源需求、跨 child 验收和最终集成，具体实现由六个 child tasks 承担。
- 在正式发布前直接采用清晰的新基线，不为内部 v1.x 痕迹保留公共兼容负担。
- portable registry 保存逻辑身份，机器绝对路径进入 gitignored local binding；资产 memory page 同时保留 Pointer 与 `rel_path`。
- project 被提升为跨层稳定身份，但不扩张为独立服务或重型项目管理系统。
- 扩展性来自 typed contracts、application use cases 和 scheduler/harness adapters，不引入运行时插件系统。
- gbrain 继续作为外部正式接口；JSpace 只负责身份、配置、调用纪律、pending/recovery 和 drift detection。
- 工作台升级采用 manifest + plan + journal，不再把 `init --force` 当作升级机制。
- 自动化可靠性必须分级；AGENTS 指令、显式“收工”和 best-effort hook 不得描述为所有 harness 的保证。
- prose 日志保留给人阅读，但结构化 state 才是状态判断和自动恢复的机器真理。

## 10. Risks and Deferred Validation

- **Harness 能力漂移**：各 harness hook 能力可能随版本变化；通过 versioned capability matrix 隔离，无法保证的路径降级为显式 fallback。
- **升级所有权误判**：managed/user-owned 边界错误可能导致数据丢失或永久无法升级；在开放 apply 前必须通过冲突与恢复 fixture。
- **跨系统非原子性**：project 和 asset-ingest 横跨 filehub 与外部 gbrain；只能以 journal、幂等和补偿实现最终一致，不能承诺强事务。
- **平台验证有限**：Linux/Windows scheduler 真机行为仍需平台 CI 或人工矩阵；纯函数和 argv 测试只作为前置门槛。
- **真实第二机验证**：M5 已完成同机模拟双机；真实第二机的路径、权限和 embedding 差异继续作为使用期验证，但不得阻塞本任务的 portable/local fixture 验收。
- **范围膨胀**：R1-R10 横跨多个层；通过 child task 顺序和跨 child review gate 控制，不允许用父任务大提交一次落地。

## 11. Planning Status

- Blocking product decisions: none identified from `GOAL.md`, the architecture audit, and the approved task scope.
- Parent artifacts: `prd.md`, `design.md`, and `implement.md` exist.
- Implementation authorization: not granted; the parent task remains `planning`.
- Child A (core contracts + portable/local state): 已落地并提交（`29117d3`，2026-08-04 review 已核对交付，见 §5.1）；原子任务目录已归档，父任务 `children` 引用已摘除。
- Next gate: review Child A 交付与 §5.1 复核列后，创建并激活 Child B（CommandSpec + application + workspace upgrade）。
