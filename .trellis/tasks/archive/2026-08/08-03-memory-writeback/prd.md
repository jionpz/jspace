# memory-writeback 收工记忆写回 skill（会话结束→持久事实入脑）

## Goal

把 GOAL 场景 #4（**收工**：会话结束前，本次的持久事实带项目/域归属自动写回 gbrain）日常化：把工作台 AGENTS.md 的「End-of-Work Capture」散文 + gbrain.md 的写回纪律，封装成**可执行、跨 harness 一致**的 skill。会话结束（或用户说「收工」）时：扫描本次持久事实 → 分类 → 按纪律写回 → 验证。写回纪律源 = `skills/jspace-bootstrap/references/gbrain.md`；与 asset-ingest（资产入脑，写侧）互补、与 memory-recall（精准召回，读侧）对称。

## Background（证据）

- **现状缺口**：工作台 AGENTS.md「End-of-Work Capture」是一段散文（quietly check 是否该保留：durable domain/resource fact / rule / workflow / skill），没有可执行流程；gbrain.md 有写回纪律（固定 slug state 覆盖 vs append-only 知识 + 晋升），但**没有 skill 把它变成会话结束时能跑的步骤**。
- **GOAL 场景 #4**：收工时持久事实（带归属）写回 gbrain；产出文件归位文件中心（归位 = asset-ingest 职责，本 skill 只引用）。
- **已有纪律（引用源）**：
  - 状态记忆：`project/<id>/state` 固定 slug **覆盖写**（progress/todo/当前决策）。
  - 持久知识：lesson/reference/decision **append-only 新页**，不覆盖。
  - **晋升**：记忆事实变持久（如 lesson）→ 写新知识页，不压 state 页。
  - 每页带 `project` + `tags`；`source` 标出处；slug 派生不发明。
  - Dated memory record（周快照）由 memory-consolidate cron 承担，本 skill 不重复。
- **触发现状**：bootstrap 接线了 harness 会话结束 hook（工作结束写回）；hook 触发后实际执行什么，目前无 skill 定义——本 skill 即「hook/会话调用的可执行体」。
- 相关既有物：memory-recall（读侧，已交付）、asset-ingest（写侧资产）、memory-consolidate / weekly-report（cron 契约，M4 解锁）、gbrain.md（纪律源）。

## Requirements

- **R1 独立 skill**：`skills/memory-writeback/`，含 `SKILL.md` + `references/writeback.md`。纪律引用 gbrain.md，不复制。
- **R2 触发面**：会话结束 / 用户「收工」「写回记忆」「记一下本次进展」；也作为 harness 会话结束 hook 的可执行体（接线由 bootstrap 负责，skill 不修改 harness 配置）。
- **R3 流程（skill 步骤）**：
  1. **扫描**：会话内是否有持久事实（进展/决策/教训/资产指针/规则/可复用工作流）。无 → 静默结束（对齐 End-of-Work Capture：无持久物不提）。
  2. **分类**：状态记忆（progress/todo/当前决策）/ 持久知识（lesson/reference/decision）/ 周快照（**转 memory-consolidate，不写**）。
  3. **归属**：定位 domain/project id + 统一实体 slug；从活跃项目（hub.json + 域 README + 既有 `project/<id>/state` 页）发现。
  4. **写回**：状态 → `project/<id>/state` 固定 slug 覆盖；知识 → append-only 新页；**晋升**：记忆变持久 → 写新知识页。
  5. **验证**：`gbrain get` 读回；每页 project + tags + source 齐全。
  6. **文件归位**：若有产出文件 → 转 asset-ingest（引用，不重复）。
- **R4 与既有物分工**：asset-ingest = 资产写侧（reference 页 + Pointer/rel_path）；memory-writeback = 会话事实写侧（state 页 + 知识页 + 晋升）；memory-recall = 读侧；memory-consolidate = 周快照。**不重叠**。
- **R5 落地**：REPO `skills/memory-writeback/` + `templates/workbench/AGENTS.md`（End-of-Work Capture 引用 skill + Approved skills 列表 + Brain operations 触发词）+ JWorkspace 同步（diff + doctor）。

## Acceptance Criteria

- [ ] REPO `skills/memory-writeback/SKILL.md` + `references/writeback.md` 存在；写回纪律与 gbrain.md 一致（state 覆盖 / 知识 append-only / 晋升 / project+tags / slug 派生）。
- [ ] 真实会话模拟跑通：模拟一次会话产生的状态 + 知识 → 按 skill 写回 → `gbrain get` 读回验证（state 页覆盖更新、知识页新增、晋升发生）。
- [ ] 无持久事实场景：静默结束（不写页、不提示）。
- [ ] `templates/workbench/AGENTS.md`：「End-of-Work Capture」改为引用 memory-writeback skill；Approved skills 列表新增；Brain operations 登记触发词。
- [ ] JWorkspace skills 刷新后 diff 无差异；`jspace doctor` 通过。
- [ ] 不回归：asset-ingest / memory-recall / memory-consolidate 契约未被破坏；gbrain.md 纪律未改（仅引用）。

## Out of Scope

- **文件归位**（asset-ingest 职责；本 skill 只转引用）。
- **周快照 consolidation**（memory-consolidate cron 契约，M4 已锁）。
- **harness 接线**（bootstrap 职责；本 skill 是可执行体，不修改 hook/MCP 配置）。
- 任务管理（工作台无 task manager）；office 深入解析。

## Key Decisions

- **独立 skill `memory-writeback`**：写侧事实与写侧资产分开（asset-ingest 管 reference 页，本 skill 管 state/知识页），职责单一。
- **纪律源 = gbrain.md**（引用不复制），避免双写漂移。
- **hook 由 bootstrap 接线，skill 是可执行体**：本 skill 定义「写什么、怎么写」，不碰 harness 配置。
- **无持久事实 → 静默**（对齐 End-of-Work Capture）；有则简述将写什么、写哪、为何。
- **触发词走 AGENTS.md Brain operations + SKILL.md frontmatter**（与 asset-ingest / memory-recall 机制一致）。

## Risks / Deferred

- **skill 与 AGENTS.md End-of-Work Capture 散文重复**：改为引用 skill，散文保留为「何时触发」的提示，不双写纪律。
- **state 页 slug 冲突**：`project/<id>/state` 是全局固定 slug——不同 harness 会话覆盖同一页；`project` 归属要准（从活跃项目发现），防止串页。演练验证。
- **晋升边界**：何时记忆变持久是判断题——skill 给信号（重复出现/决策已定/教训），不设死规则（策略留给涌现）。
- **真实会话验证依赖 gbrain 锁**：演练在 serve 停泊窗口内 CLI 完成（沿用 M4/M5 约束）。
