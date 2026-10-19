---
name: weekly-report
description: "按工作台本地周窗口汇总本期原始事实,生成人读周报文件与 gbrain 指针页。Use when 生成周报/本周汇总/weekly report。Do NOT use for 机器周快照(→memory-consolidate)、纪律自省(→workbench-retro)、资料入库(→asset-ingest)或会话收工(→memory-writeback)。"
triggers:
  - "生成周报"
  - "本周周报"
  - "本周汇总"
  - "weekly report"
---

# weekly-report - 本期项目周报

面向人阅读的周报。事实来自目标窗口内的原始页、项目 state 和资产证据;同窗口 consolidate 只是可选索引。

## 触发 / 非目标

- 用:cron 每周生成、会话内生成或补跑指定周。
- 不用:机器归纳 → `memory-consolidate`;纪律审计 → `workbench-retro`;单份资料入库 → `asset-ingest`。

## 输入与前置

- 工作台根、可解析的 filehub 根、`jspace` CLI。
- 周期参数统一由 `jspace memory period --json` 给出;补跑时给 `--week <Monday>`,需要固定取证时给 `--now <ISO-8601>`。
- 可读取项目 state、原始事实页和资产证据;无法完整读取时输出 `partial`。

## 权威引用

- 周期、来源 tag、asset `rel_path` 和完成证据:`~/.agents/skills/jspace-use/references/gbrain.md`
- 项目发现、文件命名和布局:`~/.agents/skills/asset-ingest/references/filing.md`
- 机器快照边界:`~/.agents/skills/memory-consolidate/SKILL.md`

## 写集

- `<filehub>/areas/周报/<Monday>-周报.md`:人读周报正文。
- `assets/周报/<Monday>`:指向该文件的 asset 指针页。
- 不写:项目 state、consolidate 页、retro 页、规则、skills 或 cron 配置。

## 输出

| 字段 | 内容 |
|---|---|
| 周期 | `week_start` |
| 文件 | `<filehub>/areas/周报/<Monday>-周报.md` |
| 指针 | `assets/周报/<Monday>` |
| 窗口 | `[window_start, window_end_exclusive)` |
| cutoff | `observed_through` |
| 周期状态 | `period.status` = complete / in_progress |
| 取证覆盖 | complete / partial / unknown |
| 来源 | 原始页 slug、项目 state、资产路径 |
| 缺口 | 无法确认的项目/事实 |

## 主流程

1. **定周期**:先运行 `jspace memory period --json`。文件名和 slug 只用 `week_start`;窗口、时区和截止时刻只消费命令输出。`period.status=in_progress` 时明确“截至 observed_through”,不冒充整周。
2. **发现项目**:合并域 README、registry、`project/<id>/state` 和本周资产证据;发现不了就少写,不臆造。
3. **收集本期事实**:读取目标窗口内的原始页和项目 state。不得把上一周期周报改标题、把上一轮 consolidate 当成本期权威,或在缺输入时复制旧内容。
4. **使用可选索引**:同窗口 consolidate 只能用于定位其明确引用的源页;源页不可读时标 `partial`。
5. **生成正文**:每项目写“本期进展 / 当前状态 / 下一步”,末尾列关键文件和 slug。事实不足时明确标记未知。
6. **写文件**:目标存在时先确认是同一周生成物并保留恢复副本,再原子更新;若发现用户改写的非同源内容,报告 conflict,不覆盖。
7. **写指针**:按 asset 页契约写 `rel_path`、Pointer、Summary、tags;已有同周页则读取 revision 后 CAS 覆盖。
8. **核对**:读取文件、指针页和索引;若 `put_page` 合并了旧的另一来源 tag,用 `remove_tag` CAS 清理并再次读回;`jspace filehub check --json` 对本资产无新增 error/unknown。

## 完成证据

- 周报文件名与周期 id 同为目标周一;
- 文件存在且正文可打开,内容明确窗口与 `observed_through`;
- `assets/周报/<Monday>` 可读回,`rel_path` 与文件一致,Pointer 指向同一文件;
- tags 含 `asset`、`weekly`,且恰好一个来源 tag;
- 同周重跑不增加第二个文件或页;
- 来源页可追溯;不完整覆盖明确写 `partial`。

## 失败与恢复

- filehub 未注册或无法解析:停止写入并报告,不猜路径。
- 原始事实不足:生成最小可信周报并标 `partial`,不拿旧快照补足。
- 文件写入失败:保留指针缺失状态,下一轮从第 6 步重试;不得只写 gbrain 指针。
- gbrain 写入失败:保留周报文件,使用 pending `create/replace` 暂存并读回后再完成。
- 同周已有用户改写:保留双方,报告 conflict,由用户确认是否合并。
- embedding 不可达:页内 `embed_skip: true` 并提示检索降级。

## 转交

- 需要机器归纳 → `memory-consolidate`
- 需要纪律审计 → `workbench-retro`
- 项目状态缺失 → `memory-writeback`
- 资产本体/index 修复 → `asset-ingest`

## 自检

```bash
PERIOD="$(jspace memory period --json)"
MONDAY="$(printf '%s' "$PERIOD" | jq -r '.week_start')"
test -f "<filehub>/areas/周报/$MONDAY-周报.md"
gbrain call get_page "{\"slug\":\"assets/周报/$MONDAY\",\"include_content\":true}"
jspace filehub check --json
```

文件名、slug、窗口或 `observed_through` 任一不是本期,视为未完成。
