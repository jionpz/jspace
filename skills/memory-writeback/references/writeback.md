# memory-writeback — 写回纪律细则

纪律源 = `~/.agents/skills/jspace-use/references/gbrain.md`（引用不复制）。本文件把 gbrain.md 的写回纪律固化为收工场景的细则。

## 1. 分类表与写语义

| 类别 | 目标 slug | 写语义 | 例 |
|---|---|---|---|
| 状态记忆 | `project/<id>/state` | 固定 slug **覆盖**,`tags: [project]` | 进展 / 待办 / 当前决策 |
| 项目决策 | `project/<id>/decisions/<主题>` | **append-only 新页** | 已定决策留痕 |
| 项目经验 | `project/<id>/lessons/<主题>` | **append-only 新页** | 教训 / 项目专属要点 |
| 跨项目知识 | `knowledge/<域>/<主题>` | **append-only 新页** | 跨项目可复用认识(域=通用知识域) |
| 周快照 | `records/consolidate/<日期>` | **转 memory-consolidate** | 本周汇总（本 skill 不写） |

- **绝不覆盖追加页**：decisions / lessons / knowledge 只追加新页；更新「现状」只写 state 页。
- **state 页是全局固定 slug**：多会话覆盖同一页 → 归属（project id）必须准，防串页。

## 2. slug 派生（不发明）

- 状态：`project/<project id>/state`（稳定标识，不随会话变化）。
- 项目决策/经验：`project/<project id>/decisions|lessons/<主题>`（主题 = 语义名）。
- 跨项目知识：`knowledge/<域>/<主题>`（域 = 通用知识域，如 governance / architecture；**不含项目名**）。
- 从活跃项目（`hub.json` + 域 README + 既有 state 页）派生 project id（**ascii slug**，代码项目 = 仓库名），不臆造。

## 3. 晋升（状态 → 决策/经验）

**信号**（满足其一即可考虑晋升）：
- 同一事实**跨会话重复出现**（两次以上出现在不同 state 页/会话）。
- **决策已定**不再变（从「待定」变「已定」）。
- 提炼成**教训/要点**（可复用的怎么做、别怎么做）。

**处置**：项目决策 → `project/<id>/decisions/<主题>`；项目专属教训 → `project/<id>/lessons/<主题>`；跨项目可复用认识 → `knowledge/<域>/<主题>`。state 页保持「现状」不承载历史。晋升是判断题——skill 给信号，边界策略留给涌现。

## 4. 每页纪律

- `project` + `tags` + `source`（harness 出处）必带。
- `type` 统一 `note`（分类由 slug 承载）；检索用 `tags` 路由（state=`[project]`、决策/经验=`[knowledge]`）。
- `project` 归属 = 活跃项目发现结果；无项目归属的通用事实 → 用 `knowledge/<通用域>/` + 打 tags。

## 5. embedding 降级

- 不可达 → 写仍成功（`embed_skip: true`），固定提示「写入成功,embedding 不可用,检索降级」（不得静默、不得失败）。
- 写失败非 embedding 原因 → 失败即停，不留半成品页。

## 6. 与相关文档关系

| 文档 | 角色 |
|---|---|
| `~/.agents/skills/jspace-use/references/gbrain.md` | 纪律源（state 覆盖 vs 知识追加 / 晋升） |
| `~/.agents/skills/memory-writeback/SKILL.md` | 日常流程（触发 + 6 步） |
| `~/.agents/skills/asset-ingest/SKILL.md` | 资产写侧（文件归位 / reference 页，转引用） |
| `templates/workbench/AGENTS.md` End-of-Work Capture | 何时触发的提示（引用本 skill，不双写纪律） |
