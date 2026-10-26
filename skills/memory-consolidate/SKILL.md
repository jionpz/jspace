---
name: memory-consolidate
description: "按工作台本地周窗口归纳 gbrain 原始事实,写一份同周幂等的机器快照并刷新涉项项目 state。Use when 记忆巩固/周快照/consolidate。Do NOT use for 单次收工写回(→memory-writeback)、人读周报(→weekly-report)或纪律自省(→workbench-retro)。"
triggers:
  - "记忆巩固"
  - "巩固记忆"
  - "周快照"
  - "consolidate"
---

# memory-consolidate - 周记忆巩固

把目标周内已经落库的事实归纳成一份机器可读快照,并只在有实质变化时刷新项目 state。它不制造新事实,不替用户做决策,也不修改规则或技能。

## 触发 / 非目标

- 用:cron 每周触发、补跑指定周、会话内请求“巩固记忆”。
- 不用:单次会话收工 → `memory-writeback`;人读周报 → `weekly-report`;纪律审计 → `workbench-retro`;资料入库 → `asset-ingest`。

## 输入与前置

- 工作台根和 `jspace` CLI。
- 周期参数统一由 `jspace memory period --json` 给出;补跑时给 `--week <Monday>`,需要固定取证时给 `--now <ISO-8601>`。
- 可完整分页读取 gbrain 的能力;不能证明覆盖完整时输出 `partial`。
- 已注册 filehub(若快照要包含资产证据);无法读取时明确未知。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 周期、页 envelope、来源和状态规则:`../jspace-use/references/gbrain.md`
- 写回分类与晋升纪律:`../memory-writeback/references/writeback.md`
- 人读汇总边界:`../weekly-report/SKILL.md`

## 写集

- `records/consolidate/<Monday>`:本周机器快照,创建或 CAS 覆盖。
- `project/<id>/state`:仅对本周有实质变化的项目做 CAS 覆盖。
- 不写:周报文件、retro 页、decision/lesson/knowledge 的晋升正文、规则、skills、cron 配置。

## 输出

```yaml
snapshot_slug: records/consolidate/<Monday>
week_start: <period.week_start>
window: "[<window_start>, <window_end_exclusive>)"
observed_through: <ISO-8601 with offset>
period_status: complete | in_progress
coverage: complete | partial | unknown
projects_updated: []
promotion_candidates: []
decay_candidates: []
gaps: []
```

## 主流程

1. **定周期**:先运行 `jspace memory period --json`。slug 只用 `week_start`,窗口与截止时刻只消费输出;`period.status=in_progress` 时只能描述截至 `observed_through` 的内容。
2. **盘点**:用 `list_pages` keyset 分页读取目标窗口内更新或创建的页,至少覆盖 state、decisions、lessons、knowledge、assets、records 和同周 consolidate。达到预算或游标异常时停止并标记 `partial`。
3. **逐页取证**:列表行不能替代页正文;对候选逐个 `get_page(include_content:true)`,按项目/领域归组。
4. **归纳**:只写可由页或原件支持的事实,附 slug/文件指针。不得把上一周快照、上一轮 retro 或 agent 推断当成本周事实。
5. **处理候选**:晋升候选必须写明“第二项目已实际复用”的证据;没有证据只列为需要核实,不自动写 knowledge。衰减候选同样只提议。
6. **写快照**:若同周页存在,读取完整正文和 revision,CAS 覆盖同一 slug;不存在则创建。创建/覆盖后都读回；tags 是合并语义，若同时出现两个来源 tag，用 `remove_tag` CAS 清理后再次读回。
7. **刷新 state**:只更新有实质变化的项目;读取旧 state,保留三段认知卡,历史信息先落到 decision/record,再 CAS 覆盖。
8. **空周处理**:没有新事实时不建空页,报告“本周无新事实”;若已有同周页,也不制造空覆盖。

## 完成证据

- `records/consolidate/<Monday>` 可读回,tags 含 `consolidate`、`weekly` 和恰好一个来源 tag;
- frontmatter `project: jspace`,正文含窗口和 `observed_through`;
- 同一周只有这一页 consolidate;
- 每个涉项 state 的更新都有读回 revision,无实质变化项目未被无意义覆盖;
- gbrain 覆盖完整时 `coverage=complete`,否则为 `partial`/`unknown` 并列出缺口。

## 失败与恢复

- 列表分页/页读取失败:已有事实可写入,但状态必须为 `partial`,不得宣称整周全量。
- 同周 CAS 冲突:重读合并;不得覆盖他人更新。
- gbrain 锁或响应丢失:用 `jspace pending stage` 的 `create/replace` intent 和真实 origin 暂存;应用并读回前不完成。
- embedding 不可达:页加 `embed_skip: true` 并提示检索降级,不影响提交证据。
- 目标周已有错误的执行日期页:报告历史映射需求,不创建第二套双轨;迁移由显式维护处理。

## 转交

- 人读汇总 → `weekly-report`
- 纪律与流程审计 → `workbench-retro`
- 新决策/教训尚未落库 → `memory-writeback`
- 资产本体或指针 → `asset-ingest`

## 自检

```bash
PERIOD="$(jspace memory period --json)"
MONDAY="$(printf '%s' "$PERIOD" | jq -r '.week_start')"
gbrain call get_page "{\"slug\":\"records/consolidate/$MONDAY\",\"include_content\":true}"
jspace memory check --json
```

拿执行当天代替目标周、使用上一轮快照或空页填补缺失数据,均视为不合格。
