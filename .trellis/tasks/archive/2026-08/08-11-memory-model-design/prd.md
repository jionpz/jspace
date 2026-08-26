# 记忆模型重构:项目为中心的干净模型

## Goal

把 JSpace 记忆层从「功能驱动」重构为「模型驱动」:以**项目为中心**的命名空间(slug 即类型、写语义唯一、无两栖分类),让用户在 jspace-work 中俯瞰几十个项目的状态与交集——每个项目一张认知卡,决策史与经验跟随项目走。**设计能力优先,数据迁移延后**(迁移脚本备好,执行另定)。

## 用户价值

- 在 jspace-work 一眼看到所有项目的「是什么·解决什么/到哪了/下一步」+ 交集,支持跨项目管理
- 任何项目(含用 Trellis 等框架的代码项目)收工即积累认知,执行细节留在项目自己的框架
- 记忆分类干净:一个事实只有一个归属、一种写语义,不纠结「这算全局还是项目」

## 已确认决策(用户拍板)

1. **项目为中心**:代码/业务项目状态放 `project/<id>/`(代码项目 id = 仓库 ascii slug)
2. **不保留兼容性,做干净**:废弃全局 `decision/` 层(决策归项目)、废弃 `memory/` 前缀(→ `records/`)
3. **slug 即类型**:分类由 slug 承载,`type` 字段统一归一为 `note`,不再参与分类
4. **设计能力优先,数据迁移延后**:本次交付模型 + 能力,存量 14 页迁移另定
5. **交付边界**:R1-R4 + R6(迁移脚本备好),R5(project CLI 生命周期)延后
6. **state 卡只归项目**:领域/主题不建 state 卡,知识归 `knowledge/`;存量 `project/机器学习/state`、`project/gbrain/state` 迁移时转 knowledge/
7. **项目经验独立命名空间**:`project/<id>/lessons/<主题>`(与 decisions 对称);跨项目认识才升 `knowledge/`

## 记忆模型(本任务核心交付,R1 落地)

**原则:归属定根,语义定叶,写语义唯一。**

| 命名空间 | 写语义 | 内容 | 例 |
|---|---|---|---|
| `project/<id>/state` | 固定 slug **覆盖** | 现状卡:是什么·到哪了·下一步·执行层指针·相关项目 | `project/jspace/state` |
| `project/<id>/decisions/<主题>` | **追加·不可变** | 项目决策:决定+理由+日期+关联 | `project/jspace/decisions/不封装gbrain` |
| `project/<id>/lessons/<主题>` | **追加·不可变** | 项目专属经验/踩坑 | `project/jspace/lessons/中文slug的教训` |
| `knowledge/<域\|主题>/<主题>` | **追加·不可变** | 跨项目可复用认识(域=通用知识域,不含项目名) | `knowledge/governance/记忆积累全局规则` |
| `assets/<项目id\|领域>/<语义名>` | 覆盖/升版 | 指向文件本体的指针 | `assets/tiyanying-52/回访登记` |
| `records/consolidate\|retro/<date>` | 日期 slug·同周覆盖 | 周期快照/自省(各层的时间投影) | `records/retro/2026-08-10` |

**三条边界判据**:
1. 归项目:提到某项目名、在改它、为它做决定 → `project/<id>/`
2. 升全局:跨项目复用 → `knowledge/`(域组织,不含项目名);原则性红线 → knowledge 含 governance 域
3. 执行细节永不进 gbrain:任务/迭代/bug 留项目框架;state 卡放「执行层指针」字段指向框架,不复制

**三个废弃**:全局 `decision/` 层(决策跟随项目)、`memory/` 前缀(→ records)、type 参与分类(→ 归一 note)。

## Confirmed facts(仓库证据)

