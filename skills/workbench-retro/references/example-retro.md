# workbench-retro - Golden Run(当前契约)

本文件分两部分:

1. 保留 2026-08 既有示例的**历史证据数字**,但明确标注其采集口径已退役;
2. 用当前结构化 gbrain 契约演示一次可复跑的 retro。

历史数字不能被当成今天的实时查询结果,也不能用旧文本 CLI 原样重放。

---

## 历史证据锚点(2026-08)

2026-08 的既有示例记录过一次周日 23:00 的 retro:

- 当时窗口被描述为 `2026-08-04 ~ 2026-08-10`;
- 会话来源写回 0 页,cron 来源 4 页,无来源 tag 页 0 页;
- 页面更新时间集中在 `2026-08-09`,`session_count = 9`,`writeback_nudge_for_session = 9`;
- `_inbox/` 为空;一次 API 520 失败在 `08-08` 成功并 ack;
- 历史产物曾写成 `records/retro/2026-08-10`。

这些是旧文本 CLI 时期的**历史证据,不能按当前 CLI 原样重放**。按当前周期契约:

- 2026-08-04 不是周一;
- 包含该历史观测的周窗口应为 `[2026-08-03 00:00, 2026-08-10 00:00)` 本地时间;
- canonical slug 应使用周一 `records/retro/2026-08-03`;
- `records/retro/2026-08-10` 只能作为历史迁移对象,不能作为本周重跑目标。

不要为了对齐新契约而改写旧页正文或伪造新的历史来源。若要迁移,按完整页 + revision 的显式维护流程处理。

---

## 当前 Golden Run

场景:本周周日 23:00 由 cron 触发,或用户在会话内说“周自省”。

```text
timezone: Asia/Shanghai
Monday: <目标周周一 YYYY-MM-DD>
window: [<Monday> 00:00, <下周一> 00:00)
observed_through: <ISO-8601 with offset>
canonical_slug: records/retro/<Monday>
```

### 第 1 步 - 定周期

先运行 `jspace memory period --json`,记录 `week_start`、窗口和 `observed_through`。

周中运行时只审到 cutoff,不能把尚未发生的日子写成已覆盖。

### 第 2 步 - 来源与写回候选

先列 session/cron 候选,再逐页读取:

```bash
gbrain call list_pages '{"tag":"source:session","limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"tag":"source:cron","limit":100,"sort":"updated_asc"}'
```

示意输出(仅示意形状,不代表本次真实数据):

```json
[
  {
    "slug": "records/consolidate/<Monday>",
    "updated_at_iso": "<window-timestamp>"
  },
  {
    "slug": "project/<id>/state",
    "updated_at_iso": "<window-timestamp>"
  }
]
```

列表行不能证明 tags/正文。对窗口内每个候选执行:

```bash
gbrain call get_page '{"slug":"records/consolidate/<Monday>","include_content":true}'
gbrain call get_page '{"slug":"project/<id>/state","include_content":true}'
```

示意读回:

```json
{
  "slug": "records/consolidate/<Monday>",
  "revision": "<opaque-revision>",
  "tags": ["consolidate", "weekly", "source:cron"],
  "content": "..."
}
```

为得到“无来源 tag”分母,还要用 `list_pages` 的 keyset 全量扫描窗口候选,不能只从两个 tagged 查询相减。

```bash
gbrain call list_pages '{"limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"limit":100,"sort":"updated_asc","updated_after":"<last.updated_at_iso>","updated_after_slug":"<last.slug>"}'
```

### 第 3 步 - 活动与流程证据

```bash
find <filehub>/projects -type f -newermt '<window-start>' ! -newermt '<observed-through>'
find .jspace/logs/cron -type f -newermt '<window-start>' ! -newermt '<observed-through>'
jq '.session_count, .writeback_nudge_for_session' .jspace/state/briefing.json
```

示意输出:

```text
session_count = 9
writeback_nudge_for_session = 9
```

这只能说明提醒面在跑,不能证明 gbrain 写入。

```bash
jspace cron failures --json
jspace cron list --json
jspace ingest list --json
jspace pending list --json
```

示意输出:

```json
{
  "needs_attention": 0,
  "pending": [],
  "open_incidents": []
}
```

若存在历史 incident,要读取事件时间和 ack/成功时间,判断是偶发还是重复失败;不得把“命令 exit 0”当成流程健康。

### 第 4 步 - 指针与取代链

抽样 asset:

