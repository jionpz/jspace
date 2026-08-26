# SKILL.md 元模板与编写规范(中等模型友好)

> 本文件是 `08-04-skills-medium-model-refactor` 的 S1 交付物:**模具**。所有 skill 主文件照此套用。资产:`research/skill-template.md`;不是仓库根 skill,不物化进工作台。

## 设计原则(为什么这么排)

中等模型的认知预算是稀缺资源。每行 prose 都在消耗它。五类翻车模式与骨架小节的对应:

| 翻车模式 | 骨架小节 |
|---|---|
| 1. 选错 skill | `description` frontmatter + `## 何时用 / 何时不用` |
| 2. prose 迷失 | 主文件行数纪律(薄路由)+ 细节下沉 references |
| 3. 不会懒加载 reference | `## 按需深入(条件读指针)` 在决策点内联触发 |
| 4. 幻觉命令/flag | `## 命令速查` 完整签名集中 |
| 5. 不知做完没 | `## 自检` 一条 PASS/FAIL 命令 |

外加 drift 消除:`triggers` frontmatter 作 gbrain resolver 关键词单源,由 gen-assets 渲染 AGENTS.md 两块(见 design §4)。

## 固定骨架(小节顺序固定,中等模型可预期)

```markdown
---
name: <slug>
description: "<一句可区分定位> Use when <触发场景>. Do NOT use for <易混排除>."
triggers:
  - "<kw1>"
  - "<kw2>"
---

# <name> — <中文一句话定位>

<1–2 句:输入是什么 → 产出什么;确定性由谁兜底(CLI/状态机)>

## 何时用 / 何时不用
- ✅ 用:<触发场景,与易混 skill 明确切分>
- ❌ 不用:<明确排除,指向正确 skill>

## 决策表
| 判断 | 取值 | 动作 |
|---|---|---|
| <判断1> | <值A> / <值B> | <动作A> / <动作B> |

## 命令速查(完整签名)
```bash
<jspace/gbrain 完整命令签名,含所有 flag>
```

## 步骤(主流程骨架)
1. <每步一行;细节 → 条件指针>
…

## 按需深入(条件读指针)
- 要做 <X> → 先读 `references/<x>.md`
- 要做 <Y> → 先读 `references/<y>.md`

## Golden run
完整范例(命令 + 预期输出 + 断言)见 `references/example-<skill>.md`。

## 自检(做完跑这条)
```bash
<一条命令 → PASS/FAIL>
```

## 参考
- `references/<a>.md` — <一句角色>
- `references/<b>.md` — <一句角色>
```

## 编写规范

### 行数纪律
- 主文件总数目标:**30–60 行**(asset-ingest 因流程复杂可略高,但批量/深度抽取等**必须**移出)。
- 判据:「读完能照做」所需的 = 何时用 + 决策表 + 命令速查 + 步骤骨架 + 条件指针 + 自检。其余全部下沉 reference。

### 什么进主文件 vs 下沉 reference
| 进主文件 | 下沉 references/ |
|---|---|
| 何时用/不用、决策表、命令速查、步骤骨架(每步一行)、条件读指针、自检命令 | 批量模式细则、深度抽取、归位/命名细则、写页模板、引用纪律、验收协议、office 抽取器说明 |

### frontmatter
- `name`:skill slug(与目录名一致)。
- `description`:**一句可区分**定位 + `Use when <场景>` + `Do NOT use for <易混排除>`。这是中等模型"选不选这个 skill"的唯一线索,必须让 sibling 易混 skill 看了能切分。
- `triggers`:**保留**(gbrain resolver 关键词单源,见 design §4.3)。每个关键词一行。命名上是历史遗留(语义更像 router keywords),**不要改成 `keywords` 等其他名**——gen-assets 渲染器按 `triggers` 读。
- 不留任何代码注释会被解析为指令的字段。

### 决策表
- 只放"模型需要做语义判断"的分支(归属/查重/类型/命中诊断),不放机械步骤。
- 每行可勾选:取值明确 → 动作明确。中等模型按行匹配,不打paragra推理。

### 命令速查
- **完整签名**:含所有可选 flag(`[--index <行>]` 等),不埋在 prose 里。
- 中等模型照抄改参,不幻觉 flag。
- 若 CLI 已有 `--help` 可见流程,skill 只写"跑 `jspace ingest --help` 照着做" + 速查表作为快速参照(单源在 CLI)。

### 条件读指针(关键:渐进披露的触发器)
- 不在文末平铺书单。在**决策点**内联:"要做 X → 先读 references/Y"。
- 形式:主文件步骤里到"需要批量"时,该步只写"→ 先读 `references/batch.md`",细节全在 reference。
- 中等模型不会主动读完所有 reference;指针让它按需取。

### 自检
- **一条命令**给出 PASS/FAIL,不靠模型主观判断"做完了"。
- 优先复用 CLI 已有的验证(`jspace doctor`、`gbrain get <slug>`、`jspace ingest list`)。
- 若无现成命令,写一行 `test -f` / `gbrain query` 类断言。

## 自我验收(本模板能否套进 asset-ingest)
S3 用 asset-ingest 验证。若套用发现以下任一,回 S1 改模板(Phase 回滚):
- 决策表放不下 asset-ingest 的归属/查重/版本判断 → 加列或加表。
- 命令速查装不下 journal 四步 → 允许速查分多块,但不得把细节写回 prose。
- 条件指针不够触发 batch/deep-extract/migration 三个分支 → 扩指针小节。
- 主文件超 60 行 → 检查是哪段该下沉,不是放宽容限。

## 与 sibling 设计的关系
- gen-assets 渲染 AGENTS.md 两块的实现在 design §4.3 / implement Stage 6,不在本模板职责内。本模板只定义 frontmatter `triggers` 字段的内容规范。
- 自检脚本(`check-skills.ts`)C2 校验"渲染后 resolver rows 与 triggers 逐字一致"——故 triggers 内容必须稳定(不随会话变),只随 skill 语义变。