- 存量 14 页:project/(5)+knowledge/(1)+memory/(4)+assets/(4);`decision/` 实际无全局页
- type 已漂移:`project/52期体验营/state`=project、`project/jspace/state`=note、`assets/foo/doc`=concept
- 非项目卡存在:`project/机器学习/state`(领域)、`project/gbrain/state`(技术主题)
- 中文项目 slug 未归一:hub.json 项目 id 已 ascii(`tiyanying-52`/`baobiao-module`),gbrain slug 仍中文
- 官方 skill 源 `skills/`,gen-assets.ts 生成嵌入式资产(改 skill 需重跑 `bun run scripts/gen-assets.ts`)
- 注入腿 `application/context/{collect,payload}.ts`:collector 独立可扩展、stateLines「有事才说」模式
- gbrain.md 是旧模型承载者(type 语义表、memory/ 前缀、dated record 节)需重构,是 R1 落位处;type 语义表含**检索路径区分**(note=recent injection, reference/lesson/decision=stable Q&A)——归一 note 后需 tags 方案兜底检索(list 只有 --type/--tag 过滤,无 slug 前缀过滤)
- `jspace project` CLI 现有 `list/add`;全局 §4 已含「state 卡三段骨架 + wikilink + 执行细节边界」(2026-08-11)

## Requirements(本任务交付)

- **R1** 记忆模型权威定义:重构 gbrain.md(命名空间/写语义/边界判据/state 卡 schema + **tags 检索区分**),移除旧 type 分类语义与 memory/ 前缀;§4 与各 skill 引用一致
- **R2** 写侧对齐:memory-writeback / asset-ingest / weekly-report / memory-consolidate / workbench-retro 五个 skill 写 slug 与 type 改到新模型
- **R3** 注入腿:session-start 注入「活跃项目」行(project/*/state 行级投影,有事才说)
- **R4** 俯瞰视图:`jspace project list` 增强输出全部 project/*/state 卡(三段摘要 + 交集标记)
- **R6** 迁移脚本:存量 14 页映射 + type 归一 + 中文项目 id 归一;dry-run 可跑、--apply 受确认门控、幂等

## Out of scope(本任务)

- R5 project CLI 生命周期增强(建卡/更新/结项显式命令)——延后,更新路径由 §4 + memory-writeback 承担
- 存量 14 页迁移执行(脚本备好,执行另定)
- gbrain 版本升级(0.42.71 → 0.44.0,自愈运维)
- 具体项目初始卡生成(能力落地后自然涌现)
- officecli/markitdown 抽取(已完成)

## Acceptance Criteria

- [x] **AC-R1**:gbrain.md 含六命名空间 + 写语义矩阵 + 边界判据 + state 卡 schema + **tags 检索区分表**(knowledge/asset/project/weekly 标签路由);旧 type 分类语义(lesson/decision/reference 参与分类)与 memory/ 前缀移除;§4 引用一致
- [x] **AC-R2**:五个 skill 不再产生旧形态 slug——文档级断言:grep 命令(design.md §6 验收)对 `memory/consolidate|memory/retro`、`type: decision|reference|lesson` 零命中(asset-ingest 迁移文档与 gbrain-write.md 引用豁免,已排除)
- [x] **AC-R3**:`jspace context session-start --plain` 输出含「项目」行(活跃项目一行摘要);无活跃项目时该行省略;注入增量 ≤ 500 tokens(实测);gbrain 子进程超时(2s)不阻塞其余注入(单测覆盖)
- [x] **AC-R4**:`jspace project list --status` 以 gbrain 全部 project/*/state 卡为主体列出(是什么/到哪了/下一步 行级摘要)+ 相关项目(wikilink)标记,并附 hub 注册但无 state 卡的项目;单测覆盖
- [x] **AC-R6**:迁移脚本 `--dry-run` 输出与 14 页映射清单一致;`--apply` 需显式确认;重跑幂等;`memory-acceptance.md` 基线文档 slug 对齐(随迁移执行一并)

## Risks / Deferred

- memory-recall 可复跑验收基线建立在旧 slug 上——迁移执行后需重跑一次**且同步对齐 `memory-acceptance.md` 基线文档**(协议现成,一次性);本任务只备脚本不执行,基线不受影响
- 迁移执行期间新旧 slug 并存(过渡态,接受)
- R5 延后意味着 project CLI 生命周期靠 §4 + writeback 纪律,机制兜底待后续
