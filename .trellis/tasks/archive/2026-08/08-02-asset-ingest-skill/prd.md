# 资料转知识资产学习 skill(实证后设计)

## Goal

做一个**薄衔接层学习 skill**:把工作中的资料(pdf/ppt/txt/md 书籍、报告、说明)转化为**可召回的知识资产**——文件本体归位到文件中心 + gbrain 写 reference 知识页 + 中文语义召回。核心动作复用 gbrain 现成能力,skill 只承担 JSpace 侧纪律(归位、命名、type 映射、写回)。

## Background(实证校准后的关键事实)

隔离 brain 实证 + 四位专家 review(对照 gbrain 0.42.71 源码)已确认:

1. **gbrain 中文检索强依赖 embedding**:tsvector `to_tsvector('english',...)` 把连续 CJK 当单个 lexeme,中文子串/词组召回差。SiliconFlow bge-m3(用户 live brain 已配)是**默认必需**配置——bootstrap 默认配置项、校验并报告;不可达时写入仍须成功(`embed_skip: true`),检索显式降级(`gbrain query` 在 embedding 不可用时自动退化为关键词)并提示局限,不得静默。
2. **gbrain files 对"资料本体"不持久登记**:小文件 `files upload-raw` 仅回显路径(no-op,无 DB 记录);media/大文件才走云上传 + `.redirect.yaml`。→ **指针一律靠 reference 页 Source 字段**,不依赖 upload-raw。本体留文件系统,gbrain 提供检索层。
3. **gbrain 已内置完整摄入生态**:`media-ingest`、`book-mirror`(CLI 命令,srve 持锁时阻塞、需 Anthropic 子代理与成本确认)、`strategic-reading`(纯 markdown skill,可会话内执行)、`ingest`、`_brain-filing-rules.md`、自动实体抽取。**skill 不得重造,只编排 + 执行 JSpace 纪律**。
4. **live brain 单进程锁**:`gbrain serve` 持锁时其他进程报 `LiveServeLockError`(正在被另一 claude 会话使用);skill 不绕过锁,经 CLI/MCP 操作并提示。
5. **embedding 校验命令**:bootstrap(未 serve)阶段用 `gbrain models doctor --json`(embedding_config + embedding_reachability);serve 会话内 doctor 降级为文件系统检查,**正确探针是"写页失败即 embedding 不可达"**。
6. 已有约定:gbrain 知识页 type 映射 + 写回纪律(`08-02-gbrain-memory-knowledge`,已加入 `skills/jspace-bootstrap/references/gbrain.md`)。

## Requirements

- **R1 skill 形态**:工作台侧 skill `skills/asset-ingest/`,由 `jspace init` 复制;可被工作台 AI 会话触发("把这份资料入库"、"整理 inbox"、"归位资料")。"学习这本书"为**可选深入路径**(book-mirror),非本任务 MVP 必达。
- **R2 归位协议**:资料先进暂存区,按类型归位——书籍/领域资料 → `areas/<领域>/`,项目产出 → `projects/<项目>/`;命名遵循 GOAL 规范 `YYYY-MM-DD-语义名-vN.ext`(**含 -vN**);登记项目 index.md;类型覆盖 pdf/ppt/txt/md/book + **excel(摘要+指针策略)**;MVP 为**逐份处理**(会话可循环调用,批量自动化留 M2)。
- **R3 入脑协议**:每份资料写 gbrain reference 页(是什么+关键事实+指针),遵守 type 映射与写回纪律;**入库前查重**(同语义已存在 → 提示跳过/覆盖/升版本);slug 派生规则见 design(与文件语义名绑定);版本升级、归档/删除时的指针处理见 design。
- **R4 中文召回**:embedding 为默认必需配置(语义见 Background 1);不可用时**显式降级 + 固定提示文本**(如"embedding 不可用,当前为关键词检索,中文命中率可能偏低"),不得静默。
- **R5 复用 gbrain(分层)**:基础路径 = skill 自实现"归位 + reference 页"(对齐 `_brain-filing-rules.md` 契约,不 invoke media-ingest 全流程);深度路径 = 用户要求时调用 gbrain 现成 `strategic-reading`(会话内)/ `book-mirror`(标注运行约束)。不重造 gbrain 摄入能力。
- **R6 兼容 live 与文件中心定位**:不独占/重启 live brain;文件中心注册为 hub.json `type=filehub` 的 resource,skill 读其 primary path 作为根;未注册 → 走降级路径(见 Constraints)。
- **R7 交付物含 CLI/模板改动**:`bin/jspace` 复制新 skill、工作台模板 AGENTS.md 注册 resolver row,作为本任务可测交付物(见 AC1)。

## Constraints

- 不改 gbrain 本体(schema/CLI/存储语义);不新增 frontmatter 字段。
- 不重造 gbrain 已有的摄入能力;`book-mirror` 深度集成(需 Anthropic 子代理/成本确认)不在 MVP。
- 本体不复制进 gbrain;不依赖 `upload-raw` 做持久登记。
- **降级暂存区不得在工作台 git 目录内**(工作台是 git 同步的控制平面);用工作台外目录或用户指定目录。
- 失败纪律:任一步失败即停、向用户报告具体原因、不留下半成品知识页。
- skill 目录:工作台侧 `skills/<name>/`,由 init 复制(与 jspace-bootstrap 同机制)。

## Acceptance Criteria

- [ ] AC1 skill 存在(SKILL.md 含 name/description/triggers);`jspace init /tmp/smoke` 后工作台含 `skills/asset-ingest/`;`gbrain doctor` 不报 asset-ingest resolver 缺失。
- [ ] AC2a 对一份真实中文资料,skill 完成:归位命名(含 -vN)+ 写 reference 页 + `gbrain get` 可取回(客观可查:文件落位、index 挂行、页存在)。
- [ ] AC2b embedding 可用时,`gbrain query` 语义命中该资料(隔离验收 brain 配 SiliconFlow 或 live 验证)。
- [ ] AC3 本体不复制进 gbrain;reference 页含真实 Source 指针。
- [ ] AC4 embedding 不可用时,会话输出含**固定降级提示**并降级到 search/query,不静默。
- [ ] AC5 未动 gbrain 本体、未新增 frontmatter 字段。
- [ ] AC6 live brain serve 会话不受影响(不动 serve 进程)。
- [ ] AC7 失败时不留半成品页(put 前归位完成、put 失败不产生孤儿 reference)。
- [ ] AC8 同语义资料二次入库时触发查重提示(跳过/覆盖/升版本)。

## Key Decisions

- **薄衔接层而非自造摄入器**:gbrain 已有 media-ingest/book-mirror/strategic-reading;skill = 编排 + JSpace 纪律执行。(四专家一致确认)
- **本体存文件中心、gbrain 存 reference 指针**:实证 + 源码确认 gbrain 小文件 upload-raw 为 no-op,指针靠 reference 页 Source 字段;GOAL.md 架构无需推翻,仅补充"gbrain 检索层 + 自带摄入能力"定位。
- **embedding 默认必需、不可用降级不阻塞**:与既有 offline-safe 契约调和;同步改 bootstrap SKILL.md Phase 1 + gbrain.md(四专家独立指向同一修正)。
- **降级暂存区在工作台外**:尊重 git 层分离(架构专家 HIGH-1)。
- 已决项见 design.md §2/§4/§6(落地位置、数据流、降级、复用边界);本 PRD 不再列"开放问题"。
