---
name: workbench-retro
description: "按工作台本地周窗口取证式审计纪律执行、流程卡点和规则漂移,产出分级建议与周 retro 页;默认只提议不改。Use when 周自省/复盘/工作流体检/retro。Do NOT use for 事实归纳(→memory-consolidate)、周报(→weekly-report)、收工写回(→memory-writeback)或命令排障(→jspace-use)。"
triggers:
  - "周自省"
  - "复盘"
  - "本周回顾"
  - "工作流体检"
  - "retro"
  - "workbench retro"
  - "纪律检查"
---

# workbench-retro - 每周纪律自省

审计“工作台有没有按规则运转”,不是再写一份进展摘要。每条结论必须绑定实际命令或文件证据;拿不到证据就记 `unknown`,不猜。

## 触发 / 非目标

- 用:每周自省、流程复盘、怀疑纪律静默腐化。
- 不用:归纳本周事实 → `memory-consolidate`;生成人读周报 → `weekly-report`;单次写回 → `memory-writeback`;某条命令报错 → `jspace-use` 的排障章节。

## 输入与前置

- 工作台根与 `jspace` CLI;周期参数统一取自 `jspace memory period --json`。
- gbrain、registry、filehub、cron 日志和可用的项目记录。
- 只读工具与一次 retro 页写入权限;无头模式不得等待用户或修改其他文件。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 六条检查、判定阈值和报告骨架:`references/checks.md`
- 写回和来源 tag:`../memory-writeback/references/writeback.md`、`../jspace-use/references/gbrain.md`
- 周期、取代链和页 envelope:`../jspace-use/references/gbrain.md`
- Golden run:`references/example-retro.md`

## 写集

- `records/retro/<Monday>`:本次自省页,创建或 CAS 覆盖。
- 不写:规则、skills、README、`hub.json`、项目文件、cron 配置、state、周报、资产本体。
- 会话模式可以在报告中给修复命令;执行“立即可做”项仍需用户逐项确认。

## 输出

固定报告结构:

1. 一句话结论
2. 写回率(必出)
3. 立即可做
4. 需你决策
5. 观察中
6. 无法判定
7. 基线数据

每条发现写 `证据 -> 结论 -> 去向`,并标注 `complete/partial/unknown`。

## 主流程

1. **定周期**:先运行 `jspace memory period --json`。slug 只用 `week_start`;窗口、时区和 `observed_through` 只消费输出。补跑加 `--week`,固定取证加 `--now`。
2. **取证**:
   - gbrain 来源计数和页面抽样使用 `gbrain call list_pages` keyset,逐候选 `get_page`;
   - `jspace cron failures --json`、`jspace cron list --json`、`jspace ingest list --json`、`jspace pending list --json`;
   - `jspace memory check --json`、`jspace filehub check --json`;
   - cron 日志、inbox、briefing 和项目挂接证据。
3. **判读**:按 `checks.md` 的五类阈值分级。列表查询只能证明“能查到”,不能替代逐页 tag/正文校验。
4. **取代链**:对 `status:superseded` 页调用 `get_backlinks` 全分页,逐个 `get_page`,只接受正文明确声明取代该旧页的现行候选;分叉、环、缺页和 degraded coverage 记 `unknown/conflict`。
5. **不按 type 路由**:页角色由 slug + tags 判断;描述性 `type` 不用于合法性裁决,也不批量改写。
6. **生成页面**:frontmatter `project: jspace`,tags `[retro, weekly, <source>]`,含窗口和 `observed_through`;同周已有页时读取 revision 后 CAS 覆盖同一 slug。
7. **读回验证**:确认页存在、来源 tag 正确、每条结论有证据、写作前后工作台文件未变化。`put_page` 合并旧 tags;若读回出现两个来源 tag,用 `remove_tag` CAS 清理并再次读回。

## 完成证据

- `records/retro/<Monday>` 可读回,周期为周一,窗口和 cutoff 完整;
- 写回率一节存在;所有数字可追溯到实际输出;
- 每个建议都有证据行和分级,无法取证项明确列出;
- 同周重跑不产生第二个 retro 页;
- 除 retro 页外没有修改任何文件;会话模式的执行项都有用户确认记录。

## 失败与恢复

- 某项证据不可得:记 `unknown + 缺什么 + 如何补`,继续其他检查。
- gbrain 分页/backlinks 不完整:报告 `partial`,不推断全库状况。
- cron failures 返回非 0:这是“有事项需要关注”,不是审计失败;保留输出并分级。
- 同周页 CAS 冲突:重读合并,不覆盖他人内容。
- pending/gbrain 写失败:保留报告文件或使用 pending 暂存;读回前不宣称完成。

## 转交

- 进展事实归纳 → `memory-consolidate`
- 人读周报 → `weekly-report`
- 记忆/指针修复 → `memory-writeback` / `asset-ingest`
- 工作台配置、cron、gbrain 环境 → `jspace-use`
- 全局治理接线 → `harness-config`

## 自检

```bash
PERIOD="$(jspace memory period --json)"
MONDAY="$(printf '%s' "$PERIOD" | jq -r '.week_start')"
gbrain call get_page "{\"slug\":\"records/retro/$MONDAY\",\"include_content\":true}"
jspace memory check --json
jspace filehub check --json
git status --short   # 工作台不是 git 仓库时跳过
```

缺“写回率”、用执行当天冒充目标周、按 type 判角色、把提醒次数当写入次数,均视为本次自省不合格。
