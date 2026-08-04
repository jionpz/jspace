---
name: memory-writeback
description: "会话结束收工时,把本次持久事实按纪律写回 gbrain:扫描 → 分类(状态/知识/周快照) → 归属(project+slug) → 写回(state 固定 slug 覆盖 / 知识 append-only 新页 / 晋升) → 验证读回。纪律源 = skills/jspace-bootstrap/references/gbrain.md;是 harness 会话结束 hook 的可执行体。与 asset-ingest(资产写侧)、memory-recall(读侧)、memory-consolidate(周快照)分工不重叠。Use when the user ends a work session, says 收工/写回记忆/记一下本次进展, or a session-end hook fires."
triggers:
  - "收工"
  - "写回记忆"
  - "记一下本次进展"
  - "本次进展"
  - "end of work"
  - "session end"
  - "writeback"
---

# memory-writeback — 收工记忆写回（写侧·会话事实）

会话结束时,把本次**持久事实**按纪律写回 gbrain(对应 GOAL「收工」场景)。**无持久事实 → 静默结束**(对齐 End-of-Work Capture)。

**分工**:asset-ingest = 资产写侧(reference 页);本 skill = 会话事实写侧(state 页 / 知识页 / 晋升);memory-recall = 读侧;memory-consolidate = 周快照。不重叠。

## 前置

- 定位 gbrain:`$GBRAIN_BIN` → `which gbrain` → `~/.bun/bin/gbrain`。
- 活跃项目发现:`hub.json` resources + 各域 README + 既有 `project/<id>/state` 页(只读)。
- 纪律细则见 `references/writeback.md`(引用 gbrain.md,不复制)。

## 步骤

### 1. 扫描

会话内是否有持久事实:进展 / 决策 / 教训 / 资产指针 / 规则 / 可复用工作流。
- **无 → 静默结束**:不写页、不提示。
- 有 → 继续;向用户简述将写什么、写哪、为何(对齐 End-of-Work Capture)。

### 2. 分类

- **状态记忆**(progress/todo/当前决策)→ `project/<id>/state` 固定 slug **覆盖**。
- **持久知识**(教训/可复用要点)→ 新页 **append-only**。
- **决策** → `decision/<topic>`(近况覆盖 / 历史新页)。
- **周快照** → 转 memory-consolidate,**本 skill 不写**。

### 3. 归属

- 定位 domain/project id(活跃项目发现);实体 slug 从项目 + 主题派生,不发明。

### 4. 写回

- 按分类表写语义;**晋升**:记忆事实变持久(跨会话重复/决策已定/提炼成教训)→ 写新知识页,state 页保持「现状」。
- 每页带 `project` + `tags` + `source`(harness 出处)。
- **serve 持锁 / 写失败** → `jspace pending stage <slug> --content <正文文件> --producer memory-writeback`(暂存 envelope,不失败;锁空闲 `jspace pending apply` 落 live)。
- embedding 不可达 → 写仍成功(`embed_skip: true`),提示「写入成功,embedding 不可用,检索降级」(不得静默、不得失败)。

### 5. 验证

- `gbrain get <slug>` 读回;确认 project/tags/source 齐全;state 覆盖不新增、知识不重复。

### 6. 文件归位(转引用)

- 有产出文件要归位 → 转 asset-ingest(其步骤 2-4),本 skill 不重复文件移动。

## 纪律

- **state 覆盖,知识追加**:状态写固定 slug,知识写新页;绝不覆盖知识页。
- **晋升不压 state**:记忆变持久 → 写新知识页,state 只承载现状。
- **无持久 → 静默**:不提检查、不写页。
- **不发明 slug**:从项目/主题派生;归属要准,防串页。
- **降级不静默**:embedding 不可达固定提示,写不失败。

## 参考

- `references/writeback.md` — 写回纪律细则(分类表 / slug / 晋升信号 / 降级)。
- `skills/jspace-bootstrap/references/gbrain.md` — 纪律源(引用)。
- `skills/asset-ingest/SKILL.md` — 文件归位(转引用)。
