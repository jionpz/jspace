# 核心契约与可移植/本机状态分层

## Goal

为 JSpace 建立可执行的状态基线：portable workbench 只保存逻辑身份和可同步声明，本机绝对路径与安装实例信息只保存于 gitignored local state；所有 CLI 消费者从同一 typed decoder 和 effective registry 读取状态。

完成后，用户可以把同一工作台同步到另一台机器，重新绑定本机路径后继续使用同一 domain、resource 和 project 身份；新增状态字段时也不再由 doctor、resource、filehub、inbox 和 cron 各自解析原始 JSON。

本任务承接父任务 R1、R2 的基础契约，并为后续 CommandSpec/workspace upgrade、scheduler reconciliation、skill lifecycle 和 asset recovery 提供稳定输入。

## Confirmed Facts

- 当前 .jspace/hub.json 为 version 3，path entrypoint 直接保存绝对 value（cli/registry.ts:176-223、skills/jspace-bootstrap/references/registry.md:3-8）。
- loadRegistry() 返回 Record<string, unknown>；doctor、resource、filehub、inbox 和 cron 均使用局部 cast 重复解释同一 payload（cli/registry.ts:20-32、cli/cmds.ts:67-125,344-476,526-539、cli/cron.ts:701-723）。
- validateHub() 同时承担结构校验、domain 文件 drift 和本机路径存在性检查，无法稳定区分 invalid、unbound、missing 与 drift（cli/registry.ts:62-228）。
- 当前 marker 写入开发仓库绝对路径 source: devRoot()，会把本机信息带入工作台状态（cli/init.ts:48-54）。
- 模板 .gitignore 只忽略 .jspace/logs/，尚无 local state 文件（templates/workbench/.gitignore:1-2）。
- 当前没有独立 registry/doctor 测试；cron 测试 fixture 直接手写 v3 hub 与绝对 filehub path（cli/cron.test.ts:138-161）。
- 项目 North Star 已决定使用 Pointer + rel_path 支撑多机解析；父任务已批准 portable registry + local binding 与 project stable identity。

## Requirements

### R1. Portable hub v4

- .jspace/hub.json 必须升级为 version "4"，只包含 portable logical state。
- domains[] 保留相对 workbench path；路径必须规范化并解析在工作台根目录内。
- resources[] 的 path entrypoint 只保存 binding key，不得保存绝对路径；URL entrypoint 继续保存 portable URL value。
- path entrypoint 仍要求恰好一个 primary path；primary 必须是严格 boolean，不能接受 0/1。
- projects[] 必须包含稳定 id、已注册 domain、位于 projects/ 下的 normalized asset_rel_path 和 active|archived status。
- domain/resource/project ID、entrypoint ID、binding key、引用关系和路径边界必须由 typed decoder 统一校验。

### R2. Machine-local state v1

- .jspace/local.json 必须为 version 1，包含 machine-local installation_id 与 bindings。
- binding value 必须是当前机器的绝对路径；local state 不得存储 secret、token 或 provider credential。
- .jspace/local.json 必须进入工作台 .gitignore，jspace init 为新工作台生成初始 local state。
- 同步或 clone 后 local state 缺失必须表现为明确的 local-missing/unbound 状态；doctor 保持只读，不得静默创建或猜测路径。
- path resource 增删和 filehub register 必须同时维护 portable binding reference 与 local binding value；失败不得留下不可诊断的半状态。

### R3. Workbench identity and distribution base contracts

- portable marker 必须包含 stable workbench_id、schema version、product、template version 和 created date，不得包含开发仓库或可执行文件绝对路径。
- local state 必须包含独立 installation_id，用于区分同一 logical workbench 的本机实例。
- 必须定义 distribution manifest 的 typed base contract：manifest version、bundle version、file path、content hash 和 managed|seed|user ownership。
- 本任务只定义并测试 manifest contract；manifest 生成、workspace diff/upgrade 和 conflict policy 由 Child B 实现。

### R4. Single decode and effective registry boundary

- JSON 文件只能在 repository boundary 从 unknown decode 一次；成功后消费者只能接收 typed model。
- decoder 必须返回带稳定 code、path 和 message 的结构化 issues，并尽可能一次报告同一文件中的全部独立问题。
- structural/schema validation 必须与 filesystem/runtime inspection 分离。
- effective registry 必须把 hub + local 解析为 typed domain/resource/project views，并将 path entrypoint 标记为 resolved|unbound|missing。
- filehub、inbox、cron pending scan 和 doctor 必须复用同一个 effective resolver，不得保留局部 Record<string, unknown> 解析。

### R5. Persistence and mutation safety

- hub、local 和 marker 写入必须使用同一 deterministic JSON formatting 与 atomic-file replacement helper。
- 涉及 hub + local 的资源变更必须先完整 decode/validate desired state，再写入；第二个文件写入失败时执行 best-effort compensation。
- 进程中断仍可能造成跨文件 drift；doctor 必须检测 orphan/unused binding 与 missing binding，使其可修复。
- 不允许通过 fallback 默认值掩盖 schema invalid；local 文件缺失与 local 文件损坏必须是不同结果。

### R6. Doctor and project drift

