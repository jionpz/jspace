# filehub 骨架 + 注册 + doctor 校验

## Goal

新增 `jspace filehub init <根目录>` 命令生成文件管理中心骨架(Obsidian 优先:四项结构——vault 兼容 / wikilink / index 首页 / frontmatter),支持注册为 `hub.json` 的 `type: filehub` resource(解除 asset-ingest 对 filehub resource 的悬空依赖),并把 `jspace doctor` 扩展为校验资产层健康。本子任务是批量管线(filehub-scaffold 之后的核心子任务)的正式根路径前置。

## Background(确认事实)

- CLI 结构:`cli/cmds.ts`(doctor/domain/resource 命令)、`cli/registry.ts`(hub.json 读写、version 校验、resource 增删查)、`cli/init.ts`(工作台生成)、`cli/embed.ts` + `assets.generated.ts`(模板/技能内嵌,`scripts/gen-assets.ts` 生成)。`resource add` 已支持 `--type`。
- asset-ingest 读 `hub.json` 中 `type: filehub` resource 的 `primary: true` path 作为根;未注册走降级暂存区(工作台外 `../<workbench>-inbox/` 或用户指定,不进 git)。
- 骨架规范(GOAL 资产协议 + filing.md):`_inbox/ projects/<项目>/ areas/<领域>/ archive/<年>/`;命名 `YYYY-MM-DD-语义名-vN.ext`;项目 `index.md` 为 dashboard。
- 模板 `templates/workbench/` 通过 `gen-assets.ts` 内嵌进二进制;改模板后必须重新生成(见 implement.md 门禁)。
- Obsidian 决策(父任务已定):四项全做,纯 md 无插件依赖,`filehub init` 只检测/兼容已有 `.obsidian/`,不预写 `.obsidian` 配置。

## Requirements

- **R1 `jspace filehub init <根目录>`**:生成骨架 `_inbox/ projects/ areas/ archive/` + 根 `README.md`(协议首页 landing:链接各目录、命名规范、分层同步说明)。路径由用户指定(命令路径无关)。
  - **幂等**:重复 init 检测已存在骨架 → 明确提示不覆盖(不删用户文件);已注册 filehub → 提示复用。
  - **Obsidian 兼容**:检测根目录是否已有 `.obsidian/`(已是 vault → 兼容,不写配置);新目录 → 骨架即可被 Obsidian 打开(不预写 `.obsidian`)。
  - **四项结构**:根 README(landing,普通链接或 wikilink);每个新项目 `index.md` 模板含 frontmatter(`type/project/tags/created`)+ 现状/关键文件表/下一步 + wikilink 约定说明。`filehub init` 提供 `--with-sample-index` 或仅生成根 README + 空目录(最小,样本 index 由 asset-ingest 归位时创建)。
- **R2 注册**:把根注册进 `hub.json` 为 `type: filehub` resource(`primary: true` path = 根,id 建议 `filehub`)。复用 `resource add` 机制(可内部调用或文档等价 CLI);注册后 asset-ingest 从降级路径切正式路径无行为差异。`filehub init` 完成后提示注册(或提供 `--register` 一步完成)。
- **R3 doctor 资产校验**:`jspace doctor` 对已注册 filehub 校验:根存在、`_inbox/` 存在、inbox 未归位文件计数(告警不阻塞);未注册时提示降级暂存区现状(存在则列出路径/计数)。
- **R4 降级暂存区迁移路径(定义,不做自动批量)**:文档/命令给出迁移指引——注册 filehub 后,把暂存区文件并入正式 `_inbox/`(人工移动或小命令),再走 asset-ingest。`filing.md` 更新「降级暂存区」节:与 `_inbox/` 同职责两处实现,迁移逻辑。

## Acceptance Criteria

- [ ] AC1 `jspace filehub init /tmp/fh` 生成骨架 + 根 README;重复 init 幂等(不覆盖、明确提示);已注册时提示复用。
- [ ] AC2 注册后 `hub.json` 含 `type: filehub` resource,primary path = 根;`doctor` 通过;asset-ingest 走正式路径(对真实文件跑通归档→gbrain 页→召回)。
- [ ] AC3 `jspace doctor` 报告 filehub 状态:根/`_inbox/` 存在、inbox 未归位文件数(告警不失败);未注册时提示降级暂存区。
- [ ] AC4 Obsidian 兼容:已有 `.obsidian/` 的目录 init 后不预写配置、可打开;新目录骨架为可打开 vault(含 README.md + index.md 模板)。
- [ ] AC5 根 README 含协议(landing 链接、命名规范、分层同步);index.md 模板含 frontmatter + 关键文件表占位 + wikilink 说明。
- [ ] AC6 降级暂存区文件可按迁移指引并入正式 `_inbox/`(人工或小命令);filing.md 已更新。
- [ ] AC7 全流程回归:`bunx tsc --noEmit`;`jspace init /tmp/smoke` + `doctor` 通过;模板/技能改动后 `scripts/gen-assets.ts` 重新生成(见 implement.md)。

## Key Decisions

- **Obsidian 只作视图,不预写 `.obsidian/` 配置**(父任务已定):Obsidian 首次打开自动生成;避免私有配置进 git 同步内容。
- **`filehub init` 最小生成,样本 index 由使用涌现**:不预生成一堆项目目录,`_inbox/` 是唯一必须的入口;index.md 在归位/建项目时创建。
- **注册复用 `resource add` 机制**:不新增重复注册命令;`filehub init --register` 或文档给出等价 CLI。
- **迁移只定义路径不做自动批量**:存量收编增量策略,人工/小命令并入。

## Out of Scope

- 批量 inbox 整理(子任务 inbox-batch)、bootstrap 引导步骤(子任务 bootstrap-filehub)、域↔项目挂接(子任务 domain-project-link)。
- M3 cron 调度;gbrain 本体修改;重资产 embedding。
- `.obsidian/` 配置预写、Obsidian 插件/私有格式。

## Notes

- 依赖:本子任务需在 `gen-assets.ts` 变更(新增 filehub 模板)→ 重新生成内嵌资产 → 构建冒烟(见 implement.md)。
- 前置(父任务):无硬依赖,可直接实施;实施后供 inbox-batch 使用正式根路径。
