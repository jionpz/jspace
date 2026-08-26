# JSpace 使用指南与架构一致性重构

## Goal

在 JSpace 尚未形成兼容性承诺的阶段，对开发仓库及其生成工作台进行一次系统性架构审计与一致性重构：将现有 `jspace-bootstrap` 从“首次配置技能”演进为面向工作台全生命周期的 `jspace-use` 使用指南，使产品定位、CLI、工作台入口、官方资产布局、文档、生成清单、升级行为和测试契约形成单一且自洽的模型。

用户价值：新用户和 AI harness 进入工作台后，只需从一份权威指南理解“如何开始、如何路由、如何使用记忆与资产、如何维护/诊断工作台”，而不是把首次安装流程误认为长期能力边界。

## Background

- 项目尚未完全上线，明确不保留兼容性，可直接调整 schema、CLI、模板、skill 名称和生成布局。
- 当前开发仓库将 `skills/jspace-bootstrap/` 定义为首次配置技能，并由 `jspace init` 物化到工作台 `.jspace/skills/jspace-bootstrap/`。
- 用户要求详细分析项目架构和代码，并让 bootstrap 进化为 `jspace-use`，成为一份指南。
- `GOAL.md` 是 North Star；所有范围和架构决策必须与其对齐。

## Requirements

### R1 架构与代码审计

- 系统梳理 CLI、模板、官方 skills、生成资产、安装/升级、测试与文档之间的依赖关系。
- 识别命名漂移、重复事实源、生成物/源码边界不清、入口职责混淆、过度兼容或遗留概念。
- 审计结果必须以具体文件和当前行为为证据，而非只给抽象建议。

### R2 `jspace-use` 产品定位

- 将 `jspace-bootstrap` 重命名并重构为 `jspace-use`。
- `jspace-use` 应定位为工作台内的长期使用指南，而非一次性安装器或仅首次配置向导。
- 指南应覆盖至少：工作台模型、首次启用、日常会话路由、gbrain 记忆、资源/资产、CLI 维护与诊断、边界与故障排查。
- 指南不得复制本应由 CLI、模板 `AGENTS.md`、registry 文档或外部项目文档维护的完整实现细节；应通过稳定契约和 references 组织信息。

### R3 单一事实源与一致命名

- 开发源码、模板、嵌入清单、工作台受管块、README/GOAL/AGENTS、测试及校验脚本统一使用 `jspace-use`。
- 删除 `jspace-bootstrap` 产品命名及不再需要的兼容路径，不提供旧名称 alias、迁移层或弃用提示，除非其仅存在于任务/历史记录中。
- 明确哪些文件是源码、哪些是生成物、哪些属于工作台用户可编辑区，并让生成/校验链路能发现漂移。

### R4 工作台体验

- 新工作台初始化后，入口文档能自然引导用户或 AI harness 读取 `jspace-use`。
- `workspace upgrade` 能按当前 seed/skill 所有权规则刷新新的官方指南，同时保留工作台用户拥有的内容。
- 工作台根目录继续遵守“入口面在根，其余官方资产在 `.jspace/`”原则。

### R5 无兼容性重构

- 以最终模型的简洁性和一致性优先，不为未发布的旧布局保留兼容代码。
- 删除因旧 bootstrap 定位产生的冗余逻辑、命名和文档，而不是只做机械改名。
- 不扩大到 JSpace North Star 之外的新运行时、自主代理、事件网关或重资产 embedding。

### R6 质量与可验证性

- 更新或新增测试，覆盖 skill 嵌入、模板渲染、upgrade、入口引用、命名残留与 skill frontmatter。
- CLI 改动后执行项目规定的 TypeScript、init、doctor 和 registry smoke checks。
- 全仓搜索确认活动源码/文档中无非预期 `jspace-bootstrap` 残留。

## Acceptance Criteria

- [ ] 提供带文件证据的当前架构图/模块说明、关键数据流和问题清单。
- [ ] 官方 skill 源目录和生成目标均为 `jspace-use`，不存在旧名兼容层。
- [ ] `jspace-use/SKILL.md` 明确是一份长期使用指南，触发描述与正文覆盖首次启用及日常使用。
- [ ] 工作台 `AGENTS.md`、README、开发仓库文档、生成清单和相关测试统一指向 `jspace-use`。
- [ ] `jspace init` 生成的新工作台只包含 `.jspace/skills/jspace-use/`，且 `jspace doctor` 通过。
- [ ] `jspace workspace upgrade` 对官方指南遵循受管 seed/skill 的刷新与本地修改保护契约。
- [ ] registry 的 `domain/resource list/add/remove` smoke 演练通过。
- [ ] `bunx tsc --noEmit`、相关测试与项目规定的质量检查全部通过。
- [ ] 除历史任务、git 历史或明确解释旧概念的迁移研究外，全仓活动内容无 `jspace-bootstrap` 残留。

## Out of Scope

- 为已生成的旧工作台提供 `jspace-bootstrap` 兼容 alias 或迁移通道。
- 封装/分叉 gbrain，或改变其数据模型。
- 新增常驻运行时、消息事件入口、自主代理或文件同步系统。
- 重构与指南命名及架构一致性无关的业务功能。

## Constraints

- `GOAL.md` 作为最高产品对齐物。
- 模板和 skill 源码是生成物来源；不得通过修改某个已生成工作台反推源码。
- 不覆盖用户已有未提交改动；当前已知 `.trellis/.template-hashes.json` 在任务创建前已修改。
- 默认中文文档；代码、命令、路径和技术术语保留英文。
