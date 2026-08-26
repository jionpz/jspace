# Design — AGENTS 块瘦身 + jspace-use 承接治理细节

## 1. 背景与现状

`templates/workbench/AGENTS.md` 的 JSPACE 块（`<!-- JSPACE:START -->` … `<!-- JSPACE:END -->`）当前 ~190 行正文，混了两类性质不同的内容：

- **每会话都要**的路由 + 红线：定位、请求分类表、注册表入口、知识路由表、确认规则、质量检查。
- **按需才用**的治理细节：域创建信号、资源 schema、skill 提议规则、cron 运维、升级所有权边界。

这些细节与 `skills/jspace-use/SKILL.md`（按需读）及其 `references/`（registry.md 已含资源 schema、headless-ops.md 已含 cron 运维）大量重叠，AGENTS.md 却全量背负，且 jspace-use 第 1 章写「此处不复制，读那两处」——互相推诿、未承接。

## 2. 目标形态

- AGENTS.md JSPACE 块 = 常驻路由 + 红线（~100 行），顶部一句指针把治理细节指向 jspace-use 第 8 章。
- jspace-use 第 8 章「治理细节」= 按需读的承接点，域 / skill / cron 细节 + 资源 schema 指针。
- 单向承接：AGENTS → jspace-use 第 8 章。消除「互推」表述。

## 3. 变更范围

| 文件 | 动作 |
|---|---|
| `templates/workbench/AGENTS.md` | 重写 JSPACE 块内散文（保留两个生成块 marker + 块头注释）；行数 ~100 |
| `skills/jspace-use/SKILL.md` | 新增第 8 章「治理细节」；清理其它章与 AGENTS 互推/重复的句子 |
| 生成物 | 重跑 `gen-assets`（模板重写本身不改 frontmatter，生成块字节不变；跑一次用于校验无漂移） |
| 代码 / 合同 | 不改：`skill-frontmatter.ts`、`gen-assets.ts`、`agents-block.ts`、SKILL.md frontmatter |

不改的还有 `templates/workbench/README.md`（升级边界正文已在那，AGENTS 引用它）。

## 4. 数据流与合同

- **生成块**：`renderAgentsBlocks(repoRoot, skillNames)` 只替换 `TRELLIS-SKILL-GOV` / `TRELLIS-BRAIN-OPS` 两个 marker 区间；本次不改 SKILL.md frontmatter → 生成块内容不变。重写模板散文后重跑 gen-assets 必须无 diff（散文不属于 marker 区间，不受渲染影响）。
- **JSPACE 块合同**：`agents-block.ts` 的 `extractAgentsBlock` / `replaceAgentsBlock` 以 `JSPACE:START`/`JSPACE:END` marker 为准，只动块内、插入到顶部。重写块内散文不触碰此机制。
- **升级传播**：既有带 marker 工作台经 `jspace workspace upgrade` 整块刷新（`block-update`）；块外用户内容保留。旧工作台（如 `~/jspace-work`，无 marker 的 pre-块版本）由既有升级/初始化路径处理，不在本任务范围。

## 5. 兼容性

- **模板侧**：新 init 工作台得到精简块；`init.test.ts` 只断言 `<!-- JSPACE:START -->` 嵌入，不依赖块内正文。
- **skill 侧**：jspace-use 是种子 skill，升级时未修改即刷新；第 8 章新增不破坏既有 readers（第 1–7 章序号稳定，第 8 章追加）。
- **gbrain 解析**：`TRELLIS-BRAIN-OPS` 块字节不变 → 路由行为不变。
- **无版本迁移**：AGENTS.md 块内文本升级即整块替换，无需 schema 迁移。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 精简时误删生成块 / 块头注释 | 用 marker 区间边界重写；重跑 gen-assets 校验无 diff；评审门核对生成块字节 |
| 顶部指针章节号漂移（第 8 章将来变序号） | 指针写「第 8 章（治理细节）」——以章名兜底，序号变更时同步改指针；本任务内章节稳定 |
| jspace-use 清理「互推」句时误删必要指引 | 只删指向 AGENTS/README 的回指句，保留所有权模型正文；diff review |
| 既有工作台 upgrade 后块变化影响会话 | 语义一致（信息未丢、换位置），且 upgrade 可 `--rollback <id>` |

回滚：源码侧 `git revert`；工作台侧 `jspace workspace upgrade --rollback <id>`。
