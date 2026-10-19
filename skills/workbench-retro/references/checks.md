# workbench-retro - 六条检查细则(取证、判读与分级)

每条检查固定为:**只读取证 -> 阈值判读 -> 分级去向**。

## 共通契约

- 周期只取自 `jspace memory period --json`:用 `week_start`、`window_start`、`window_end_exclusive` 和 `observed_through`;周中运行只审到 cutoff,不另写日期算法。
- 不得用执行当天、周日日期或自然“近 7 天”作为周 id。补跑过去周必须显式指定目标周一。
- 页角色按 slug + tags 判断。`type` 只是描述元数据,不用于合法性过滤、抽样条件或“迁移完成”判断。
- 页读取、列表和反向边统一使用 `gbrain call get_page|list_pages|get_backlinks`;`gbrain query|search` 只用于检索。
- 列表行只证明元数据候选存在,不能证明正文、完整 tags、`activity:maintenance` 或来源。所有进入结论的候选都要 `get_page` 且 `include_content: true`。
- 证据拿不到、分页未完成、coverage 降级或预算耗尽时,该条记 `unknown/partial + 缺什么 + 怎么补`,不得折叠成“无数据/一致”。
- `<filehub>` = `.jspace/hub.json` 中 `type: filehub` 资源经 `local.bindings` 解析后的 `primary: true` 本机路径;解析不到时,检查 2/3/5 记 `unknown(filehub 未注册)`。

---

## 检查 1 - 写回执行率

目标:区分会话写回、cron 写回、维护改写和无来源页;统计单位是**页**,不是命令运行次数或提醒次数。

### 证据

要得到包括无 tag 页在内的完整分母,先对工作台相关页做 keyset 全量候选扫描:

```bash
gbrain call list_pages '{"limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"limit":100,"sort":"updated_asc","updated_after":"<last.updated_at_iso>","updated_after_slug":"<last.slug>"}'
```

逐页直到空页或明确结束;达到页数/行数/时间预算时记 `partial`。来源 tag 查询可作交叉检查:

```bash
gbrain call list_pages '{"tag":"source:session","limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"tag":"source:cron","limit":100,"sort":"updated_asc"}'
```

对每个 `updated_at` 落在窗口内的候选,读取完整页:

```bash
gbrain call get_page '{"slug":"<candidate-slug>","include_content":true}'
```

活动信号只作佐证:

```bash
find <filehub>/projects -type f -newermt '<window-start>' ! -newermt '<observed-through>'
find .jspace/logs/cron -type f -newermt '<window-start>' ! -newermt '<observed-through>'
jq '.session_count, .writeback_nudge_for_session' .jspace/state/briefing.json
```

### 判读

| 计数 | 规则 |
|---|---|
| `session_writes` | 完整页 tags 恰含 `source:session`,且在窗口内发生业务更新 |
| `cron_writes` | 完整页 tags 恰含 `source:cron`,且在窗口内发生业务更新 |
| `untagged_writes` | 窗口内有更新,但 `source:session` / `source:cron` 都没有 |
| `maintenance_writes` | 窗口内有 `activity:maintenance`,从以上业务活动计数中排除,单独报告 |

- `source:session|cron` 是运行模式 tag;frontmatter `source` 是 harness;`content_origin` 是内容出处。三者不可互换,也不得根据 `source` 字段猜测运行模式。
- 若一页同时有 session/cron 两个模式 tag、重复 routing tag 或没有模式 tag,记为来源纪律问题;不能凭列表筛选结果把它算进任一条腿。
- 写回率 = `session_writes / (session_writes + cron_writes)`;分母 0 时写“本周无业务写入”,不写 `0%`。
- `session_writes == 0 && cron_writes > 0` -> 会话写回腿停摆。
- 两者都为 0 且有活动信号 -> 写回腿整体停摆。
- `untagged_writes > 0` 时按页点名;历史页只在基线记数,窗口内新写页归写侧纪律缺口。
- `maintenance_writes > 0` 只说明有维护改写,不得用它证明业务复用、M7 里程或“越用越强”。
- 状态页 `project/<id>/state` 长期未更新可以是缺口线索,但不能替代来源计数;两者不一致时两个数字都报。
- 来源 tag 查询不可用或 keyset 不完整时,来源比例记 `partial/unknown`。可按命名空间给出明确标注的“proxy 估算”,但 proxy 不得关闭 R2 或业务验收。

提醒面只用于解释“没提醒”还是“提醒了没写”:`session_count` 在涨且轻提示已消费,说明 hook 在跑;它仍不等于 gbrain 已写入。

### 分级

- 单项目写回缺口 -> `需你决策`:问该项目本期进展是否需要补记。
- 会话腿/整体停摆 -> `需你决策`,并在报告首句点出。
- hook 未接上或 cron failures 有 actionable 项 -> `立即可做`。

---

## 检查 2 - 挂接一致性

