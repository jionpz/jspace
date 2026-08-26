# Skills 重构:面向中等模型可执行性

## Goal

把仓库 `skills/` 下的 skill 从「用 prose 教模型怎么做」重构为「**薄路由 + 决策表 + 命令速查 + golden-run 范例 + 机械自检**」的结构,使**中等能力模型(Haiku 4.5 档)照着 skill 也能可靠地把任务做到底**——尤其是无头 cron 场景可能用便宜模型跑的 `asset-ingest` 批量流程。

对齐 GOAL.md:skill 是「记忆/资产/路由」四支柱的**可执行体**;确定性已由 CLI(`jspace ingest`/`pending` 状态机)兜底,skill 只应承担**语义判断 + 路由**,不应要求执行模型做跨文件 prose 状态追踪。

## Scope

**In scope(5 个 skill):**
- `asset-ingest`(重点:116 行主文件 + 5 references,批量/深度抽取内联过多)
- `memory-recall`
- `memory-writeback`
- `jspace-bootstrap`
- `harness-config`(机器级全局 skill,不随工作台物化)

**Out of scope:**
- CLI/core 代码改动(cron split-brain、contentHash bug 等归入**另一个 CLI 任务**,本任务不碰 TS 源码)。
- gbrain 上游行为、模板 domain/resource 结构。
- 新增 skill(本任务只重构既有 5 个)。

## 背景:中等模型的 5 类翻车模式(重构要逐条消除)

1. **选错 skill** — description 不可区分(bootstrap vs harness-config 都含「配置」;recall vs ingest 都碰召回)。
2. **prose 里迷失** — SKILL.md 过厚(asset-ingest 116 行),关键步骤被淹没;无渐进式披露。
3. **不会懒加载 reference** — 「## 参考」是平铺书单,没有「当 X 时先读 Y」的条件指针。
4. **幻觉命令/flag** — 精确 CLI 签名埋在 prose,缺集中的命令速查。
5. **不知做完没** — 无机械自检,靠模型主观判断「完成」。

外加两个 drift 隐患:多处事实源(cleanup-pending 出现 3 处、两份同名 harnesses.md)、skill 路由关键词靠「手工把 frontmatter `triggers` 复制进 AGENTS.md resolver row」三处同步。

## Requirements

### R1 — 元模板标准(结构先于内容,第一交付物)
- 产出一份 `SKILL.md` 标准模板 + 编写规范(落在任务 research/ 或仓库 skill 编写指南),规定薄路由结构的固定骨架:
  - **何时用 / 何时不用**(Use-when + Do-NOT-use-when,消除翻车模式 1)
  - **决策表**(可机械勾选的判断,如归属/查重/类型)
  - **命令速查**(完整 CLI 签名,消除翻车模式 4)
  - **步骤主线**(≤ 主流程骨架,细节移 references)
  - **条件读指针**(在决策点内联「要做 X → 先读 references/Y.md」,消除翻车模式 3)
  - **golden-run 指针**(指向端到端范例)
  - **机械自检**(一条可判 PASS/FAIL 的检查,消除翻车模式 5)
- SKILL.md 主文件目标行数:薄路由约 30–60 行(asset-ingest 因流程复杂可略高,但批量/深度抽取必须移出)。

### R2 — 逐 skill 套用瘦身(asset-ingest 先行样板)
- 每个 skill 主文件套用 R1 模板;把纯细节下沉到 references。
- `asset-ingest`:批量模式(SKILL.md 65–97 行)收成一行条件指针指向 `references/batch.md`;深度抽取同理。主文件与 `batch.md` 的重复段落去重,单源保留在 reference。
- 保持既有 references 的相对引用完整(见 R6)。

### R3 — golden-run 范例(对中等模型杠杆最高)
- 每个 skill 补 1 个端到端范例(命令 + 预期输出片段 + 关键断言),落在 `references/example-*.md` 或 SKILL.md 末尾指针。
- 范例**兼作验收 fixture**:`memory-recall`/`asset-ingest` 复用现有 `memory-acceptance.md` 的 golden run 作为 few-shot 来源,不另造一套语料。

### R4 — triggers 单源化 + 生成器渲染 skill 路由
- **查证修正**:`triggers` **非孤儿**——`templates/workbench/AGENTS.md:163` 明示「Brain operations」块由 **gbrain 二进制**解析用于 skill routing,块内 resolver row 的关键词与各 SKILL.md frontmatter 的 `triggers` **逐字一致**(当前靠手工复制消费,是 drift 真因)。
- **保留 frontmatter `triggers` 字段**(不改名)作为 gbrain resolver 关键词的**单一事实源**;在规范里写清其真实职责=路由关键词数据源(澄清"AI 触发指令"的直觉误读)。
- **采用生成器**:`gen-assets` 新增渲染步,读 frontmatter → 重新生成 AGENTS.md「Brain operations」(resolver rows)与「Skill Governance」(skill 清单 + 一句描述)两块到标记区间。三处手工同步收敛为「一处事实源 → 两处渲染输出」。
- 标记区间约定区间内不得手工编辑;`harness-config`(机器级、不物化、不在 workbench skills-manifest 列表)不进两块(与现状一致)。
- fallback:生成器若引入回归则退回手工维护 + 自检校验,不阻塞 skills 瘦身主线。

