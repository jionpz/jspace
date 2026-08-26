---
name: memory-consolidate
description: "**周期性记忆巩固**:归纳近一周 gbrain 事实成周快照页,并回写各项目 state。由 memory-consolidate cron 驱动(周日 22:00),也可会话内触发。Use when 记忆巩固/巩固记忆/周快照/consolidate。Do NOT use for 单次收工写回(→memory-writeback)、人读周报(→weekly-report)、纪律自省(→workbench-retro)。"
triggers:
  - "记忆巩固"
  - "巩固记忆"
  - "周快照"
  - "consolidate"
---

# memory-consolidate — 周记忆巩固(周期性写侧)

把近一周散落的 gbrain 事实**归纳成一页周快照**,并把每个涉项项目的「当前状态」刷新到其 state 页。对应 GOAL「夜里 cron 把摘要写进 gbrain」。

**分工**:`memory-writeback` = 单次会话收工写回(事件驱动);本 skill = 周期性归纳(时间驱动);`weekly-report` = 面向人的汇总(读本 skill 的产出);`workbench-retro` = 审计纪律与流程(读本 skill 的产出做交叉信号)。writeback 的纪律里明写「周快照转本 skill」,本 skill 是那条转出的落点。

## 何时用 / 何时不用
- ✅ 用:cron 定时触发;会话内说「巩固一下记忆」。
- ❌ 不用:本次会话的进展/决策 → `memory-writeback`(单次写回);生成人读周报 → `weekly-report`;审计纪律 → `workbench-retro`;资料入库 → `asset-ingest`。

## 输出契约(自包含,勿改路径)

1. **周快照页** → gbrain note 页 `records/consolidate/<YYYY-MM-DD>`
   - **dated memory record**(gbrain.md 授权的固定-slug 例外):每周**新页**,不是覆盖某个固定 slug。
   - frontmatter:`type: note`、`project: jspace`、`tags: [consolidate, weekly, <来源 tag>]`、`source: <harness>`
   - **来源 tag 按运行模式选**:无头(cron)运行 → `source:cron`;会话内触发 → `source:session`。state 回写(契约 2)同样带这条 tag。它是 `workbench-retro` 检查 1 量化写回率的取证基础,纪律源见 `~/.agents/skills/jspace-use/references/gbrain.md`「Provenance tag」。
   - 正文:按域/项目归纳近一周关键事实 + 指针。
2. **state 回写** → 对每个涉项项目 `project/<id>/state`(**固定 slug 覆盖**,更新当前状态)。
3. **同周幂等**:同一周内重跑覆盖**同一页**,绝不新建第二页。

### 日期取法(重跑幂等的关键)

`<YYYY-MM-DD>` = **运行日**(与既有页 `records/consolidate/2026-08-03` / `2026-08-09` 一致)。但运行日命名与「同周覆盖」天然冲突——周日跑完、周二再跑会算出不同日期。所以**重跑前必须先查当周是否已有页**:

```bash
gbrain list --type note -n 30 | grep 'records/consolidate/'   # 找本周(周一~周日)内的已有页
```
- 本周已有 → **覆盖那一页的 slug**(不用今天的日期)。
- 本周没有 → 用运行日建页。

## 命令速查

```bash
gbrain list -n 50                                    # 近一周页面盘点
gbrain list --type note -n 30                        # state 页 + 既有 consolidate 页
gbrain get project/<id>/state                        # 读当前状态(回写前)
gbrain put records/consolidate/<日期> < <正文文件>      # 周快照(同周复用同 slug)
gbrain put project/<id>/state < <正文文件>            # state 覆盖
gbrain get records/consolidate/<日期>                  # 验证读回
```

## 步骤

1. **定期页**:算本周区间(周一~周日);按上节规则确定要写的 slug(复用当周已有页 or 运行日新建)。
2. **盘点**:列近一周有更新的页(state / reference / decision / lesson),按域与项目归组。
3. **归纳**:每组写「本周关键事实 + 指针」;**只归纳已写下的事实**,不推断、不补想象中的进展。
4. **写快照页**:按契约 1 写入。
5. **回写 state**:对每个涉项项目,把「当前状态」刷到 `project/<id>/state`(固定 slug 覆盖);无实质变化的项目**跳过**,不做无意义覆盖。
6. **验证**:`gbrain get` 读回快照页;确认本周页数未增加第二个。

**近一周无任何新事实时**:不建空页,报告「本周无新事实,跳过」——空快照页会污染 recent-injection。

## 与 embedding / 锁的降级

- embedding 不可达 → `embed_skip: true` 写入仍成功 + 固定提示,不失败。
- `gbrain serve` 持锁 → `jspace pending stage <slug> --content <文件> --producer memory-consolidate`,锁空闲后 `jspace pending apply`(幂等)。

## 按需深入
- dated memory record 纪律 / state 覆盖 vs 知识追加 / 晋升 → `~/.agents/skills/jspace-use/references/gbrain.md`
- 单次写回的分类表与 slug 派生 → `~/.agents/skills/memory-writeback/references/writeback.md`
- 人读周报侧 → `~/.agents/skills/weekly-report/SKILL.md`

## 自检

```bash
gbrain get records/consolidate/<日期>                          # 页在;tags 含 consolidate+weekly+来源 tag
gbrain list --type note -n 30 | grep -c 'records/consolidate'  # 本周只有一页
gbrain get project/<id>/state                                 # 涉项项目状态已刷新
```
