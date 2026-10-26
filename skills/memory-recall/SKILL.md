---
name: memory-recall
description: "读侧精准召回:用户问一句、找文件或核实某个数时,从 gbrain 指针和 filehub 原件返回有出处、可复检的答案。Use when 问一句/找那个文件/精准召回。Do NOT use for 资料入库(→asset-ingest)、会话写回(→memory-writeback)或周期归纳(→memory-consolidate)。"
triggers:
  - "找那个文件"
  - "查记忆"
  - "记忆里有没有"
  - "精准召回"
  - "recall"
  - "find the file"
---

# memory-recall - 精准召回(读侧)

把问题还原成“来源页 + 文件原件 + 可复检证据”。本 skill 只读;发现记忆或指针缺口时报告并转交写侧,不顺手修库。

## 触发 / 非目标

- 用:回答用户的历史问题、找文件、核对数字、定位决策依据。
- 不用:资料本体入库 → `asset-ingest`;会话事实写回 → `memory-writeback`;周快照 → `memory-consolidate`。
- 快照、周报和 retro 是投影,不是当前事实的最终权威;必须回到源页或原件。

## 输入与前置

- 用户问题、时间语境(如“上周”“当时”)和期望粒度。
- 工作台根、已注册 filehub 根(可从 `.jspace/hub.json` + `local.json` 解析)以及可用的 gbrain。
- 检索前确认 embedding 可达性;不可达时允许关键词降级,但必须在答案中明确提示。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 记忆角色、生命周期、`Supersedes`、`rel_path` 与来源语义:`../jspace-use/references/gbrain.md`
- 断言链、变体查询、终止条件和换机解析:`references/discipline.md`
- 回归验收和真实第二机协议:`references/memory-acceptance.md`、`references/real-second-machine-protocol.md`
- 端到端示例:`references/example-recall.md`

## 写集

- 只读:gbrain 页、索引、filehub 文件。
- 不写:任何 gbrain 页、pending、journal、索引或文件。
- 若发现缺页、取代链断裂、`rel_path` 缺失或文件丢失,输出缺口和修复去向,由对应写侧处理。

## 输出

答案必须包含:

| 字段 | 内容 |
|---|---|
| 结论 | 用户要的事实或明确“不确定” |
| 时间范围 | 当前事实 / 指定历史时点 |
| gbrain 来源 | canonical slug;若经快照路由,同时列出快照 slug |
| 文件来源 | filehub 绝对路径(如适用)和 `rel_path` |
| 证据 | 读到该事实的页/文件字段或片段 |
| 覆盖状态 | complete / partial / conflict,含缺失证据 |

## 主流程

1. **理解问题**:确定实体、时间范围、要找的是决策、知识还是资产原件。
2. **检索**:优先 `gbrain query`;embedding 不可达时用 `gbrain search`,并记录固定降级提示。
3. **排除投影**:命中 `records/consolidate/*`、`records/retro/*` 或 `assets/周报/*` 时,先读其来源指针,再回到窗口内原始页或项目 state;投影不能直接充当答案。
4. **校验现行性**:逐页检查 tags。
   - `status:superseded`:从旧页调用 `gbrain call get_backlinks`,分页读完;逐个 `get_page` 候选,只接受正文明确含 `Supersedes: [[<旧页>]]` 且生命周期仍现行的页。零/多候选、缺页、环或 coverage degraded 返回 `partial/conflict`。
   - `status:deprecated` / `status:archived`:只在用户明确问历史时引用。
   - `status:provisional`:可回答,但必须标注未充分验证。
5. **核对资产**:资产问题读取 asset 页的 `rel_path`,用本机 filehub 根解析路径;确认普通文件存在且非符号链接逃逸,再打开原件命中事实。必要时核对 `Pointer` 仅作本机提示。
6. **防假阳性**:存疑时做同义变体查询和负对照;最多 3 轮,不能把“没有更好候选”写成确定。
7. **作答**:给出结论、绝对路径、slug、时间范围和覆盖状态。纯知识问题可没有文件路径,但必须有页 slug 和正文证据。

### 检索命令

```bash
gbrain models doctor --json
gbrain query "<问题>"
gbrain search "<关键词>"   # embedding 不可达时的显式降级
gbrain call get_page '{"slug":"<slug>","include_content":true}'
gbrain call get_backlinks '{"slug":"<old-slug>","group":"page","limit":100}'
```

`get_backlinks` 返回 `truncated: true` 时必须继续传 `cursor`;覆盖率不是 complete/degraded=false 时不得宣称链完整。

## 完成证据

同时满足才算命中:

- 命中的 canonical slug 可 `get_page(include_content:true)` 读回;
- 生命周期与时间范围匹配;
- 资产型答案的 `rel_path` 能解析到真实普通文件,并读到对应事实;
- 变体/负对照(若执行)没有推翻结论;
- 答案中的 slug、路径和证据一致。

## 失败与恢复

- 无命中:区分 slug/命名、tags、embedding、措辞、索引缺失和数据确实不存在;记录诊断并降级或转交。
- 旧页有取代标记:先走 backlinks 反向查找;找不到唯一现行页时回答“不确定”,不得按 `updated_at` 猜最新页。
- `rel_path` 缺失或文件丢失:报告 `partial`,转 `asset-ingest` / `memory-writeback` 修复指针;不在读侧创建页。
- coverage degraded、cursor 无法继续、分页预算耗尽:报 `partial`,列明还缺哪一页或哪一段。
- gbrain 暂时不可用:可基于已确认的项目文件和规范作答,但必须标明未验证记忆来源。

## 转交

- 资料尚未入库或指针损坏 → `asset-ingest`
- 结论来自本次会话,尚未落库 → `memory-writeback`
- 周期归纳或周报需求 → `memory-consolidate` / `weekly-report`
- gbrain 安装、embedding 或工作台接线问题 → `jspace-use`

## 自检

```bash
gbrain call get_page '{"slug":"<slug>","include_content":true}'
test -f "<resolved-file>"       # 资产型答案
gbrain call list_pages '{"tag":"<route-tag>","limit":20,"sort":"updated_asc"}'
```

答案没有 slug、路径(如适用)、时间范围或覆盖状态,视为本次召回未完成。
