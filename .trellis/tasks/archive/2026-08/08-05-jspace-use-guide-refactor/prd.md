# jspace-use 指南化重构

## Goal

在 JSpace 尚未正式分发、无需承担兼容性成本的阶段，对项目架构和代码进行系统审计，并将当前承担“首次配置执行流程”的 `jspace-bootstrap` 重构为定位清晰、长期可复用的 `jspace-use` 使用指南，使 CLI、工作台模板、官方 skills、文档、生成资产与测试中的职责和命名保持一致。

## Background / Confirmed Facts

- 项目明确处于首次开发、未上线阶段，不保留旧 schema、旧路径、旧 skill 名称或迁移/弃用通道。
- `skills/jspace-bootstrap/` 当前会由 `jspace init` 物化到工作台 `.jspace/skills/jspace-bootstrap/`。
- 当前 skill 内容覆盖 gbrain、harness 接线、registry 和 headless operations，职责已超出单纯 bootstrap。
- 用户希望 `bootstrap` 进化为 `jspace-use`，并“变成一份指南”。
- 本任务是跨 CLI、模板、skills、文档、生成资产与测试的复杂重构，需提供 `design.md` 和 `implement.md` 后再进入实施。

## Requirements

- R1：完整审计当前 JSpace 分层、生成链路、工作台生命周期与 skill 职责，定位命名、所有权、耦合和重复来源问题。
- R2：定义 `jspace-use` 的明确产品定位、触发场景、内容边界和与其他官方 skills 的协作关系。
- R3：以无兼容性方式移除 `jspace-bootstrap` 名称和旧目录，不保留 alias、迁移分支或 deprecated 文案。
- R4：同步所有源文件、生成资产、模板、文档、测试与校验脚本，确保仓库内不存在失效引用或双重事实源。
- R5：保持工作台放置原则：入口面在根，其余官方资产位于 `.jspace/`；生成工作台中的官方 skill 路径必须唯一且可被 harness 发现。
- R6：重构后 `jspace init`、`jspace workspace upgrade`、`jspace doctor`、registry 命令和官方 skill 校验继续通过。

## Acceptance Criteria

- [ ] AC1：形成有代码证据和路径锚点的架构审计结论，并在设计中说明目标架构与职责边界。
- [ ] AC2：源码目录与生成工作台仅使用 `jspace-use`，仓库产品内容中不再出现 `jspace-bootstrap` 或旧 bootstrap 迁移逻辑。
- [ ] AC3：`jspace-use/SKILL.md` 是使用/维护工作台的入口指南，而不是一次性安装脚本；其 references 按长期任务场景组织。
- [ ] AC4：与 `harness-config`、`memory-recall`、`memory-writeback`、`asset-ingest` 的职责不重复，引用方向清晰。
- [ ] AC5：生成清单、嵌入资产、upgrade 所有权/清理行为、README/AGENTS/GOAL 相关描述和测试全部同步。
- [ ] AC6：TypeScript 类型检查、单元测试、skill/frontmatter/生成资产检查以及项目规定的 smoke/doctor/registry 演练全部通过。
- [ ] AC7：不添加兼容别名、旧路径探测、迁移或弃用代码。

## Out of Scope

- gbrain 本身的实现或封装。
- 新增常驻运行时、自主代理或事件网关。
- 与本次指南化无关的业务功能扩展。
- 为尚未分发的旧工作台提供兼容迁移。

## Open Questions

- `jspace-use` 应仅作为日常“如何使用 JSpace”的导航指南，还是同时保留首次环境配置与诊断步骤；需在完成代码与现有 skill 职责审计后给出推荐并由用户决定。
