# 域↔项目挂接规则

## Goal

把「跟踪一个新项目」从口头约定变成可执行的文档规则:工作台模板 domain README 增加「本域进行中的项目」段落(指向 filehub 项目目录),并把「跟踪新项目三步」(建目录 + 挂 README + gbrain 建实体)固化为工作台文档段落。这样人和 AI 打开任一 domain 都能看到本域在跑哪些项目、资产在哪、如何跟踪新项目。

## Background(确认事实)

- GOAL.md 定义:跟踪新项目 = ① 资产层建项目目录 ② 域 README 挂一行 ③ 记忆层建实体。当前 `templates/workbench/workspace/<domain>/README.md` **无此段落**。
- 资产层(filehub)已有协议:`filehub/projects/<项目>/index.md` 为项目 dashboard(由 asset-ingest 归位时创建);命名/挂接纪律见 filehub 根 README 与 asset-ingest/filing.md。
- 工作台 `AGENTS.md`(templates/workbench/AGENTS.md)是全局操作规则,AI 会话先读它;`README.md` 是顶层导读。
- `jspace domain add`(cli/cmds.ts `writeDomainSkeleton`)为新 domain 生成默认 README,同样缺该段落。
- 落地形态已定(父任务):**模板段落 + 约定写进工作台文档,不新建 skill**(MVP 轻量)。

## Requirements

- **R1 模板 domain README 增加「本域进行中的项目」段落**:表格列出 项目 id / 资产目录(`filehub/projects/<项目>/`)/ 状态;段落内附「跟踪新项目三步」说明(① 资产层建 `filehub/projects/<项目>/index.md` ② 本表挂一行 ③ 记忆层建实体 gbrain)。两个模板 domain(jspace-dev、agent-infra)都加。
- **R2 约定写进工作台文档**:工作台 `README.md` 增「资产管理(跟踪新项目)」段落,全局可发现(三步入内 + 指向 filehub 协议)。
- **R3 新 domain 默认模板一致**:`jspace domain add` 生成的默认 domain README 也含该段落(与模板一致,避免新 domain 缺节)。

## Acceptance Criteria

- [ ] AC1 `templates/workbench/workspace/jspace-dev/README.md` 与 `agent-infra/README.md` 含「本域进行中的项目」段落(含三步说明)。
- [ ] AC2 工作台 `README.md` 含「资产管理/跟踪新项目」段落(三步入内)。
- [ ] AC3 `jspace domain add` 生成的新 domain README 含同一段落(新 domain 一致)。
- [ ] AC4 回归:`gen-assets` 重新生成;`init` + `doctor` 通过;模板渲染后段落正确。

## Key Decisions

- **段落 + 文档,不新建 skill**:MVP 轻量,符合父任务已定落地形态。
- **三步约定同时写进 domain README 与工作台 README**:domain 侧就近可查,工作台侧全局可发现。
- **domain add 默认模板同步**:避免「模板域有段落、新建域没有」的漂移。

## Out of Scope

- 记忆层实体规范深化(M4 记忆精度)。
- filehub init/批量整理/bootstrap(其余子任务已完成)。
- 新建挂接 skill 或自动化命令(MVP 只要文档规则)。

## Notes

- 依赖 filehub 项目目录约定(已完成);模板变更后需 `gen-assets` 重新生成。
- 轻量任务,PRD 足够(无独立 design/implement 需要)。
