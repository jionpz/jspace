# M2 资产层最小协议

## Goal

把「文件管理中心」从概念变成可用的最小协议:一条命令生成文件中心骨架、注册进工作台 registry(解除 asset-ingest 对 `type: filehub` resource 的悬空依赖)、`doctor` 能校验资产层健康、`_inbox/` 里的存量能被批量整理归位。先定协议,历史才会整齐;本任务完成即解锁 M3 cron 的第一批资产层任务。

**核心价值(2026-08-02 用户确认)**:对用户而言,**批量处理 inbox 里的资料(pdf/ppt/学习文件)+ 定时自动跑 + 处理中可人工调整** 是整个项目最高的价值点,不是可选项。M2 的批量管线必须先立住,且设计成可被 M3 cron 无头驱动。价值排序:批量整理 ≫ Obsidian 细节 > 引导形态。**入口即 `_inbox/`(用户笔误澄清:iBooks → inbox,无 iBooks 集成)。**

## Background(确认事实)

- M0/M1 已完成:`jspace init`/`doctor`/`domain`/`resource` 均可用(bun+TS CLI);asset-ingest skill(单文件入库)已交付。
- asset-ingest 的**前置约定已就位但悬空**:读 `hub.json` 中 `type: filehub` 的 resource 的 `primary: true` path 作为根;未注册时走**降级暂存区**(工作台外 `../<workbench>-inbox/` 或用户指定,不进 git)。当前模板 hub.json 无 filehub resource → skill 实际处于降级路径。
- 归档任务 `08-02-asset-ingest-skill` 明确留待 M2 的三件事:① 批量 inbox 自动化;② filehub `_inbox/` 与降级暂存区的迁移逻辑;③ filehub 按 M2 注册。
- 目录骨架(来自 GOAL.md 资产协议 + filing.md):`_inbox/ projects/<项目>/ areas/<领域>/ archive/<年>/`;命名 `YYYY-MM-DD-语义名-vN.ext`;项目 `index.md` 为 dashboard。
- 域↔项目挂接(GOAL.md 定义):跟踪新项目 = 资产层建项目目录 + 域 README 挂一行 + 记忆层建实体。当前 `templates/workbench/workspace/<domain>/README.md` 无此段落。
- 已交付纪律:本体归位、gbrain reference 指针(slug `assets/<project|area>/<语义名>`)、中文召回、embedding 降级、失败即停。
- **OQ1 已定(2026-08-02)**:文件中心位置**不在 init 时定死**,而是在 **bootstrap 时引导用户选择**;第一选择 = **Obsidian 文件夹**,围绕 Obsidian 做轻量功能。这同时回应了 GOAL 开放问题 #2(位置每机决定)与「Obsidian 是视图不是系统」原则的落地形态。

## Requirements