```bash
gbrain call list_pages '{"tag":"asset","limit":100,"sort":"updated_asc"}'
gbrain call get_page '{"slug":"assets/<owner>/<semantic>","include_content":true}'
jspace filehub check --json
```

对 asset 页:

- 先按 `<filehub>/<rel_path>` 解析;
- `Pointer` 只作本机提示;
- 缺 `rel_path` 或 owner 字段记待修,不补造历史来源;
- `filehub.asset.duplicate_content` 只报告重复,不自动移动/删除。

对本期 decisions/lessons/knowledge 候选,逐个读取 full page。若页为 `status:superseded`,从旧页查询反向边:

```bash
gbrain call get_backlinks '{"slug":"<old-slug>","group":"page","limit":100}'
gbrain call get_backlinks '{"slug":"<old-slug>","group":"page","limit":100,"cursor":"<cursor>"}'
gbrain call get_page '{"slug":"<candidate-new-slug>","include_content":true}'
```

只接受新页正文明确写出:

```text
Supersedes: [[<old-slug>]]
```

如果 coverage degraded、分页未完成、零候选、多候选、环或缺页,记 `partial/unknown/conflict`;不要从旧页正文反向跟随。

### 第 5 步 - 判读与分级

示意判读(数字用于演示口径,不是本轮真实观测):

- 会话业务写入 0 页,cron 业务写入 4 页,维护改写排除 0 页,无来源 tag 页 0 页;
- 写回率为 `0/(0+4) = 0%`,分母非零;
- 提醒面已消费,所以归为“提醒了但没写”的会话腿停摆,而不是 hook 未接线;
- 历史旧页 `records/retro/2026-08-10` 不参与本周周期身份;
- 若来源 keyset 只完成一部分,以上数字必须标 `partial`,不能报精确比例。

### 第 6 步 - 写 retro 页

先读同周页:

```bash
gbrain call get_page '{"slug":"records/retro/<Monday>","include_content":true}'
```

不存在则创建;存在则用读到的 `revision` 作为 `expected_revision` 做 CAS:

```bash
cat > /tmp/retro-request.json <<'JSON'
{
  "slug": "records/retro/<Monday>",
  "content": "<full-retro-markdown>",
  "request_id": "<fresh-uuid>",
  "source_id": "jspace:workbench-retro:<Monday>",
  "content_origin": "inferred"
}
JSON

gbrain call put_page "$(cat /tmp/retro-request.json)"
gbrain call get_page '{"slug":"records/retro/<Monday>","include_content":true}'
```

替换时在请求中加入:

```json
{"expected_revision": "<opaque-revision>"}
```

响应丢失先 `get_write_request`,不得换新 request id 重写。`put_page` 返回 committed、读回 revision 一致且结构/tags 通过,才算完成。

---

## 合格报告骨架

```markdown
# 周自省 <Monday>(窗口 [<Monday 00:00>, <下周一 00:00>);observed_through <ISO-8601>)

coverage: complete | partial | unknown

## 一句话
cron 腿在转,资产腿无输入,会话写回腿停摆;这是本周纪律状态,不是“习惯已养成”的结论。

## 写回率
- 会话业务写入 0 页 / cron 业务写入 4 页 -> 0%
- 维护改写排除 0 页;无来源 tag 页 0 页
- 取证:list_pages keyset + 逐页 get_page,complete/partial 明确写出
- 提醒面:session_count 在涨,轻提示已消费

## 立即可做
- [流程] 证据:... -> 结论:...
  修复:...

## 需你决策
- [写回停摆] 证据:... -> 结论:...
  选项:A ... / B ...;推荐 A,因为 ...

## 观察中
- [资产输入] 证据:... -> 出现 1 次,下周复核

## 无法判定
- [检查 6 语义面] 缺:... -> 补法:...

## 基线数据
- 会话/cron/维护/无 tag/覆盖状态
- state 更新/未挂接项目/断指针/重复内容/inbox 停滞/cron 失败/取代冲突
```

---

## 这份 run 为什么合格

- 所有结论都有命令或字段证据,并区分列表行与逐页读回。
- 周 id、窗口和 `observed_through` 使用工作台本地周一,没有用执行当天冒充目标周。
- 来源计数是页数,维护改写单独排除,提醒次数不当写入次数。
- 指针以 `rel_path` 为主,Pointer 只作本机回退提示。
- 旧页找现行页只走反向边,候选正文方向必须核对。
- 历史旧产物被明确标注为历史证据,没有伪造新的历史来源,也没有把旧 slug 当当前目标。
- 没有在 retro 过程中修改规则、hub、skills 或资产本体。