目标:发现 filehub 项目、域 README、registry 三方的漂移。

### 证据

```bash
find <filehub>/projects -mindepth 1 -maxdepth 1 -type d -print
rg -n '\|' workspace/<domain>/README.md
jspace project list
```

### 判读

- `projects/<X>/` 存在但域 README 无 X -> 未挂接。
- 域 README 有 X 但 `projects/<X>/` 不存在 -> 悬挂行。
- 项目表仍有占位行 -> 占位未清。
- registry 缺项目或 `asset_rel_path` 无法解析 -> 注册缺口。

### 分级

全部归 `立即可做`,附具体文件/行与修复命令;不要因 registry warning 自动创建项目或改写用户文档。

---

## 检查 3 - 指针与资产查重

目标:确认 asset 指针能用 `rel_path` 经本机 filehub 根解析,并区分“同内容重复”和“明确新版”。

### 证据

```bash
gbrain call list_pages '{"tag":"asset","limit":100,"sort":"updated_asc"}'
gbrain call get_page '{"slug":"<asset-slug>","include_content":true}'
jspace filehub check --dir . --json
```

对抽样页:

```bash
test -f "<filehub>/<rel_path>" && echo OK || echo MISSING
test -f "<Pointer>" && echo POINTER_OK || echo POINTER_MISSING
```

### 判读

- 抽样不超过 5 条,跨周轮换;全量扫描超出小检查预算时标 `partial`。
- `rel_path` 是主定位;按本机 filehub 根重解析。`Pointer` 只是本机提示,不是可移植事实源。
- `rel_path` 解析成功 -> 指针可用;旧机绝对 `Pointer` 失效不单独判断指针。
- `rel_path` 缺失但 `Pointer` 可解析 -> 可用但为待修纪律缺口;不要补造历史来源。
- 两者都失败 -> 断指针。
- asset 页的 `project` 是 owner namespace,`owner_kind: project|area` 应与 slug / `rel_path` 一致。人工旧页缺 `owner_kind` 时可由 `rel_path` 推断,并记为待修字段,不是伪造来源。
- `jspace filehub check --json` 的 `filehub.asset.duplicate_content` 报告跨路径同内容;只提示人工处置,**不自动移动或删除文件**。
- 同语义已存在且内容相同 -> 不覆盖、不另建第二份;明确新版 -> 新 `-vN` slug + 新页正文 `Supersedes: [[old]]` + 旧页 CAS 生命周期更新。错页不能靠覆盖现有 slug 修复。

### 分级

断指针/无法解析 -> `立即可做`;缺 `rel_path`/owner 字段 -> `需你决策`;同内容重复 -> 人工选择保留位置,不能自动清理。

---

## 检查 4 - 流程卡点

### 证据

```bash
jspace cron failures --json
jspace cron list --json
jspace ingest list --json
jspace pending list --json
find .jspace/state/pending -maxdepth 1 -name '*.APPLY.json' -print 2>/dev/null
find .jspace/logs/cron -type f -newermt '<window-start>' ! -newermt '<observed-through>'
```

### 判读

- 所有 cron `enabled: false` -> 定时层从未启用;没运行过就没有失败,不能据此说流程健康。
- `jspace cron failures` exit != 0 -> 有 open incident、actionable pending 或 damaged state,逐项列出。
- ingest journal 有 in-progress / cleanup-pending 且多日未推进 -> 入库中断。
- pending 根是 `.jspace/state/pending/<id>.APPLY.json`,不依赖 filehub。`staged` / `acked` 都不等于落库;只有 apply 并有读回才完成。
- `create` 目标已存在应报 `target_exists`;`replace` 必须带 stage 时 `expected_revision`。冲突、超时、锁和响应丢失都是不同状态,不得合并成“重试即可”。
- 旧 `<filehub>/.jspace-logs/*.APPLY.json` 只作为 `workspace upgrade` 显式迁移输入;不作为现行扫描根。
- 同一 cron 本期失败 >= 2 次 -> 重复失败;一次失败且随后成功 -> 偶发,保留证据。

### 分级

未处置失败、入库中断、pending 堆积 -> `立即可做`,附 `jspace cron failures` / `ingest list` / `pending apply|ack` 的恢复入口;重复失败 -> `需你决策`,先查根因。人工重跑统一 `jspace cron run --id <id>`。

---

## 检查 5 - inbox 停滞

### 证据

```bash
jspace inbox status
find <filehub>/_inbox -type f -mtime +7 -not -name '.*'
tail -40 <filehub>/.jspace-logs/inbox-batch.md
```

### 判读

- 文件超过 7 天 -> 停滞;超过 21 天 -> 长期停滞。
- 同一文件在批次日志中被列为模糊项 >= 2 次 -> 规则缺口,不是用户懒。
- inbox 为空 -> 无停滞,但连续多周为空记入观察,不能当作资产闭环证据。

### 分级

