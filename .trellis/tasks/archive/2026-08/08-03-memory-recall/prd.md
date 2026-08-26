# memory-recall 精准召回 skill（「问一句→找数→引用出处」）

## Goal

把 M4 验收协议（`docs/MEMORY-ACCEPTANCE.md`）中证明有效的召回纪律固化为**工作台可复用 skill**：用户在任意会话「问一句」，AI 走「语义查询 → 校验 → 指针断言链 → 打开文件引用出处」得到带出处的答案；未命中时走**有终止的校准**与**不静默的降级提示**。对齐 GOAL 场景 #3（随口一问："上季度 Acme 报价单里的单价是多少？" → 召回事实与指针 → 打开文件核对 → 给出答案并引用出处）。

## Background（证据）

- **M4 已锁定召回纪律并产出可复跑验收协议**（`docs/MEMORY-ACCEPTANCE.md`）：四条逐字固定规范查询 Q1/Q1'/Q2/Q2'、变体查询 + 负对照防假阳性、连续 ≥3 次重跑稳定性、`search`/`query` 双路径留证、**指针断言四连**（`gbrain get <slug>` → Pointer 字段 → `test -f` → `grep` 正文找数）。
- **该纪律目前只存在于一次性验收协议，未进入工作台日常能力**。asset-ingest 只覆盖**写侧**（入库 + 归位后的召回自检），用户主动「问一句」的**读侧**召回无任何 skill——这是本任务要补的空白。
- **依赖 M4 完成**：两份真实资料（会议纪要、ML 笔记）已归位 filehub + 写 gbrain reference 页 + 验收通过（serve 停泊窗口内 CLI canonical 面）。skill 的可用性与演示用例建立在已入库语料之上。
- 工作台 skill 分发机制：REPO `skills/` 随 `jspace init` 复制进工作台；需在 `templates/workbench/AGENTS.md` 的「Approved workbench skills」与「Brain operations」两处登记（批准列表 + 触发词）。真实 JWorkspace 需刷 skills 同步。

## Requirements

- **R1 独立 skill**：`skills/memory-recall/`，含 `SKILL.md` + `references/`（召回纪律细则；可选 eval 复用 MEMORY-ACCEPTANCE）。不并入 asset-ingest。
- **R2 触发面**：用户「问一句 / 找那个文件 / 那个数」类请求进入本 skill；与 asset-ingest 的「归位后召回自检」互补不重叠（写侧自检 vs 读侧主动召回）。
- **R3 召回流程（skill 步骤，纪律源 = MEMORY-ACCEPTANCE）**：
  1. **语义查询**：`gbrain query <question>`（中文优先）。embedding 不可达 → 降级关键词 + 固定提示「embedding 不可用，当前为关键词检索，中文命中率可能偏低」（不得静默）。
  2. **校验**：确认 top-1 命中候选页；必要时变体查询/负对照防假阳性（代价低时做，非强制）。
  3. **指针断言链（四连过才算命中）**：① `gbrain get <slug>` → 取 Pointer；② `test -f "<Pointer>"`；③ 打开/`grep` 文件正文找数；④ 用候选页作答。
  4. **作答并引用出处**：答案 + 文件路径 + gbrain slug。
  5. **未命中 → 有终止校准**：诊断类别（slug / tags / embedding 配置 / 查询措辞 / 纪律缺口）→ 属纪律缺口才 REPO 修正并刷 JWorkspace；配置/措辞类只记录（ROI 护栏）→ 重跑，≤3 轮或显式终态。
- **R4 与 M4 验收的关系**：skill 是**日常化**；MEMORY-ACCEPTANCE 是**可复跑回归**。skill 引用而非复制协议；不改动 M4 已锁 slug/纪律（如需修订走 M4 授权流程）。
- **R5 落地范围**：REPO `skills/memory-recall/` + `templates/workbench/AGENTS.md`（批准列表 + 触发词）+ 真实 JWorkspace 刷 skills（diff 无差异、doctor 通过）。

## Acceptance Criteria

- [ ] REPO `skills/memory-recall/SKILL.md` + `references/` 存在；召回纪律与 `docs/MEMORY-ACCEPTANCE.md` 一致（引用而非改写）。
- [ ] 工作台「问一句」跑通：用 M4 已入库语料，Q1/Q2 类问题 → top-1 正确页 → **指针断言四连全过** → 答案引用出处（文件路径 + slug）。
- [ ] 未命中走诊断（≤3 轮或显式终态）；embedding 不可达固定提示不静默。
- [ ] `templates/workbench/AGENTS.md`「Approved workbench skills」新增 memory-recall + 「Brain operations」登记触发词。
- [ ] 真实 JWorkspace skills 刷新后 `diff -rq` 无差异；`jspace doctor --dir <workspace>` 通过。
- [ ] M4 验收不回归：skill 不改变已锁 slug/纪律；如触发纪律修订，走 M4 授权流程并留痕。

## Out of Scope

- **收工写回**（GOAL 场景 #4，End-of-Work Capture 日常化）—— 分析已识别为次缺口，**另立任务**，不在本任务做。
- office 逐表抽取等深入召回路径（GOAL 开放问题 #4）。
- 检索权重/新鲜度调参、多机重建冒烟（M5）。
- 双路径留证仅作为 skill 的可选自检手段，不强制每次召回都记录（那是验收协议，不是日常纪律）。

## Key Decisions

- **独立 skill `memory-recall`**，不并入 asset-ingest：写侧（入库+自检）与读侧（主动召回）触发点不同，合并会让单个 skill 职责过载。
- **纪律源 = MEMORY-ACCEPTANCE.md**：skill 引用协议、protocol 是回归；两者不双写漂移。
- **未命中校准有终止（≤3 轮）+ ROI 护栏**：只有纪律缺口才 REPO 修正；配置/措辞类只记录，不轻易改 skill。
- **触发词走 AGENTS.md Brain operations + SKILL.md frontmatter**：与现有 jspace-bootstrap / asset-ingest 的登记机制一致。

## Risks / Deferred

- **顺序依赖 M4 完成**（语料入库 + 验收通过）。M4 阶段 B/C 当前阻塞于 gbrain 锁释放；本任务先完成规划工件，实施排在 M4 之后。
- **真实 JWorkspace 非 git**：改前备份到持久路径 + diff 预检 + doctor 校验（沿用 M4 阶段 A 流程）。
- **gbrain 锁**：skill 本身 harness 无关；但演示/验收沿用 M4 的 canonical 面约束（CLI、serve 停泊窗口）。