- **R1 filehub 骨架命令**:`jspace filehub init <根目录>` 生成骨架 `_inbox/ projects/ areas/ archive/` + 根 README(协议说明:PARA 变体、命名规范、分层同步说明)。路径由用户指定(命令本身路径无关)。**Obsidian 优先支持**:检测/兼容已有 vault(`.obsidian/`),或提示该目录可作 vault 打开。
- **R2 filehub 注册**:把文件中心注册进 `hub.json` 为 `type: filehub` 的 resource(`primary: true` path = 根目录),与 `jspace resource add` 兼容;asset-ingest 从降级路径切到正式路径后无行为差异。
- **R3 doctor 资产校验**:`jspace doctor` 对已注册 filehub 校验:根存在、`_inbox/` 存在、inbox 未归位文件计数(告警不阻塞);未注册时提示降级暂存区现状。
- **R4 批量 inbox 整理【核心,非 P2】**:一次性处理 `_inbox/` 存量——逐份走 asset-ingest 单文件逻辑(识别→查重→归位→入脑→登记→自检)。**两遍式设计**:第一遍只处理确定性文件、零提问、单文件原子性(失败即停该份、不留半成品);第二遍把模糊项列成一张短清单一次过目。**可中断续跑**(`.processing` 标记)。**cron 可驱动**:无头模式下只跑第一遍,模糊项留给用户在场时第二遍过目。整理逻辑在 skill 层(asset-ingest 增 batch 模式,会话内「整理一下 inbox」触发),CLI 只读辅助 `jspace inbox status`(列文件/计数/预检)。
- **R9 定时批量【核心,源 = `_inbox/`】**:定时任务自动批量处理 inbox 里的资料(pdf/ppt/学习文件)——M3 cron 无头驱动 R4 批量管线跑第一遍;源就是 filehub 的 `_inbox/`(未注册时降级暂存区)。本任务交付:批量管线 cron 可驱动性(无头只跑第一遍 + 执行日志);cron 安装/调度本身属 M3。
- **R10 人工审核与实时调整【核心】**:处理过程必须可人工介入——① **处理前可排除**:用户可对特定文件说「这个别动」;② **处理中过目**:第二遍模糊清单一次过目;③ **处理后纠错**:对归位/命名/分类不合适的文件,提供重做/调整路径(复用 asset-ingest 的「修复」语义,批量下给出「撤销本次/重跑该份」)。
- **R5 域↔项目挂接规则**:工作台模板 domain README 增加「本域进行中的项目」段落(指向 filehub 项目目录);固化「跟踪新项目三步」(建目录 + 挂 README + gbrain 建实体)。**落地形态已定**:模板段落 + 约定写进工作台文档,不新建 skill(MVP)。
- **R6 迁移逻辑**:降级暂存区已有文件的迁移路径定义(见设计);M2 之后新资料一律先落 filehub `_inbox/`。
- **R7 bootstrap 引导**:`skills/jspace-bootstrap/` 首次配置流程增加「文件中心」步骤——引导用户:① 选择根目录(第一选择 = Obsidian 文件夹,其次是本地目录/网盘目录/暂不配置);② 若选 Obsidian,识别/初始化 vault、写 Obsidian 兼容约定(Obsidian Sync 选项、wikilink、frontmatter 纪律);③ 注册 `type: filehub` resource。未配置时 asset-ingest 走降级暂存区。**同时**:embedding 默认改本地 Ollama bge-m3(零外部账号),SiliconFlow key/cc-switch 划为可选提升;首配验收 = 一次「入库→gbrain 页→中文召回」端到端演示。
- **R8 Obsidian 轻量功能(范围已定)**:围绕 Obsidian 作根,四项全做——① vault 识别与结构兼容(`filehub init` 检测 `.obsidian/`,新目录骨架可直接作 vault 打开);② wikilink 约定(index.md/根 README 用 `[[]]`,asset-ingest 归位行含 gbrain slug + 可选 wikilink);③ index.md 作 vault 首页(项目 dashboard + 根 README landing,链向 projects/areas/archive);④ frontmatter 纪律(轻量 YAML:`type/project/tags/created`,与 gbrain 页同风格)。全部纯 md,不依赖插件/私有格式。

## Acceptance Criteria

- [ ] AC1 `jspace filehub init /tmp/fh` 生成骨架 + 根 README;重复 init 幂等或明确报错。
- [ ] AC2 注册后 `hub.json` 含 `type: filehub` resource,primary path 正确;asset-ingest 走正式路径(可对真实文件跑通归档→gbrain 页→召回)。
- [ ] AC3 `jspace doctor` 报告 filehub 状态与 inbox 未归位文件数(告警不失败)。
- [ ] AC4 对含多份中文资料的 `_inbox/`,批量整理全部归位;再次空 inbox 运行提示无事可做。
- [ ] AC5 新工作台 `init` 后 domain README 含项目挂接段落;按规则跟踪一个新项目有明确步骤。
- [ ] AC6 降级暂存区文件按迁移逻辑可并入 filehub(人工确认或脚本路径)。
- [ ] AC7 全流程回归:`jspace init /tmp/smoke` + `doctor` 通过;本仓库无残留 hub.json/workspace。
- [ ] AC8 bootstrap 流程含「文件中心」步骤;选 Obsidian 时识别/初始化 vault 并注册 filehub resource;选「暂不配置」时 asset-ingest 仍走降级路径可用。
- [ ] AC9 Obsidian 兼容功能可工作且不依赖插件:filehub 根含 README.md(landing)+ index.md(frontmatter + wikilink),可被 Obsidian 直接打开;wikilink/frontmatter 纪律生效。
- [ ] AC10【核心】批量两遍式:对含混合确定性/模糊文件的 `_inbox/`,第一遍确定性文件零提问归位,模糊项进入第二遍清单一次过目;`.processing` 中断后重跑可续,不重复处理已完成项。
- [ ] AC11【核心】人工调整:处理前可排除指定文件(「这个别动」→ 跳过且可回滚);处理后对错归/错命名的文件可执行「撤销本次 / 重跑该份」并修复 gbrain 页与 index 登记。
- [ ] AC12【核心】批量管线 cron 可驱动:无头模式只跑第一遍、输出执行日志(路径/计数/成功跳过失败);日志可供下次会话检查(对接 M3 失败可见性契约)。

