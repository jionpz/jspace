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
- 路径唯一性由 `jspace filehub weekly-path --week <Monday> --json` 裁决;不要自行拼年份目录。
- 可读取项目 state、原始事实页和资产证据;无法完整读取时输出 `partial`。

## 权威引用

- 周期、来源 tag、asset `rel_path` 和完成证据:`~/.agents/skills/jspace-use/references/gbrain.md`
- 项目发现、文件命名和布局:`~/.agents/skills/asset-ingest/references/filing.md`
- 机器快照边界:`~/.agents/skills/memory-consolidate/SKILL.md`

## 写集

- `<filehub>/areas/周报/index.md`:area owner index;首次写正文前必须存在。同周只保留一行 four-column 登记;重复执行更新该行,不追加第二行。
- `<filehub>/areas/周报/<Monday>-周报.md`:人读周报正文;若 `weekly-path` 返回已登记的年份位置,写到该位置。
- `assets/周报/<Monday>`:指向该文件的 asset 指针页。
- 不写:项目 state、consolidate 页、retro 页、规则、skills 或 cron 配置;不新建第二个周报文件/页/row。

## 输出

| 字段 | 内容 |
|---|---|
| 周期 | `week_start` |
| 文件 | `weekly-path` 返回的 `relPath`(默认 `<filehub>/areas/周报/<Monday>-周报.md`;既有年份位置则复用) |
| 指针 | `assets/周报/<Monday>` |
| 位置裁决 | default / reuse / conflict + 冲突 code |
| 窗口 | `[window_start, window_end_exclusive)` |
| cutoff | `observed_through` |
| 周期状态 | `period.status` = complete / in_progress |
| 取证覆盖 | complete / partial / unknown |
| 来源 | 原始页 slug、项目 state、资产路径 |
| 缺口 | 无法确认的项目/事实 |

## 主流程

1. **定周期与位置**:先运行 `jspace memory period --json`。文件名和 slug 只用 `week_start`;窗口、时区和截止时刻只消费命令输出。`period.status=in_progress` 时明确“截至 observed_through”,不冒充整周。再运行 `jspace filehub weekly-path --week <week_start> --json`:
   - `state=default`:用返回的 `relPath`(默认 `areas/周报/<Monday>-周报.md`);`index.ready=false` 时先创建 area index 再写正文。
   - `state=reuse`:只用返回的唯一既有位置;不得因为运行日期跨年改到默认或新年份目录。
   - `state=conflict`:停止写入,报告 `code`、候选和缺失证据(根/年双份、索引与文件不一致、损坏索引等),由用户裁决;不得再生成第三份。
2. **发现项目**:合并域 README、registry、`project/<id>/state` 和本周资产证据;发现不了就少写,不臆造。
3. **收集本期事实**:读取目标窗口内的原始页和项目 state。不得把上一周期周报改标题、把上一轮 consolidate 当成本期权威,或在缺输入时复制旧内容。
4. **使用可选索引**:同窗口 consolidate 只能用于定位其明确引用的源页;源页不可读时标 `partial`。
5. **生成正文**:每项目写“本期进展 / 当前状态 / 下一步”,末尾列关键文件和 slug。事实不足时明确标记未知。
6. **写文件**:只写 `weekly-path` 给出的位置。目标存在时先确认是同一周生成物并保留恢复副本,再原子更新;若发现用户改写的非同源内容,报告 conflict,不覆盖。
7. **写索引**:`areas/周报/index.md` 缺表时按 owner index 格式建立;同 slug 已有 row 则原地更新路径/日期/类型,没有才追加一行。索引 row 的路径相对 `areas/周报/`(年份位置写 `<year>/<Monday>-周报.md`),slug 恒为 `assets/周报/<Monday>`。
8. **写指针**:按 asset 页契约写 `rel_path`、Pointer、Summary、tags;已有同周页则读取 revision 后 CAS 覆盖。
9. **核对**:重跑 `jspace filehub weekly-path --week <Monday> --json` 应保持 `reuse` 且恰有一个候选;读取文件、指针页和索引;若 `put_page` 合并了旧的另一来源 tag,用 `remove_tag` CAS 清理并再次读回;`jspace filehub check --json` 对本资产无新增 error/unknown。

## 完成证据

- `weekly-path` 收尾时为 `reuse`,且该周只有一个文件位置;
- 周报文件名与周期 id 同为目标周一;
- 文件存在且正文可打开,内容明确窗口与 `observed_through`;
- `areas/周报/index.md` 可读,该周恰好一行,路径与文件一致、slug 为 `assets/周报/<Monday>`;
- `assets/周报/<Monday>` 可读回,`rel_path` 与文件一致,Pointer 指向同一文件;
- tags 含 `asset`、`weekly`,且恰好一个来源 tag;
- 同周重跑不增加第二个文件、页或 index row;
- 来源页可追溯;不完整覆盖明确写 `partial`。

## 失败与恢复

- filehub 未注册或无法解析:停止写入并报告,不猜路径。
- `weekly-path` 报 conflict:停止写入并报告 `code` 与候选(根/年双份、未登记文件、索引指向缺失文件、损坏索引等),不新建第三份,也不移走用户文件。
- `areas/周报/index.md` 缺失:先按 owner index 格式创建再写正文;不可读、symlink 或结构损坏时停止。
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
jspace filehub weekly-path --week "$MONDAY" --json   # expect state=reuse
gbrain call get_page "{\"slug\":\"assets/周报/$MONDAY\",\"include_content\":true}"
jspace filehub check --json
```

文件名、slug、窗口或 `observed_through` 任一不是本期,或 `weekly-path` 不是 `reuse`,视为未完成。
