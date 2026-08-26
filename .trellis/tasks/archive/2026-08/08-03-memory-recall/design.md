# memory-recall 精准召回 skill — 技术设计

## 定位

把**读侧召回**固化为工作台可复用 skill。纪律源 = `docs/MEMORY-ACCEPTANCE.md`（M4 已验收、可复跑回归）；skill **引用而非复制**协议，不引入新机制，只把已验证的召回纪律封装成可触发的流程。本任务纯**新增**，不动 M4 已锁 slug/纪律。

## 边界

**IN（交付物）**
1. `skills/memory-recall/SKILL.md`（frontmatter: `name` / `description` / `triggers` + 流程步骤）。
2. `skills/memory-recall/references/discipline.md`（召回纪律细则，从 MEMORY-ACCEPTANCE 提炼：断言链、变体/负对照、未命中诊断、降级提示、canonical 面约束）。
3. `templates/workbench/AGENTS.md` 更新：「Approved workbench skills」新增 memory-recall + 「Brain operations」登记触发词。
4. 真实 JWorkspace skills 刷新（备份 + diff + doctor，沿用 M4 阶段 A 流程）。

**OUT**
- 收工写回 skill（GOAL 场景 #4）—— 另立任务，本任务不做。
- office 逐表抽取、检索权重/新鲜度调参、多机重建（M5）。
- 修改 `docs/MEMORY-ACCEPTANCE.md` 协议本体（除非 M4 授权修订，本任务默认只引用）。
- 修改 asset-ingest / jspace-bootstrap 已有纪律。

## 目录结构

```text
skills/memory-recall/
  SKILL.md                    # 流程步骤 + 触发（读侧「问一句」）
  references/discipline.md    # 召回纪律细则（断言链/变体负对照/诊断/降级/面约束）
```

> 与 asset-ingest 对称：写侧是 `asset-ingest`（入库+自检），读侧是 `memory-recall`（主动召回）。两个 skill 共用同一份写回/embedding 纪律（各自引用 gbrain.md）。

## skill 流程（SKILL.md 步骤，纪律源 = MEMORY-ACCEPTANCE）

1. **前置**：定位 gbrain（`$GBRAIN_BIN` → `which gbrain` → `~/.bun/bin/gbrain`）；embedding 可达性（`gbrain models doctor --json`，仅需可达即可，不阻塞查询）。
2. **语义查询**：`gbrain query <question>`（中文优先）。embedding 不可达 → `gbrain search` 关键词降级 + 固定提示「embedding 不可用，当前为关键词检索，中文命中率可能偏低」（**不得静默**）。
3. **校验**：确认 top-1 命中候选页；代价低时做变体查询/负对照防假阳性（换个说法再问一次，候选页应保持 top-1，无关页不得反超）。
4. **指针断言链（四连过才算命中）**：
   ① `gbrain get <slug>` → 取 Pointer 字段；
   ② `test -f "<Pointer>"` 成立；
   ③ 打开 / `grep <关键词>` 文件正文找到那个数；
   ④ 用候选页内容作答。
5. **作答并引用出处**：答案 + 文件绝对路径 + gbrain slug（可点开、可复检）。
6. **未命中 → 有终止校准**：诊断类别（slug / tags / embedding 配置 / 查询措辞 / 纪律缺口）→ **仅纪律缺口**才 REPO 修正并刷 JWorkspace；配置/措辞类只记录（ROI 护栏）→ 重跑，≤3 轮或显式终态（接受关键词降级记入验收文档 / 上报用户）。

## 纪律细则要点（references/discipline.md）

- **canonical 面约束**：默认 CLI（serve 停泊窗口内）；MCP 面（真实使用面）query 冒烟对齐（沿用 M4）。
- **防假阳性**：变体查询 + 负对照（低成本时必做）。
- **稳定性**：日常召回不强制 ≥3 次重跑（那是验收协议）；仅在「存疑/校准」时按协议重跑。
- **双路径留证**：验收/回归用（`search` 与 `query` 各记录一次，证明语义层加分）；日常非强制。
- **未命中诊断**：五类 + 终止（≤3 轮）+ ROI 护栏。
- **embedding 降级**：固定提示，不得静默；写侧纪律见 gbrain-write.md。
- **指针断言**：`get` → Pointer → `test -f` → `grep` 四连；Pointer 是绝对路径（本机真理，按机维护）。

## 与现有能力的分工（防职责重叠）

| 能力 | 归属 |
|---|---|
| 写侧：资料入库 + 归位后召回自检 | asset-ingest（既有） |
| **读侧：用户主动「问一句」召回** | **memory-recall（本任务）** |
| 会话起注入 / 止写回的接线 | jspace-bootstrap（既有） |
| 召回纪律的可复跑回归 | docs/MEMORY-ACCEPTANCE.md（既有，skill 引用） |

## 落地与同步

1. REPO 源写 skill → 校验（frontmatter 合法、步骤完整、纪律与协议一致）。
2. `templates/workbench/AGENTS.md` 两处登记（批准列表 + Brain operations 触发词）。
3. 真实 JWorkspace 刷 skills：备份到 `~/.jspace-backup/memory-recall-<ts>/` → diff 预检 → 复制（不动 hub/owner 域、harness-config 不复制）→ `diff -rq -x harness-config` 无差异 + `jspace doctor` 通过。
4. 演示/验收「问一句」用 M4 已入库语料跑通（serve 停泊窗口内 CLI 面）。

## 决策留痕

- **独立 skill**，不并入 asset-ingest：写/读侧触发点不同，合并导致职责过载。
- **纪律源 = MEMORY-ACCEPTANCE.md**：skill 引用、协议是回归，不双写漂移。
- **校准有终止 + ROI 护栏**：只有纪律缺口才 REPO 修正。
- **收工写回另立任务**：分析已识别为次缺口，本任务严守 scope。
