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

**分工**:asset-ingest = 资产写侧(asset 指针页);本 skill = 会话事实写侧(state/决策/经验/跨项目知识);memory-recall = 读侧;memory-consolidate = 周快照(cron,本 skill 不写)。

## 何时用 / 何时不用
- ✅ 用:收工时把进展/决策/教训/规则写回 gbrain。
- ❌ 不用:文件本体归位 → `asset-ingest`(本 skill 有产出文件时转它,不重复文件移动);读侧召回 → `memory-recall`;周快照 → memory-consolidate cron 任务。

## 决策表

| 事实类别 | 目标 slug | 写语义 |
|---|---|---|
| 状态记忆(进展/待办/当前决策) | `project/<id>/state` | 固定 slug **覆盖**,`tags: [project]` |
| 项目决策(决定+理由) | `project/<id>/decisions/<主题>` | **append-only 新页**(绝不覆盖) |
| 项目专属经验(踩坑/可复用要点) | `project/<id>/lessons/<主题>` | **append-only 新页**(绝不覆盖) |
| 跨项目可复用认识 | `knowledge/<域>/<主题>` | **append-only 新页**(绝不覆盖),域=通用知识域(不含项目名) |
| 周快照 | — | **转 memory-consolidate**,本 skill 不写 |

| 判断 | 取值 | 动作 |
|---|---|---|
| 有无持久事实 | 无 / 有 | **静默结束** / 简述将写什么·写哪·为何,再写 |
| 来源 tag | 恒定 | 每页 `tags` 追加 **`source:session`**(写回率取证;frontmatter `source:` 仍是 harness 出处,不挪用) |
| 晋升信号(跨会话重复/决策已定/提炼成教训) | 命中 | 写 `project/<id>/decisions/` 或 `project/<id>/lessons/` 新页,state 只留现状(不压 state) |
| serve 持锁 / 写失败 | 是 / 否 | `jspace pending stage`(暂存不失败) / 直接写 |
| embedding 不可达 | 是 / 否 | `embed_skip: true`(写仍成功)+固定提示 / 正常写 |

## 命令速查

```bash
gbrain put project/<id>/state < <正文文件>                # 状态:固定 slug 覆盖
gbrain put project/<id>/decisions/<主题> < <文件>         # 项目决策:append-only
gbrain put project/<id>/lessons/<主题> < <文件>           # 项目经验:append-only
gbrain put knowledge/<域>/<主题> < <文件>                 # 跨项目知识:append-only
gbrain get <slug>                                # 验证读回
jspace pending stage <slug> --content <正文文件> --producer memory-writeback
jspace pending apply                             # 锁空闲落 live(幂等)
```

## 步骤(主流程骨架)

1. **扫描**:本会话有无持久事实(进展/决策/教训/资产指针/规则/工作流)。**无 → 静默结束**。
2. **分类**:按决策表(状态/知识/决策/周快照)。
3. **归属**:定 domain/project id(活跃项目发现:`hub.json`+域 README+既有 state 页);slug 从项目+主题派生,**不发明**。
4. **写回**:按分类写语义;晋升 → 新知识页;每页带 `project`+`tags`(路由 tag + **`source:session`**)+`source`;锁冲突 `jspace pending stage`。
5. **验证**:`gbrain get <slug>` 读回;state 覆盖不新增、知识不重复;`gbrain list --type note --tag source:session -n 5` 应能列到刚写的页。
6. **文件归位**(有产出文件)→ 转 `asset-ingest` 步骤 2-4,本 skill 不重复。

## 按需深入(条件读指针)

- 分类表/slug 派生/晋升信号/降级细则 → `~/.agents/skills/memory-writeback/references/writeback.md`
- state 覆盖 vs 知识追加 / 晋升 纪律源 → `~/.agents/skills/jspace-use/references/gbrain.md`
- 文件归位(转引用)→ `~/.agents/skills/asset-ingest/SKILL.md`

## Golden run

端到端范例(扫描 → 分类 → 写回 → 读回验证)见 `~/.agents/skills/memory-writeback/references/example-writeback.md`。

## 自检(做完跑这条)

```bash
gbrain get <slug>          # project/tags/source 齐;state 覆盖未新增、知识未重复
gbrain list --type note --tag source:session -n 5   # 来源 tag 生效(写回率取证的基础)
```
(无持久事实时本 skill 应静默结束,不写页、不提示)

> **提醒 ≠ 写入**:`jspace context session-end` 与 `jspace context turn` 的每会话一次轻提示都只提醒、从不写 gbrain,也不打 `source:session`。所以「本周 `source:session` 计数」量的是**真的写回了几次**,不是被提醒了几次。各 harness 的 session-end 能力边界见 `~/.agents/skills/jspace-use/references/harnesses.md`。

## 参考
- `~/.agents/skills/memory-writeback/references/writeback.md` — 分类表/slug/晋升信号/降级
- `~/.agents/skills/jspace-use/references/gbrain.md` — 纪律源(state 覆盖 vs 知识追加/晋升)
- `~/.agents/skills/memory-writeback/references/example-writeback.md` — golden run(S5 产出)
- `~/.agents/skills/asset-ingest/SKILL.md` — 文件归位(转引用)