## Key Decisions

- **批量整理 + 定时 + 人工调整 = 项目核心价值**(2026-08-02 用户确认):M2 的批量管线(R4/R9/R10)是最高优先级交付,先立住并可被 M3 cron 驱动;Obsidian 细节与引导形态降为次要。
- **批量两遍式 + 人工审核**(采纳专家 P2):第一遍确定性零提问(无头可跑),第二遍模糊清单人工过目;单文件原子性 + `.processing` 幂等 + 处理后纠错路径。这一设计直接服务用户「过程可调整」诉求。
- **写入契约前移 M2(采纳专家 P2/arch-Q1)**:实体命名/归属标签/slug 规范骨架在 M2 锁定,纪律标 draft 随真实使用修订;M3 cron 写事实强制复用 M2 已锁规范。M4 收缩为「校准召回 + 端到端验收」。
- **零外部账号默认首配(采纳专家 P3)**:bootstrap 默认本地 Ollama bge-m3,SiliconFlow key/cc-switch 划为可选提升;首配验收 = 一次「入库→gbrain 页→中文召回」端到端演示。
- **双机重建冒烟提前 M2(采纳专家 P1,最强共识)**:M2 内做低成本双机重建验证(文本页↔PGLite 回灌、embedding 离线重建、指针换机可解析),结论写回 GOAL 开放问题 #1;不晚于 M3。
- **定时调度放 M3,本任务交付 cron 可驱动**(2026-08-02 用户确认方案 A):M2 批量管线支持无头第一遍 + 执行日志;cron 安装/调度属 M3。
- **文件中心位置 bootstrap 引导,第一选择 = Obsidian 文件夹**(2026-08-02 用户定,专家建议本地保底但用户确认保留):命令路径无关,bootstrap 引导;回应 GOAL 开放问题 #2。
- **Obsidian 功能四项全做**(用户确认,专家建议砍两项但用户保留):vault 兼容 / wikilink / index 首页 / frontmatter;只作视图,纯 md 无插件依赖。纪律标 draft,真实使用后按需修订。
- **批量整理在 skill 层,CLI 只读辅助**:语义判断必须 AI;CLI `inbox status` 服务无头预检。
- **域↔项目挂接 = 模板段落 + 约定文档,不新建 skill**(MVP 轻量)。
- **filehub 单根约定**:MVP 不引入多文件中心;注册后 `resource remove` 即回降级路径。

## Out of Scope

- 重资产二进制 embedding、文件数据库、事件驱动(GOAL 非目标)。
- gbrain 本体修改、新增 frontmatter 字段。
- M3 cron(声明式 + install + 无头执行)——依赖本任务的 asset 协议,但另行任务。
- M4 记忆精度打磨(实体/slug 规范深化)。
- office 文件逐表抽取、media-ingest 深入路径。
- 文件中心存量的一次性全量迁移(GOAL 开放问题 #2 建议增量收编)。

## Open Questions

- **无阻塞开放问题**。曾有的 OQ1(位置)/ OQ5(iBooks→inbox)/ Obsidian 范围 / 定时范围均已定(见 Key Decisions)。GOAL 级开放问题(多机重建验证、无头失败可见性)已分别排入 M2 验证与 M3 契约,不阻塞本任务。

## Notes

- 本任务是父任务,4 个可独立验收的子任务:filehub-scaffold(骨架+注册+doctor+迁移+Obsidian 结构)、bootstrap-filehub(引导步骤)、inbox-batch(批量整理【核心】)、domain-project-link(域↔项目挂接)。父任务负责源需求、子任务映射、跨子任务验收与最终集成验收。
- 子任务排序:filehub-scaffold 先做(解锁正式根路径,是批量管线的前置)→ inbox-batch(核心交付,优先级最高)紧随 → bootstrap-filehub;domain-project-link 无依赖可并行。跨子任务端到端验收路径见 implement.md。
