# memory-writeback 收工记忆写回 skill — 技术设计

## 定位

**写侧·会话事实** skill：会话结束时把持久事实按纪律写回 gbrain。纪律源 = `skills/jspace-bootstrap/references/gbrain.md`（引用不复制）；是 harness 会话结束 hook（bootstrap 接线）的**可执行体**。与 asset-ingest（写侧·资产）、memory-recall（读侧）构成写/读三足，不重叠。

## 边界

**IN**
1. `skills/memory-writeback/SKILL.md`（frontmatter + 流程步骤）。
2. `skills/memory-writeback/references/writeback.md`（写回纪律细则：分类 / slug 派生 / 晋升信号 / 降级）。
3. `templates/workbench/AGENTS.md`：「End-of-Work Capture」改为引用 skill；Approved skills + Brain operations 登记。
4. JWorkspace 同步 + 真实会话模拟演练。

**OUT**
- 文件归位（asset-ingest）；周快照（memory-consolidate）；harness 接线（bootstrap）。
- 任务管理、office 深入。

## skill 结构

```text
skills/memory-writeback/
  SKILL.md                    # 触发 + 6 步流程
  references/writeback.md     # 写回纪律细则(分类表/slug/晋升/降级)
```

## 写回纪律（纪律源 = gbrain.md，细则落 writeback.md）

| 类别 | 目标 slug | 写语义 | 例 |
|---|---|---|---|
| 状态记忆 | `project/<id>/state` | 固定 slug **覆盖** | 进展/待办/当前决策 |
| 持久知识 | `knowledge/<topic>` 或 `lesson/<topic>` | **append-only 新页** | 教训/可复用要点 |
| 决策 | `decision/<topic>` | 固定 slug 覆盖（近况）或新页（历史） | 已定决策 |
| 周快照 | ——（转 memory-consolidate） | 不写 | 本周汇总 |

- **晋升信号**（记忆 → 知识）：同一事实跨会话重复出现 / 决策已定不再变 / 提炼成教训。信号满足 → 写新知识页，state 页保持「现状」不承载历史。
- **slug 派生**：`project/<domain|project id>/state`（状态）；`knowledge/<项目|域>/<主题>`（知识）。不发明 slug，从活跃项目 + 主题派生。
- **每页纪律**：`project` + `tags` + `source` 必带；`source` = harness 出处。
- **降级**：embedding 不可达 → 写仍成功（`embed_skip: true`），提示「写入成功，embedding 不可用，检索降级」（不得静默，不得失败）。
- **活跃项目发现**：`hub.json` resources + 各域 README + 既有 `project/<id>/state` 页（与 weekly-report 同法，仅读取）。

## 流程（SKILL.md 步骤）

1. **扫描**：会话中是否有持久事实（进展/决策/教训/资产指针/规则/工作流）。无 → **静默结束**（对齐 End-of-Work Capture）。
2. **分类**：状态 / 知识 / 决策 / 周快照（转 consolidate）。
3. **归属**：定位 domain/project id + 实体 slug（活跃项目发现）。
4. **写回**：按上表写语义；晋升判定。
5. **验证**：`gbrain get <slug>` 读回；project/tags/source 齐全。
6. **文件归位**：有产出文件 → 转 asset-ingest（引用其步骤 2-4）。

## 与既有能力的关系

| 能力 | 写/读 | 对象 |
|---|---|---|
| asset-ingest | 写（资产） | reference 页 + Pointer/rel_path + index |
| **memory-writeback** | **写（会话事实）** | state 页 / knowledge 页 / 晋升 |
| memory-recall | 读 | 语义查询 → 指针断言 → 引用 |
| memory-consolidate（cron） | 写（周快照） | `memory/consolidate/<日期>` 周页 |
| bootstrap | 接线 | 会话结束 hook 调本 skill |

- **不重叠原则**：资产入脑（reference）→ asset-ingest；会话事实入脑（state/知识）→ 本 skill；周汇总 → consolidate。写同 slug 冲突不产生（各管各的命名空间）。

## 验证 / 演练

- **真实会话模拟**（serve 停泊窗口内 CLI）：
  1. 造一个「报表模块」会话状态（进度 + 一条教训）→ 按 skill 写回 → 验证 state 页覆盖 + 知识页新建 + project/tags/source 齐全。
  2. 覆盖场景：再次写同 slug → state 页更新不新增；知识页不重复。
  3. 晋升场景：重复事实 → 触发晋升写知识页。
  4. 无持久场景：无事实 → 静默（无页写入）。
- **JWorkspace 同步**：备份 + diff + doctor（沿用惯例）。
- **不回归**：asset-ingest / memory-recall / consolidate 契约不动；gbrain.md 纪律未改。

## 风险与对策

- **state 页全局 slug 串页**：`project/<id>/state` 是全局页——演练验证多项目归属不串；归属用活跃项目发现。
- **晋升判断题**：skill 给信号不设死规则；策略留给涌现。
- **锁时序**：演练 CLI、serve 停泊窗口内；不 kill serve / 不独立重启。

## 决策留痕

- **独立 skill**：写侧事实 ≠ 写侧资产，职责单一。
- **纪律源 = gbrain.md**：引用不复制。
- **hook 接线在 bootstrap，本 skill 是可执行体**。
- **无持久 → 静默**：对齐 End-of-Work Capture。
