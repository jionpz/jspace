# Design — Skills 重构:面向中等模型可执行性

> 技术设计。对齐 `prd.md` 的 R1–R6;不含逐步执行清单(见 `implement.md`)。

## 1. 设计原则

**中等模型的认知预算是稀缺资源。** 每一行 prose 都在消耗它。设计目标是把「读完能照做」所需的 token 与推理步数压到最低:
- **确定性外包给 CLI**:凡状态机/幂等/补偿,skill 只写「跑这条命令」,不复述其内部逻辑(CLI 已是单源真理)。
- **判断外包给决策表**:能勾选的不写成段落。
- **细节外包给 references + 条件指针**:主文件只在「决策点」触发懒加载。
- **完成度外包给自检**:模型不判断「做完没」,跑一条命令看 PASS/FAIL。

## 2. SKILL.md 元模板(R1 的产物骨架)

统一骨架(固定小节顺序,中等模型可预期):

```markdown
---
name: <slug>
description: "<一句可区分的定位> Use when <触发场景>. Do NOT use for <易混排除>."
---

# <name> — <中文一句话定位>

<1–2 句:这个 skill 把什么输入变成什么产出;确定性由谁兜底。>

## 何时用 / 何时不用
- ✅ 用:<触发场景,与易混 skill 切分>
- ❌ 不用:<明确排除,指向正确 skill>

## 决策表
| 判断 | 取值 | 动作 |
|---|---|---|
| <如 归属> | 项目产出 / 领域资料 | projects/ / areas/ |
| <如 查重> | 已存在 / 不存在 | 询问用户 / 继续 |

## 命令速查(完整签名)
```bash
jspace ingest begin <file> --target <路径> --slug <slug> --project <id> [--index <行>]
jspace ingest advance <journal-id> --gbrain | --index | --complete
jspace ingest fail <journal-id> --reason <原因>
```

## 步骤(主流程骨架)
1. …(每步一行;需要细节 → 条件指针)

## 按需深入(条件读指针)
- 要做**批量整理** → 先读 `references/batch.md`
- 要做 **office 深度抽取** → 先读 `references/deep-extract.md`
- 换机/导入后指针解析 → 先读 …

## Golden run
完整范例见 `references/example-*.md`(命令 + 预期输出 + 断言)。

## 自检(做完跑这条)
```bash
<一条命令 → PASS/FAIL>
```

## 参考
- `references/*.md` — <一句角色>
```

**行数纪律**:`何时用`+`决策表`+`命令速查`+`步骤`+`条件指针`+`自检` 控制在薄路由区间。批量、深度抽取、归位细则、写页模板等**全部**在 references。

## 3. 各 skill 的目标形态(结构改动地图)

| skill | 主文件现状 | 目标 | 关键下沉 |
|---|---|---|---|
| asset-ingest | 116 行,批量+深度抽取内联 | 薄路由;批量/深度抽取只留条件指针 | 「批量模式」段(65–97)→ `batch.md`(去重);深度抽取段 → `deep-extract.md` |
| memory-recall | 67 行,已较薄 | 套模板;补决策表(未命中诊断五类)+ golden run | 断言链细节已在 `discipline.md`,保持 |
| memory-writeback | 72 行 | 套模板;分类表提为决策表 | 分类细则留 `writeback.md` |
| jspace-bootstrap | 115 行,Phase 冗长 | 套模板;Phase 细节精简,命令速查集中 | gbrain/registry/harness 细节已在 references |
| harness-config | 92 行 | 套模板;Phase 保留(本就分阶段) | 接线命令已在 `harnesses.md` |

## 4. 单源化 skill 路由(R4 核心设计,2026-08-04 定版)

### 4.1 关键事实查证(修正此前误判)
`templates/workbench/AGENTS.md:163` 明文:"gbrain resolver rows (OpenClaw AGENTS.md layout). **This section is parsed by `gbrain` for skill routing**; keep the format intact."——该块由 **gbrain 二进制**解析,不是某 harness 读。逐字段比对:**块内每行 `- **<name>**: kw1 | kw2 | ...` 的关键词,与对应 SKILL.md frontmatter 的 `triggers` 列表逐字一致**。故修正 PRD 背景措辞:

- 「`triggers` 是无人消费的孤儿」需更正 → **`triggers` 实际是 gbrain resolver 的关键词来源,但当前靠"手工复制"从 frontmatter 粘贴进 resolver row**。这才是"三处手工同步"drift 的真因,而非字段本身无用。

### 4.2 现状三处手工同步(drift 源)
1. `skills/<name>/SKILL.md` frontmatter:`name` + `description` + `triggers`(关键词)
2. `templates/workbench/AGENTS.md`「Brain operations」块(gbrain 解析,resolver row 格式 = OpenClaw layout)
3. `templates/workbench/AGENTS.md`「Skill Governance」块(skill 清单 + 描述)

### 4.3 定版决策
- **保留 frontmatter `triggers` 字段(不改名)**:它是 gbrain resolver 关键词的**单一事实源**。字段名虽是历史遗留(语义更像"router keywords"),改名收益不抵风险 → 保留 `triggers`,仅在规范里写清"真实职责 = gbrain resolver 路由关键词数据源",与"AI 触发指令"的直觉切割。
- **采用方案 A:生成器渲染**(方案 B 降为 fallback)。`gen-assets` 新增渲染步:读 `skills-manifest.json` + 各 SKILL.md frontmatter → 重新生成 AGENTS.md 两个块到标记区间。
- **AGENTS.md 用标记区间**圈定可重生成区:
  ```
  <!-- TRELLIS-BRAIN-OPS:BEGIN -->
  - **<name>**: <triggers 用 | 拼接>
  ...
  <!-- TRELLIS-BRAIN-OPS:END -->
  ```
  「Skill Governance」同理用 `TRELLIS-SKILL-GOV` 标记。区间外内容(块标题、解说句如 "gbrain resolver rows ... keep the format intact")由模板保留,生成器只替换区间内的行。
- **结果**:三处手工同步 → **一处事实源(frontmatter)→ 两处渲染输出**。drift 机制根除;从"人复制"升级为"机器渲染"。

### 4.4 实现要点与边界
- `description` 进「Skill Governance」(一句),`triggers` 进「Brain operations」(resolver row),`name` 两处都用。
- `harness-config` 不在 `skills-manifest` workbench 列表(机器级全局,不物化)→ **不进 AGENTS.md 两块**(与现状一致);它通过自身 reference 被发现,与本设计无关。
- frontmatter 解析复用已有 `core/contracts/skills.ts` 的 `decodeSkillsManifest`(`scripts/gen-assets.ts:19`)。`triggers` 是否已在契约内 → **S2 spike 确认**;缺则扩 `SkillsManifestV1`(加字段 + decoder)。
- 规范约定"标记区间内不得手工编辑",并在 AGENTS.md 注释提示;生成器覆盖前若区间内有手工改动会被重写。
- **回退点**:若生成器引入回归(`assets-reachability.test.ts` / `init` 冒烟失败),fallback 方案 B(手工维护 + 自检校验三处一致),不阻塞 skills 瘦身主线。

### 4.5 仍留给 S2 的最小 spike
- 确认 `triggers` 是否已在 `core/contracts/skills.ts` 的 SkillsManifestV1 内;不在则定如何扩。
- 跑一次手工渲染对照:取现 AGENTS.md 两块,确认生成器输出与现状逐字一致(零行为变化的回归基线)。
- **不再问"gbrain resolver 关键词从哪来"——已查证:就是 `triggers`**(此前悬而未决的子决策,现关闭)。

## 5. 自检脚本设计(R6)

一个脚本(bash 或 bun,倾向 bun 与项目一致),校验并输出 PASS/FAIL + 明细:

- **C1 references 无断链**:解析每个 `skills/*/SKILL.md` 与 `references/*.md` 里的相对链接 `references/x.md`、跨 skill `../<skill>/references/x.md`,`test -f` 全部成立。
- **C2 渲染一致**:「Brain operations」每行关键词 == 对应 SKILL.md frontmatter `triggers`(按 `|` 拆分比对);「Skill Governance」每句描述 == frontmatter `description` 截断形态(或由生成器确定性派生,自检比对同源即可)。生成器渲染后此校验应恒真(拦回归);手工 fallback 时拦 drift。
- **C3 路由完整性**:「Brain operations」块与「Skill Governance」块的 skill 集合 == `skills/` 下 workbench skill 集合(用 `skills-manifest.json` workbench 列表为真理;排除 harness-config 等非物化);两块集合互相同。
- **C4 生成物新鲜**:重跑 gen-assets 后 `git diff cli/*.generated.ts templates/workbench/AGENTS.md` 干净(生成物已同步,含渲染后的 AGENTS.md)。

放置:`scripts/check-skills.ts`(仓库级开发校验,不物化进工作台)。可挂进 CI 或 build 前置。

## 6. golden-run 范例设计(R3)

- **数据源单一**:复用 `memory-acceptance.md` 已验收的 2 文档语料 + 52期体验营 xlsx 样例,不造新语料。
- **格式**:`references/example-<skill>.md`,含「输入状态 → 逐命令 → 每命令预期输出关键片段 → 最终断言」。
- **双重用途**:① 中等模型 few-shot(照抄改参);② 验收 fixture(AC1 Haiku 冷跑对照)。
- asset-ingest 范例覆盖 journal 四步 + 一次 cleanup-pending 收尾(最易错路径)。

## 7. 兼容性与影响面

- **可直接 break**:改 skill 结构、改 AGENTS.md 两块为生成器渲染(标记区间)、扩 SkillsManifestV1 契约均无需迁移通道(用户决策)。注:triggers 字段本身**保留**(单源),不在 break 之列。
- **物化链**:`skills/` + `skills-manifest.json` → `gen-assets`(含新增渲染步) → `cli/assets.generated.ts` + `cli/skills.generated.ts` + `templates/workbench/AGENTS.md`(两块渲染) → `jspace init` 物化。改 skill 必重跑 gen-assets(记忆 [[jspace-cli-assets-regeneration]])。
- **既有工作台**:不自动回填(记忆已知);本任务只保证新 `init` 正确。
- **harness-config 特殊**:机器级、不物化进工作台、不在 skills-manifest 的 workbench 列表 → 不参与 C3 路由完整性,但参与 C1 断链检查。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 瘦身丢失关键纪律(如 cleanup-pending 不虚报) | 纪律不删只**移位**到 reference + 主文件留条件指针;自检覆盖引用完整性 |
| 方案 A 生成器改动引入 gen-assets 回归 | 先 spike gbrain resolver 格式;生成器改动后跑现有 `assets-reachability.test.ts` |
| Haiku 冷跑验收不稳定(模型波动) | AC1 记录 transcript;若失败按「哪一步卡住」反推是结构还是范例问题,迭代 |
| 中英混排统一时误改命令/键 | 语言统一只动叙述句;命令/frontmatter key/配置键保留,纳入 review |
