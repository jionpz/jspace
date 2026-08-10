---
name: weekly-report
description: "**周期性周报**:汇总本周各项目进展,产出 filehub markdown + gbrain 指针页。由 weekly-report cron 驱动(周日 21:00),也可会话内触发。Use when 生成周报/本周汇总/weekly report。Do NOT use for 归纳记忆事实(→memory-consolidate)、纪律自省(→workbench-retro)、单份资料入库(→asset-ingest)。"
triggers:
  - "生成周报"
  - "本周周报"
  - "本周汇总"
  - "weekly report"
---

# weekly-report — 本周项目周报(周期性产出)

把本周各项目的进展汇成**一份人读的周报**放进文件中心,并在 gbrain 留一个薄指针页。对应 GOAL「夜里 cron 生成本周项目周报存进文件中心」。

**事实以 memory-consolidate 页为准** —— 本 skill 不重新归纳事实,只做汇总排版 + 指针。两者同为周日 cron:weekly-report 21:00 在前(面向人),memory-consolidate 22:00 在后(面向机器);因此周报引用的是**上一轮**巩固页,这是设计如此,不是时序错误。

## 何时用 / 何时不用
- ✅ 用:cron 定时触发;会话内说「生成本周周报」。
- ❌ 不用:归纳/巩固记忆事实 → `memory-consolidate`;审计纪律与流程 → `workbench-retro`;单份资料入库 → `asset-ingest`;会话收工写回 → `memory-writeback`。

## 输出契约(自包含,勿改路径)

1. **markdown 本体** → `<filehub>/areas/周报/<YYYY-MM-DD>-周报.md`
   - `<YYYY-MM-DD>` = **本周起始日(周一)**,不是运行日。周日运行 → 用本周一的日期。
   - `<filehub>` = `.jspace/hub.json` 中 `type: filehub` 资源 `primary: true` path(经 `local.json` 绑定解析);解析不到 → 停止并报告,不猜路径。
2. **gbrain 指针页** → `assets/周报/<YYYY-MM-DD>`(同一日期)
   - frontmatter:`type: reference`、`project: jspace`、`tags: [weekly]`、`source: <harness>`
   - 正文以 **Pointer + 极薄 Summary** 为主;详细事实不在这里展开(在 md 本体与 consolidate 页里)。
3. **同周重跑 = 周快照**:固定 slug 覆盖更新,**不重复建页、不建 `-v2`**。

## 活跃项目发现(不臆造项目)

按顺序取并集,取不到就少写,不编:
1. `workspace/<domain>/README.md` 的「本域进行中的项目」表;
2. gbrain `project/<id>/state` 页(`gbrain list --type note`,看本周有更新的);
3. `<filehub>/projects/` 下本周有文件变动的目录。

## 命令速查

```bash
gbrain list --type note -n 50                    # state 页 → 活跃项目
gbrain get memory/consolidate/<最近一期>          # 事实来源(不重新归纳)
find <filehub>/projects -type f -mtime -7        # 本周资产变动
gbrain put assets/周报/<YYYY-MM-DD> < <正文文件>   # 指针页(同周覆盖)
gbrain get assets/周报/<YYYY-MM-DD>               # 验证读回
```

## 步骤

1. **定日期**:算本周一日期(周报文件名与 slug 都用它);解析 `<filehub>` 根。
2. **发现项目**:按上节三个来源取并集。
3. **取事实**:读最近一期 `memory/consolidate/<date>` 页 + 各 `project/<id>/state`;**不重新推断事实**。
4. **写本体**:`<filehub>/areas/周报/<日期>-周报.md`——每项目一节(本周进展 / 当前状态 / 下一步),末尾列关键文件指针。
5. **写指针页**:`assets/周报/<日期>`,Pointer 指向第 4 步的 md 绝对路径,Summary 三五行。
6. **验证**:`gbrain get` 读回;确认同周未产生第二个页/文件。

**无活跃项目时**:仍写一份「本周无活跃项目」的极短周报(保持周序列不断档),不静默跳过。

## 按需深入
- 写页 frontmatter / type 语义 / embedding 降级 → `~/.agents/skills/jspace-use/references/gbrain.md`
- filehub 归位与命名约定 → `~/.agents/skills/asset-ingest/references/filing.md`
- 事实归纳侧 → `~/.agents/skills/memory-consolidate/SKILL.md`

## 自检

```bash
ls <filehub>/areas/周报/<YYYY-MM-DD>-周报.md    # 本体在,日期=本周一
gbrain get assets/周报/<YYYY-MM-DD>             # 指针页在;Pointer 指向该 md
```
(同周重跑后文件数与页数**不增加** = 幂等成立)
