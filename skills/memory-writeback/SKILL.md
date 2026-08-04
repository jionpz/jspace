---
name: memory-writeback
description: "**会话结束收工**时把本次持久事实按纪律写回 gbrain:扫描 → 分类(状态/知识/周快照) → 归属(project+slug) → 写回 → 验证读回。Use when 收工/写回记忆/记一下本次进展/session end/writeback。Do NOT use for 资料文件入库(→asset-ingest)、用户问句召回(→memory-recall)、周快照(→memory-consolidate cron)。"
triggers:
  - "收工"
  - "写回记忆"
  - "记一下本次进展"
  - "本次进展"
  - "end of work"
  - "session end"
  - "writeback"
---

# memory-writeback — 收工记忆写回(写侧·会话事实)

会话结束时把本次**持久事实**按纪律写回 gbrain(对应 GOAL「收工」)。**无持久事实 → 静默结束**(对齐 End-of-Work Capture)。

**分工**:asset-ingest = 资产写侧(reference 页);本 skill = 会话事实写侧(state/知识/晋升);memory-recall = 读侧;memory-consolidate = 周快照(cron,本 skill 不写)。

## 何时用 / 何时不用
- ✅ 用:收工时把进展/决策/教训/规则写回 gbrain。
- ❌ 不用:文件本体归位 → `asset-ingest`(本 skill 有产出文件时转它,不重复文件移动);读侧召回 → `memory-recall`;周快照 → memory-consolidate cron 任务。

## 决策表

| 事实类别 | 目标 slug | 写语义 |
|---|---|---|
| 状态记忆(进展/待办/当前决策) | `project/<id>/state` | 固定 slug **覆盖** |
| 持久知识(教训/可复用要点) | `knowledge/<项目\|域>/<主题>` | **append-only 新页**(绝不覆盖) |
| 决策·近况 / 历史 | `decision/<主题>` / `decision/<主题>-<日期>` | 覆盖 / 新页 |
| 周快照 | — | **转 memory-consolidate**,本 skill 不写 |

| 判断 | 取值 | 动作 |
|---|---|---|
| 有无持久事实 | 无 / 有 | **静默结束** / 简述将写什么·写哪·为何,再写 |
| 晋升信号(跨会话重复/决策已定/提炼成教训) | 命中 | 写新知识页,state 只留现状(不压 state) |
| serve 持锁 / 写失败 | 是 / 否 | `jspace pending stage`(暂存不失败) / 直接写 |
| embedding 不可达 | 是 / 否 | `embed_skip: true`(写仍成功)+固定提示 / 正常写 |

## 命令速查

```bash
gbrain put project/<id>/state < <正文文件>      # 状态:固定 slug 覆盖
gbrain put knowledge/<项目|域>/<主题> < <文件>   # 知识:新页 append-only
gbrain get <slug>                                # 验证读回
jspace pending stage <slug> --content <正文文件> --producer memory-writeback
jspace pending apply                             # 锁空闲落 live(幂等)
```

## 步骤(主流程骨架)

1. **扫描**:本会话有无持久事实(进展/决策/教训/资产指针/规则/工作流)。**无 → 静默结束**。
2. **分类**:按决策表(状态/知识/决策/周快照)。
3. **归属**:定 domain/project id(活跃项目发现:`hub.json`+域 README+既有 state 页);slug 从项目+主题派生,**不发明**。
4. **写回**:按分类写语义;晋升 → 新知识页;每页带 `project`+`tags`+`source`;锁冲突 `jspace pending stage`。
5. **验证**:`gbrain get <slug>` 读回;state 覆盖不新增、知识不重复。
6. **文件归位**(有产出文件)→ 转 `asset-ingest` 步骤 2-4,本 skill 不重复。

## 按需深入(条件读指针)

- 分类表/slug 派生/晋升信号/降级细则 → `references/writeback.md`
- state 覆盖 vs 知识追加 / 晋升 纪律源 → `skills/jspace-bootstrap/references/gbrain.md`
- 文件归位(转引用)→ `skills/asset-ingest/SKILL.md`

## Golden run

端到端范例(扫描 → 分类 → 写回 → 读回验证)见 `references/example-writeback.md`。

## 自检(做完跑这条)

```bash
gbrain get <slug>          # project/tags/source 齐;state 覆盖未新增、知识未重复
```
(无持久事实时本 skill 应静默结束,不写页、不提示)

## 参考
- `references/writeback.md` — 分类表/slug/晋升信号/降级
- `skills/jspace-bootstrap/references/gbrain.md` — 纪律源(state 覆盖 vs 知识追加/晋升)
- `references/example-writeback.md` — golden run(S5 产出)
- `skills/asset-ingest/SKILL.md` — 文件归位(转引用)