- doctor 必须区分并稳定标识：schema invalid、marker invalid、local missing、binding unbound、bound path missing、binding unused、domain context drift、project domain drift、project asset drift。
- schema/引用/路径穿越问题为 error；未配置本机 binding、外部路径不存在、unused binding 和可恢复的 asset drift 为 warning。
- 当 filehub 未绑定时，project asset 只能标记为 unverifiable，不能误报 missing。
- project drift 检查只验证 portable identity、domain reference 和可解析的 asset directory；gbrain page 写入/存在性检查留给 Child E。

### R7. Templates, docs and tests stay aligned

- 工作台模板、bootstrap registry reference、generated assets、test fixtures 与代码 schema 必须在同一提交中切换到新基线。
- 增加 pure decoder、effective resolution、filesystem repository、doctor drift 和 current command consumer tests。
- 测试必须覆盖两个不同绝对 filehub 根解析同一 portable hub 的多机 fixture。
- 自动化测试只使用临时目录，不得修改真实工作台、filehub、gbrain、home config 或 scheduler。

## Acceptance Criteria

- [ ] AC1：模板 hub v4 不含绝对路径，包含 domains/resources/projects；模板 local state 被 gitignore 且由 init 在本机生成。
- [ ] AC2：同一 hub fixture 配合两个 local fixture 可得到相同 logical IDs 与不同 resolved paths。
- [ ] AC3：missing local、unbound binding、missing bound path、unused binding 和 malformed local 分别产生不同 diagnostics。
- [ ] AC4：hub/local/marker/manifest decoder 覆盖 valid round-trip、unknown/missing/wrong-type、duplicate ID、bad reference 和 path traversal。
- [ ] AC5：portable marker 具有 stable workbench ID，local state 具有 installation ID，任一 portable JSON 都不包含开发仓库绝对路径。
- [ ] AC6：resource add/remove 与 filehub register 后，hub binding reference 和 local binding 一致；故障注入不会产生静默半状态。
- [ ] AC7：doctor 可检测 domain metadata drift、project domain drift 和 project asset drift；filehub unbound 时报告 unverifiable 而不是 missing。
- [ ] AC8：doctor、resource list、filehub/inbox 和 cron pending scan 不再自行 cast/遍历 raw hub payload。
- [ ] AC9：v3 hub 由 decoder 明确拒绝为 unsupported version；本任务不加入运行时兼容或隐式 migration。
- [ ] AC10：bunx tsc --noEmit、bun test、clean init/doctor 以及 domain/resource list/add/remove 临时工作台冒烟全部通过。
- [ ] AC11：生成后的 cli/assets.generated.ts 与模板/registry reference 一致且 freshness check 无差异。

## In Scope

- hub v4、local v1、marker 和 distribution manifest base types/decoders。
- effective registry、structured diagnostics 和 filesystem repository。
- 现有 domain/resource/filehub/inbox/doctor/cron filehub consumers 迁移到 typed state。
- project typed identity 与 doctor drift checks，不含 project CLI。
- init/template/.gitignore/registry reference/test fixture/generated asset 更新。

## Out of Scope

- CommandSpec、统一 CLI renderer、全命令 --json 和 exit-code 重构（Child B）。
- workspace diff/upgrade、manifest generation、migration engine 和 conflict apply（Child B）。
- scheduler invocation/reconciliation、run/incident/pending state machine（Child C）。
- skill manifest、harness lifecycle 和 memory skills（Child D）。
- project add/link/archive CLI、gbrain project page、asset-ingest compensation（Child E/B）。
- 为未发布的 v3 workbench 提供兼容 adapter；旧 fixture 仅由 Child B 用于 workspace upgrade 验证。

## Key Decisions

- 使用标准 TypeScript 手写 typed decoders，不新增 runtime schema dependency。
- portable workbench_id 与 local installation_id 分离，避免把逻辑工作台和机器实例混为一体。
- binding key 由 resource/entrypoint identity 确定，默认格式为 <resource-id>-<entrypoint-id>；冲突必须显式失败。
- URL value 留在 hub；只有 path value 移入 local bindings。
- local state 缺失不会使 portable hub invalid，但依赖该 binding 的能力必须明确降级。
- v3 直接拒绝，不在常规 load path 中加入兼容分支。
- pure decode、effective resolution、filesystem inspection 各有唯一 owner；CLI rendering 不重新解释 schema。

## Risks and Deferred Items

- hub/local 双文件无法获得真正跨文件原子性；本任务以 atomic single-file write、补偿和 drift detection 控制风险。
- Windows absolute-path 语义只能在 Windows runner 完整验证；当前平台测试覆盖合同与 fixture，真机路径留在六平台矩阵。
- distribution manifest base contract 可能在 Child B 实现 diff/upgrade 时需要增加字段；若改变 ownership 语义，必须回到父任务设计复核。
- project 的 gbrain 与 index 一致性不在本任务内，当前 drift 结果不能被描述成完整 project 健康度。

## Planning Status

- Blocking product decisions: none; parent PRD and design already lock the state split and project identity.
- Implementation authorization: not granted for this child.
- Next gate: review prd.md, design.md, implement.md, then explicitly approve Child A activation.
