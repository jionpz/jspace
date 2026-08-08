# memory-writeback — 写回纪律细则

纪律源 = `~/.agents/skills/jspace-use/references/gbrain.md`（引用不复制）。本文件把 gbrain.md 的写回纪律固化为收工场景的细则。

## 1. 分类表与写语义

| 类别 | 目标 slug | 写语义 | 例 |
|---|---|---|---|
| 状态记忆 | `project/<id>/state` | 固定 slug **覆盖** | 进展 / 待办 / 当前决策 |
| 持久知识 | `knowledge/<项目\|域>/<主题>` | **append-only 新页** | 教训 / 可复用要点 |
| 决策（近况） | `decision/<主题>` | 固定 slug 覆盖 | 已定决策的当前版本 |
| 决策（历史） | `decision/<主题>-<日期>` | 新页 | 历史决策留痕 |
| 周快照 | `memory/consolidate/<日期>` | **转 memory-consolidate** | 本周汇总（本 skill 不写） |

- **绝不覆盖知识页**：知识只追加新页；更新「现状」只写 state 页。
- **state 页是全局固定 slug**：多会话覆盖同一页 → 归属（project id）必须准，防串页。

## 2. slug 派生（不发明）

- 状态：`project/<domain|project id>/state`（稳定标识，不随会话变化）。
- 知识：`knowledge/<项目|域>/<主题>`（主题 = 语义名，与 asset-ingest 的 `assets/` 命名空间不同，不冲突）。
- 从活跃项目（`hub.json` + 域 README + 既有 state 页）派生 project id，不臆造。

## 3. 晋升（记忆 → 知识）

**信号**（满足其一即可考虑晋升）：
- 同一事实**跨会话重复出现**（两次以上出现在不同 state 页/会话）。
- **决策已定**不再变（从「待定」变「已定」）。
- 提炼成**教训/要点**（可复用的怎么做、别怎么做）。

**处置**：写新知识页 `knowledge/<项目|域>/<主题>`；state 页保持「现状」不承载历史。晋升是判断题——skill 给信号，边界策略留给涌现。

## 4. 每页纪律

- `project` + `tags` + `source`（harness 出处）必带。
- `type` 按 gbrain.md：`note`（记忆，固定 slug 覆盖）/ `lesson` / `reference` / `decision`（知识）。
- `project` 归属 = 活跃项目发现结果；无项目归属的通用事实 → 用域 id 或 `jspace`（owner）。

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