停滞 -> `需你决策`(归属/命名);规则缺口 -> `需你决策`(提议修订 asset-ingest);日志/状态不可读 -> `unknown`。

---

## 检查 6 - 规则进化候选

### 证据

```bash
gbrain call list_pages '{"tag":"knowledge","limit":100,"sort":"updated_asc"}'
gbrain call get_page '{"slug":"<knowledge-or-lesson-slug>","include_content":true}'
gbrain query "本周重复出现的问题"
tail -30 .jspace/logs/cron/<id>/<latest>.md
rg -n '无法判定|跳过|模糊' <filehub>/.jspace-logs/inbox-batch.md | tail -10
```

### 判读

- 同一主题的本期知识/教训页 >= 2,或跨 >= 2 周重复 -> 提议沉淀到域 README 或 skill。
- 同一 skill 步骤反复临场判断 -> 提议修订该规则。
- 现有 skill 都不覆盖的重复流程 -> 评估新建 skill。
- 连续 2 周违反同一纪律 -> 先判断规则是否不可执行,再提议修订。
- 候选晋升到跨项目 `knowledge/` 必须有**第二项目真实复用证据**;仅“看起来通用”、fixture、维护更新或重复出现都只能挂账。

### 分级

全部归 `需你决策`;给“改哪个文件哪一节 + 改成什么”,retro 不直接修改规则。

---

## 检查 6b - 取代链健康

目标:确认旧页能否经反向边找到真正声明取代它的新页,且不把旧页正文当作导航。

### 证据

先从本期候选页的 slug + tags 找出 decisions/lessons/knowledge 角色,逐页读取:

```bash
gbrain call get_page '{"slug":"<candidate-slug>","include_content":true}'
gbrain call get_backlinks '{"slug":"<old-slug>","group":"page","limit":100}'
gbrain call get_backlinks '{"slug":"<old-slug>","group":"page","limit":100,"cursor":"<cursor>"}'
```

对每个 backlink 候选执行 `get_page(include_content:true)`,只接受正文实际包含以下方向的页:

```text
Supersedes: [[<old-slug>]]
```

绝不能从旧页正文读取 `Supersedes` 后反向跟到“新页”。

### 判读

- 必须消费完整 `truncated` / `cursor` / `coverage`;coverage degraded、cursor 异常或预算耗尽 -> `partial/unknown`,不能报“无取代者”。
- 候选正文方向不符 -> 丢弃,不按 `updated_at` 任取最新页。
- 无候选 -> 旧页可能已失效但无现行页,记 `conflict/unknown`。
- 多个合格现行候选、环、缺页或超过检查预算仍未收敛 -> `需你决策`。
- 合格候选若无 status 或 `status:provisional|settled`,可作为现行页;provisional 必须带不确定性。`status:deprecated|archived` 不作为当前结论。
- 旧页正文保持不可变;生命周期修复必须读取完整页和 revision,只保留一个 `status:*`,再以 `expected_revision` 做 CAS。不得分步 add/remove tag 冒充原子更新。
- `type` 不参与上述判断。

### 分级

取代方向错误、多个 active 冲突、缺页/环 -> `需你决策`,优先于一般规则候选;只给恢复方案,不自动改库。

---

## 报告结构

`records/retro/<Monday>` 与用户输出共用:

```markdown
# 周自省 <Monday>(窗口 [<Monday 00:00>, <下周一 00:00>);observed_through <ISO-8601 offset>)

coverage: complete | partial | unknown

## 一句话
<本周纪律整体状态;会话腿停摆等整体问题先写>

## 写回率(检查 1)
- 会话写入 <N> 页 / cron 写入 <M> 页 -> 写回率 <N/(N+M)>(分母 0 时写“本周无业务写入”)
- 维护改写排除 <K> 页;无来源 tag 页 <U> 页(历史/漏标分别列)
- 取证覆盖:<keyset complete / partial + 原因>
- 口径:session/cron 是运行模式 tag;frontmatter source 是 harness;content_origin 是内容出处
- 提醒面:session_count <涨没涨> / 轻提示 <发没发>

## 立即可做(N)
- [问题] 证据:`<命令或字段摘要>` -> 结论:<...>
  修复:`<具体命令或编辑动作>`

## 需你决策(N)
- [问题] 证据:<...> -> 结论:<...>
  选项:A ... / B ...;推荐 A,因为 ...

## 观察中(N)
- [信号] 证据:<...> -> 出现 1 次,下周复核

## 无法判定(N)
- [检查 X] 缺:<证据/coverage> -> 补法:<怎么拿到>

## 基线数据(供跨周对比)
- 业务写入/会话写入/cron 写入/无 tag 页/维护页
- state 更新数/未挂接项目/断指针/重复内容/inbox 停滞/cron 失败/取代冲突
```

单周数字只作基线,不据此宣称“习惯已养成”;周期关闭条件与真实复用证据按 `jspace-use/references/usage-mileage.md` 和共同 `gbrain.md` 判定。