### R5 — 三个高频 skill 语言统一
- `asset-ingest`/`memory-recall`/`memory-writeback` 叙述统一中文,命令/字段/配置键保留英文原文(项目默认中文,这三个被无头/反复读)。
- `jspace-bootstrap`/`harness-config` 语言统一为**可选/低优先**(受众是一次性配置会话,非高频执行);若成本低顺手做,否则本任务不强制。

### R6 — 引用完整性(机械自检的一部分)
- 重构不得留断链:所有 SKILL.md → references 相对引用、跨 skill 引用(如 recall 引 `asset-ingest/references/gbrain-write.md`、writeback 引 `jspace-bootstrap/references/gbrain.md`)重构后仍解析。
- 产出一个可复跑的自检脚本或命令,校验:① 每个 SKILL.md 声明的 references 存在;② 每个 `AGENTS.md`「Brain operations」/「Skill Governance」条目对应真实 skill;③ 「Brain operations」resolver rows 与各 SKILL.md `triggers` **逐字一致**(生成器渲染后,此校验应恒真;若用手工 fallback 则挡 drift);④ 生成器渲染的两个标记区间与 frontmatter 一致。

## Constraints

- **改源不改生成物直接产**:skill 源在 `skills/`;改后必须重跑 `bun run gen-assets`(或 `build`)同步 `cli/assets.generated.ts` 等嵌入式资产(见记忆 [[jspace-cli-assets-regeneration]]),否则工作台物化拿到旧版。
- **可直接 break**(用户决策):无兼容负担,不做迁移通道;结构直接改、AGENTS.md 两块改为生成器渲染(标记区间)。
- **不碰 CLI TS 业务源码**:本任务动 skill/文档/自检脚本,以及 `gen-assets` 的渲染扩展(属生成器,非 CLI 业务逻辑);CLI bug 另开任务。
- **验证闭环**:改完 `bun run cli/main.ts init /tmp/jspace-skills-smoke` 生成工作台,确认 skills 正确物化且自检通过。

## Acceptance Criteria

- [ ] **AC1(核心·实测)**:用 **Haiku 4.5** 对 `asset-ingest` 的 golden run 做一次冷执行(给一个 inbox 样本文件),模型能仅凭 SKILL.md + 按需读的 reference,照决策表与命令速查把 `ingest begin → advance --gbrain → advance --index → advance --complete` 跑到底,不幻觉 flag、不漏步骤。记录 transcript 为证据。
- [ ] AC2:5 个 SKILL.md 全部套用 R1 元模板;主文件行数达标(批量/深度抽取等细节已下沉 references)。
- [ ] AC3:每个 skill 有 1 个 golden-run 范例;`memory-recall`/`asset-ingest` 复用 `memory-acceptance.md` 语料。
- [ ] AC4:frontmatter `triggers` 作为 resolver 关键词单源保留;gen-assets 渲染 AGENTS.md「Brain operations」/「Skill Governance」两块到标记区间;一致性自检通过(references 无断链、渲染输出与 frontmatter 逐字一致、两块与 skill 集合一致)。
- [ ] AC5:`asset-ingest`/`memory-recall`/`memory-writeback` 语言统一中文(命令/键保留英文)。
- [ ] AC6:`gen-assets` 重跑,嵌入式资产同步;`init` 到临时工作台物化正确、`doctor` 通过。

## Key Decisions(规划留痕)

- **结构先于内容(2026-08-04)**:先定 R1 元模板再逐 skill 套用,最后补范例。理由:范例塞进未瘦身的厚文件只会更臃肿;系统性收敛优于逐点打补丁。修正了初版「补范例与瘦身并列 S-P0」的顺序错误。
- **triggers 身份厘清(2026-08-04)**:初判误以为是孤儿,深查 `AGENTS.md:163` 证据后修正——`triggers` 实为 gbrain resolver 关键词来源,当前靠手工复制消费(drift 真因)。决策**保留 `triggers` 作单源 + gen-assets 机器渲染**两块到标记区间,而非删除。约束可直接 break 让 AGENTS.md 两块改为生成器渲染无负担。
- **语言统一范围收窄到 3 个高频 skill(2026-08-04)**:harness-config/jspace-bootstrap 受众是一次性配置会话、不随工作台物化,语言统一收益低,降为可选。
- **验收必须实测而非主观(2026-08-04)**:AC1 用 Haiku 冷跑 golden run 作为可证伪验收,而非「读起来更清晰」。
- **CLI bug 剥离(2026-08-04)**:cron split-brain + 二进制 contentHash 等正确性 bug 是本次架构诊断的重要发现,但属 CLI 层,另开任务,避免本任务范围膨胀。
- 对齐依据:GOAL.md(skill 是四支柱可执行体、确定性由 CLI 兜底)、记忆 [[jspace-no-trellis-spec]](JSpace 用 AGENTS.md+GOAL.md 对齐子代理)、[[jspace-cli-assets-regeneration]](改 skill 必重跑 gen-assets)。
