# Golden run — memory-writeback 收工写回(三类事实:状态/知识/决策)

> 端到端范例:一次会话收工,把 3 类持久事实按纪律写回 gbrain。真值来源:`references/writeback.md` 分类表 + `../jspace-use/references/gbrain.md` 写回纪律。gbrain 二进制当前不在本机 PATH,**输出为示意**(格式按命令契约构造,具体值随库)。

## 场景

本次会话为项目 `acme` 做了三件事:① 定了架构决策「存储层用 PGLite 不用 Postgres」;② 踩坑后提炼一条教训「迁移脚本必须幂等」;③ 推进了进展(schema 定稿,下一步接线)。收工把这三类事实各写到对应的页。

## 逐步

### 1. 扫描:本会话有无持久事实
- 决策:存储层定 PGLite(从「待定」→「已定」)→ **决策**
- 教训:迁移脚本要幂等(可复用要点)→ **知识**(晋升信号:已提炼成教训)
- 进展:schema 定稿 / 下一步接线 → **状态**

→ 有持久事实,继续。(若本会话只是一次性操作或闲聊 → **静默结束**:不写页、不提示。)

### 2. 分类 + 归属(决策表 + slug 派生)

| 事实 | 类别 | 目标 slug | 写语义 |
|---|---|---|---|
| 进展 / 下一步 | 状态 | `project/acme/state` | 固定 slug **覆盖** |
| 迁移幂等教训 | 知识 | `knowledge/acme/migration-idempotency` | **append-only 新页** |
| 存储层选型 | 决策 | `decision/acme-storage-choice` | 固定 slug 覆盖 |

- project id `acme` 从 `hub.json` + 域 README + 既有 state 页确认(**不臆造**)。
- 动手前先简述:将写什么 · 写哪 · 为何。

### 3. 写回 — 状态(固定 slug 覆盖)
state 页只承载「现状」;历史用 slug 指过去,**不压进 state**:
```markdown
---
type: note
source: claude
project: acme
tags: [progress, state]
---
# acme — 当前状态
## 进展 / 下一步
- schema 定稿(存储层 PGLite);下一步 CLI 与 schema 接线。
## 当前决策
- 存储层 PGLite(详见 `decision/acme-storage-choice`)。
```
```bash
gbrain put project/acme/state < state.md
```
预期(示意):`put: project/acme/state  (overwritten, type=note)`

### 4. 写回 — 知识(晋升:append-only 新页,不压 state)
教训是可复用要点 → **晋升**为新知识页,而非塞进 state:
```markdown
---
type: lesson
source: claude
project: acme
tags: [migration, idempotency, lesson]
---
# 迁移脚本必须幂等
重跑会重复插入 → 数据翻倍。写入前按幂等键 upsert/去重,重跑收敛同结果。
```
```bash
gbrain put knowledge/acme/migration-idempotency < lesson.md
```
预期(示意):`put: knowledge/acme/migration-idempotency  (created, type=lesson)`
- **绝不覆盖已有知识页**:新教训 = 新页;要更新「现状」只改 state 页。

### 5. 写回 — 决策(固定 slug 覆盖)
```markdown
---
type: decision
source: claude
project: acme
tags: [storage, decision]
---
# 存储层选型:PGLite
存储层用 PGLite,不用 Postgres。理由:本地零依赖、随工作台物化,规模可控。
```
```bash
gbrain put decision/acme-storage-choice < decision.md
```
预期(示意):`put: decision/acme-storage-choice  (overwritten, type=decision)`

### 6.(分支)gbrain serve 持锁 → 暂存,不硬失败
若 harness 的 `gbrain serve` 正持写锁,直接 `put` 冲突 → 改走暂存:
```bash
jspace pending stage project/acme/state --content state.md --producer memory-writeback
jspace pending apply     # 锁空闲后统一落 live(幂等)
```
预期(示意):`staged: project/acme/state` → 之后 `applied: 1 page`。

### 7. 验证读回
```bash
gbrain get project/acme/state                   # 覆盖:仍一页,现状最新
gbrain get knowledge/acme/migration-idempotency # 新页:教训独立成页
gbrain get decision/acme-storage-choice          # 决策:project/tags/source 齐
```
断言:state 未新增重复页;知识页独立、未覆盖旧知识;三页 frontmatter `project`+`tags`+`source` 齐。
- embedding 不可达 → 上述 put 仍成功,页头加 `embed_skip: true` + 固定提示「写入成功,embedding 不可用,检索降级」(不静默、不失败)。

## 断言清单(照此判"做完没")
- [ ] 无持久事实时:静默结束,未写任何页、未提示
- [ ] 状态写 `project/<id>/state` 固定 slug 覆盖,未新增重复页
- [ ] 知识/教训写 `knowledge/<项目|域>/<主题>` 新页,未覆盖旧知识页
- [ ] 决策写 `decision/<主题>` 覆盖;每页 `project`+`tags`+`source` 齐
- [ ] 晋升到位:教训在知识页,state 只留现状(历史未压进 state)
- [ ] serve 持锁时走 `jspace pending stage` → `apply`,未硬失败
