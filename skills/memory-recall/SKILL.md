---
name: memory-recall
description: "读侧精准召回：用户「问一句」时，把问题召回为有出处的答案——语义查询 → top-1 校验 → 指针断言链 → 打开文件引用出处；未命中走有终止的校准（≤3 轮）与不静默的 embedding 降级提示。纪律源 = docs/MEMORY-ACCEPTANCE.md（本 skill 引用协议，不复制）。与 asset-ingest（写侧：入库 + 自检）互补。Use when the user asks a question that needs recall from the file hub / gbrain: 问一句、找那个文件、那个数、精准召回、recall、find the file."
triggers:
  - "问一句"
  - "找那个文件"
  - "那个数"
  - "精准召回"
  - "recall"
  - "find the file"
  - "帮我找"
---

# memory-recall — 精准召回（读侧）

把用户的问题召回为「**有出处**的答案」：语义查询 → 校验 → **指针断言链** → 打开文件引用出处。对应 GOAL 场景「随口一问，找到那个文件里的那个数」。

**分工**：asset-ingest 是**写侧**（资料入库 + 归位后召回自检）；本 skill 是**读侧**（用户主动召回）。两者共用同一份 embedding/降级纪律。

## 前置

- **定位 gbrain**：`$GBRAIN_BIN` → `which gbrain` → `~/.bun/bin/gbrain`。
- **定位 filehub**：`.jspace/hub.json` 中 `type: filehub` resource 的 `primary: true` path（指针断言 ②/③ 需要文件本体）。
- **embedding 可达性**：`gbrain models doctor --json` 确认 `embedding_reachability`（仅需确认，不阻塞查询）。

## 步骤

### 1. 语义查询

- `gbrain query "<问题>"`（中文优先）。
- **embedding 不可达** → 用 `gbrain search` 关键词降级，并固定提示「embedding 不可用，当前为关键词检索，中文命中率可能偏低」（**不得静默**）。

### 2. 校验（防假阳性）

- 确认 top-1 命中候选页。
- 代价低时做**变体查询**（换个说法、语义同）：候选页应保持 top-1，无关页不得反超。

### 3. 指针断言链（四连过才算命中）

1. `gbrain get <slug>` → 取 Pointer 字段；
2. `test -f "<Pointer>"` 成立；
3. 打开 / `grep <关键词>` 文件正文**找到那个数**；
4. 用候选页内容作答。

### 4. 作答并引用出处

- 答案 + 文件**绝对路径** + gbrain slug（可点开、可复检）。

### 5. 未命中 → 有终止校准

- **诊断类别**：slug / tags / embedding 配置 / 查询措辞 / 纪律缺口。
- **仅纪律缺口**才 REPO 修正并刷 JWorkspace；配置/措辞类只记录（ROI 护栏）。
- **重跑 ≤3 轮**或显式终态（接受关键词降级记入验收文档 / 上报用户）。

## 纪律

- **引用出处**：答案必须带文件路径 + slug，不得只给「页里有」。
- **降级不静默**：embedding 不可达时固定提示。
- **校准有终止**：≤3 轮 + ROI 护栏（配置/措辞类不轻易改纪律）。
- **canonical 面**：默认 CLI（serve 停泊窗口内）；真实使用面（MCP）query 冒烟对齐。
- **回归**：可复跑验收见 `docs/MEMORY-ACCEPTANCE.md`（本 skill 引用协议，不复制全文）。

## 参考

- `references/discipline.md` — 召回纪律细则（断言链 / 变体负对照 / 诊断终止 / 降级提示 / 面约束）。
- `docs/MEMORY-ACCEPTANCE.md` — 可复跑验收协议（基线结果：2026-08-03 通过）。
- `skills/asset-ingest/references/gbrain-write.md` — 写侧纪律（embedding 降级 / type 纪律，读侧触发时参考）。
