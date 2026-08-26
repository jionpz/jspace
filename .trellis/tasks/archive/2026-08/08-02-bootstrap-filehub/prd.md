# bootstrap 文件中心引导步骤

## Goal

在 `skills/jspace-bootstrap/` 首次配置流程中增加「文件中心」步骤(新 Phase):引导用户选择文件中心根目录(第一选择 = Obsidian 文件夹)、识别/初始化 vault、注册 `type: filehub` resource;未配置时明确降级路径。同时把 embedding 默认改为**零外部账号的本地 Ollama bge-m3**(SiliconFlow 划为可选提升),并把首配验收定义为一次「入库→gbrain 页→中文召回」端到端演示。这是 M2 资产层在"首次使用体验"侧的落地(父任务 R7 + 专家 P3 纠偏)。

## Background(确认事实)

- `skills/jspace-bootstrap/SKILL.md` 现有 4 个 Phase:0 前置(bun/git)、1 装 gbrain + embedding、2 注册表健康、3 harness 接线、4 最终冒烟与签收。文件中心尚无对应步骤。
- 现有 Phase 1 embedding 推荐:**SiliconFlow bge-m3 为默认在线项(要 API key)**,本地 Ollama 仅作 offline fallback。→ 需按专家 P3 改为本地 Ollama 默认。
- filehub 正式路径已可用(`jspace filehub init <root> --register`:生成骨架 + 检测 `.obsidian/` + 注册 `type: filehub` resource + 自动建 files domain)。
- 未注册 filehub 时 asset-ingest 走降级暂存区(工作台外 `../<workbench>-inbox/`),不阻塞。
- skill 经 `gen-assets.ts` 内嵌;改后必须重新生成;对已生成工作台不自动回流(init --force 会覆盖本地编辑——见 SKILL 底部 Note)。
- Obsidian 决策(父任务已定):第一选择 = Obsidian 文件夹,四项结构(vault 兼容/wikilink/index 首页/frontmatter)全做,不预写 `.obsidian/` 配置。

## Requirements

- **R1 新增「文件中心」步骤(新 Phase,置于 registry 健康之后、harness 接线之前)**:
  - ① 引导用户选择根目录:**第一选择 = Obsidian 文件夹**(识别/初始化 vault),其次本地目录 / 网盘目录 / **暂不配置**。
  - ② 选 Obsidian → 校验/识别 vault(不预写 `.obsidian/`,结构即兼容)、写 Obsidian 兼容约定说明(Obsidian Sync 选项、wikilink、frontmatter 纪律——指向 filehub 根 README)。
  - ③ 注册:`jspace filehub init <根> --register`(经 CLI,自动建 files domain)。
  - 未配置(暂不配置)→ 明确提示:asset-ingest 走降级暂存区,后续可补注册。
- **R2 embedding 默认重排**:Phase 1 改为**本地 Ollama bge-m3 为默认**(零外部账号),SiliconFlow bge-m3 明确为可选「提升配置」(需 API key,chat parity 另需 cc-switch 代理);embedding 不可达时 `embed_skip: true` 写入成功 + 检索显式降级提示(不变)。
- **R3 首配验收**:新增工作台首次配置完成后的端到端验收——放一个真实文件进 `_inbox/`,说「整理一下 inbox」,跑通 入库→gbrain 页→中文召回 演示(而非"全部配好"才验收)。

## Acceptance Criteria

- [ ] AC1 bootstrap 流程含「文件中心」步骤(新 Phase);选 Obsidian 时识别/初始化 vault 并注册 `type: filehub` resource(经 `filehub init --register`)。
- [ ] AC2 选「暂不配置」时,其余配置不阻塞,asset-ingest 降级暂存区路径被明确提示(可后补注册)。
- [ ] AC3 Phase 1 embedding 默认 = 本地 Ollama bge-m3;SiliconFlow 明确为可选提升(文案顺序调整)。
- [ ] AC4 首配验收:端到端 入库→gbrain 页→中文召回 演示(真实文件,非假文件)。
- [ ] AC5 回归:`gen-assets` 重新生成;`init` + `doctor` 通过;bootstrap 其余 Phase(0-3)未被破坏。

## Key Decisions

- **文件中心是独立 Phase,置于 registry 之后、harness 之前**:注册需要 registry 就绪;harness 接线无关资产层,顺序不冲突。
- **Obsidian 只作视图,不预写 `.obsidian/`**:沿用父任务决策与 filehub init 行为。
- **embedding 默认本地 Ollama**:零外部账号首配(专家 P3);SiliconFlow 降为可选提升。embedding 不可达仍写入成功 + 显式降级。
- **首配验收 = 端到端演示**:放真实文件走一遍,而非"配置全配齐"。

## Out of Scope

- filehub init 命令本身(子任务 filehub-scaffold 已完成)。
- 批量整理逻辑(子任务 inbox-batch 已完成)。
- 域↔项目挂接(子任务 domain-project-link)。
- M3 cron;gbrain 本体修改。

## Notes

- 依赖 filehub-scaffold 的 `filehub init --register`(已完成);skill 变更后需 `gen-assets` 重新生成。
- 已生成工作台不自动回流新 bootstrap 步骤(现有升级通道属 M2 收尾,另行处理)。
