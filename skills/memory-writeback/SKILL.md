---
name: memory-writeback
description: "会话结束或阶段收口时,把持久事实分类写入 gbrain:状态卡 CAS 覆盖,决策/经验/知识追加,并在写后读回验证。Use when 收工/写回记忆/记一下本次进展。Do NOT use for 文件本体归位(→asset-ingest)、用户问句召回(→memory-recall)或周快照(→memory-consolidate)。"
triggers:
  - "收工"
  - "写回记忆"
  - "记一下本次进展"
  - "end of work"
  - "session end"
  - "writeback"
---

# memory-writeback - 会话事实写回

把本次会话产生的持久事实写进 gbrain。目标是让下一次会话少走弯路,不是复制聊天记录。没有持久事实时静默结束。

## 触发 / 非目标

- 用:收工、阶段完成、重要决策已定、教训已提炼、用户纠正归位偏好。
- 不用:资料本体移动和资产指针 → `asset-ingest`;读侧召回 → `memory-recall`;周期快照 → `memory-consolidate`;项目任务、bug、迭代详情 → 项目原生载体。
- 可写不代表必须写:只对未来会话有复用价值的持久事实才写。

## 输入与前置

- 本次会话可确认的事实、证据、时间范围和归属项目。
- 写入前读取相关工作台状态、项目规范、现有 state、相关 decision/lesson 和 `profile/filing-prefs`。
- 运行模式必须明确:交互会话写 `source:session`;`source` frontmatter 写实际 harness;内容出处显式选择 `user_said|tool_output|inferred`。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 唯一记忆契约、页 envelope、生命周期、`Supersedes` 和 pending:`../jspace-use/references/gbrain.md`
- 分类树、slug 派生、晋升和取代细则:`references/writeback.md`
- Golden run:`references/example-writeback.md`

## 写集

- `project/<id>/state`:项目认知卡,CAS 覆盖。
- `project/<id>/decisions/<topic>`:决策,追加。
- `project/<id>/lessons/<topic>`:项目经验,追加。
- `knowledge/<domain>/<topic>`:有第二项目真实复用证据的跨项目知识,追加。
- `profile/<topic>` / `profile/filing-prefs`:工作台偏好,CAS 覆盖。
- `records/project/<id>/<date>-<topic>`:稀疏事件,追加。
- `.jspace/state/pending/*.APPLY.json`:仅在安全写入暂不可用时暂存。
- 不写:资产本体、owner index、项目任务系统、周快照/周报/retro、历史来源 tag。

## 输出

每次写回报告:

| 字段 | 内容 |
|---|---|
| 决策 | 写 / 不写,以及理由 |
| 页面 | slug、创建/替换、intent |
| 证据 | request id、committed receipt、revision |
| 验证 | 读回后的 slug、tags、source、owner |
| 未决 | pending、冲突、失败或无需写入 |

## 主流程

1. **扫描**:列出本次持久事实;无关闲聊、一次性命令和可从原件直接恢复的细节不写。
2. **分类与归属**:按 `writeback.md` 分类,确定 project/area 和稳定 slug;归属不明先查 registry、域 README 和既有 state。
3. **先保全再覆盖**:state 中将被移除、但仍能解释历史的决定或事件,先写 decision/record;随后生成新的三段式认知卡。
4. **读取现状**:替换前 `get_page(include_content:true)` 取得最新 `revision`;追加页先检查 slug 是否已存在,避免重复。
5. **构造完整页**:frontmatter 必须含实际 `source`、owner 字段、路由 tag,且恰好一个 `source:session`/`source:cron`;描述性 `type` 保持真实值,路由只用 slug + tags。
6. **结构化写入**:用新的稳定 request id 调用 `gbrain call put_page`;替换时携带读到的完整页正文和 `expected_revision`。
7. **处理响应丢失**:先 `get_write_request` 找 committed 回执,再读目标页;不得换新 request id 重发不同正文。
8. **读回验证**:核对 receipt、revision、完整正文、tags、owner 和 `Supersedes` 方向。`put_page` 的 tags 是合并语义;若读回同时含 `source:session` 与 `source:cron`,用 `remove_tag`(带 `expected_revision` + 新 request id)删除不属于本次运行模式的 tag,再读回确认只剩一个。
9. **有产出文件**:不在此移动;转 `asset-ingest`。

### 写页最小请求

```bash
request_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
jq -n \
  --arg slug "<slug>" \
  --rawfile content page.md \
  --arg request_id "$request_id" \
  --arg source_id "jspace:memory-writeback:<stable-topic>" \
  --arg content_origin user_said \
  '{slug:$slug,content:$content,request_id:$request_id,source_id:$source_id,content_origin:$content_origin}' \
  > request.json
gbrain call put_page "$(cat request.json)"
gbrain call get_page "$(jq -cn --arg slug "<slug>" '{slug:$slug,include_content:true}')"
```

替换请求在 JSON 中加 `"expected_revision": "<opaque-revision>"`；revision 是不透明字符串（当前为 UUID），不得转成数字。

## 完成证据

- 写侧返回 committed receipt,或响应丢失后由 `get_write_request` 证明已提交;
- 目标页可读回,revision 与 receipt 一致;
- 页面的 `source`、owner、tags、正文和 slug 均符合契约;
- 状态覆盖没有创建重复页,追加页没有覆盖旧正文,`Supersedes` 是由新页指向旧页;
- 每个结论都能指出对应 slug 和验证输出。

进程 exit 0、只写 pending、只改 journal、列表中出现结果或 agent 自述,都不等于完成。

## 失败与恢复

- 锁冲突、超时或响应不确定:先生成完整页,再 `jspace pending stage`;`create` 不允许 target 已存在,`replace` 必须带 stage 时的 revision。
- pending staged / terminal_failed 不等于成功;只有 apply 后读回通过才继续下游。
- revision conflict:重新读取并合并新事实;不得用旧正文覆盖,也不得伪造“最新”时间。
- 写入后发现内容错误:写新页并声明 `Supersedes`,再用 CAS 更新旧页生命周期;历史正文不改。
- embedding 不可达:写仍可成功,页内 `embed_skip: true`,并提示检索降级;写入证据仍以回执和读回为准。

## 转交

- 文件本体或 asset 指针 → `asset-ingest`
- 周内归纳 → `memory-consolidate`
- 人读周报 → `weekly-report`
- 检索/现行页解释 → `memory-recall`
- gbrain 二进制、数据库或 harness 接线 → `jspace-use`

## 自检

```bash
gbrain call get_page '{"slug":"<slug>","include_content":true}'
jspace pending list
jspace memory check --json
```

没有持久事实时,本 skill 的输出应为空,不创建占位页,不发提醒。
