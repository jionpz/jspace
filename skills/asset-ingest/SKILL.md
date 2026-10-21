---
name: asset-ingest
description: "把一份工作资料(书籍/pdf/ppt/excel/报告)变成可召回的知识资产:本体归位文件中心 + 要点写进 gbrain asset 指针页。Use when 资料入库/整理 inbox/归位资料。Do NOT use for 会话进度写回(→memory-writeback)或用户主动问句召回(→memory-recall)。"
triggers:
  - "资料入库"
  - "整理 inbox"
  - "归位资料"
  - "把这份资料入库"
---

# asset-ingest — 资料转知识资产(写侧)

把资料变成“本体可打开、索引可核对、记忆可召回”的资产。AI 负责语义判断；CLI 负责路径、内容身份、独占创建、checkpoint 和清理证据。不要把“复制完成”“暂存完成”或“agent 说写好了”当成归档完成。

## 触发 / 非目标

- ✅ 用:单份资料入库、整理 `_inbox/`、把已确认的项目/领域资料归位。
- ❌ 不用:会话事实写回 → `memory-writeback`；用户问句召回 → `memory-recall`；机器级 harness 治理 → `harness-config`；旧工作台结构收编 → `jspace-adopt`。

## 输入与前置

必须能回答并留下证据:

- filehub 根已注册，source 位于 `<filehub>/_inbox/`。
- owner 唯一:已注册的 active project，或已存在且有 `index.md` 的 `areas/<id>/`。
- owner 的 `index.md` 可读；project 必须有 `layout: flat|workstream|period`，area 可沿用已有布局。
- 已检查 `profile/filing-prefs`、owner index、已有目录与同类资产；文件名和扩展名只能作线索。
- 已知目标 `rel_path`、`assets/<owner>/<semantic>` slug 与将被写入 index 的完整 line。

归属证据优先级固定为:本次用户明确指令 → registry/index/layout → 内容与既有资产交叉印证 → 已确认的归位偏好 → 历史纠正。仍无唯一 owner 时保留原件并报告缺什么，不猜。

## 权威引用

- 归位、命名、布局、偏好与冲突: `~/.agents/skills/asset-ingest/references/filing.md`
- asset 页结构、rel_path、版本与 embedding: `~/.agents/skills/asset-ingest/references/gbrain-write.md`
- 第 1/2/3 层证据与 CLI 证明: `~/.agents/skills/asset-ingest/references/filing.md`
- 批量与无头: `~/.agents/skills/asset-ingest/references/batch.md`
- office 抽取: `~/.agents/skills/asset-ingest/references/deep-extract.md`
- 存量移动: `~/.agents/skills/asset-ingest/references/migration.md`
- 共同记忆契约: `~/.agents/skills/jspace-use/references/gbrain.md`

入口只保留主流程；字段级规则以引用为准，不在这里维护第二套 schema。

## 写集

- 可写:filehub 目标文件及父级语义目录、owner `index.md` 的一行、gbrain asset page、必要的伴生 `.extract.md`、ingest journal、pending envelope。
- 不写:项目 state、项目任务系统、其他 owner 目录、跨项目复制、用户根治理文档、官方 skill 源码。
- 归位纠正属于 `profile/filing-prefs`，由 `memory-writeback` 写入；本 skill 只提交纠正事实并转交。

## 输出

每份资料必须报告:

| 字段 | 内容 |
|---|---|
| 结果 | committed / staged / duplicate / conflict / skipped / failed |
| owner | `project:<id>` 或 `area:<id>` |
| 本体 | filehub 相对路径 + 内容 hash 前缀 |
| 记忆 | asset slug + revision |
| 索引 | index 相对路径 + 精确登记行 |
| 未决 | 缺什么证据、原件现在在哪、下一步命令 |

批量模式另写 `<filehub>/.jspace-logs/inbox-batch.md`；无头模式只报告，不等待用户。

## 主流程

1. **读上下文**:读 owner `index.md`、`areas/*/index.md`、`gbrain` 中的 `profile/filing-prefs`（如存在）和既有目录。用 `jspace filehub check --json` 获取机械缺口。
2. **判 owner 与目录**:先定归属，再按该 owner 单一组织轴选根目录或稳定语义子目录。格式只进类型元数据，绝不创建 `docs`、`decks`、`data`、`notes` 一类形态目录。
3. **定身份**:语义名稳定、可扫读；同内容先查重；不同内容不覆盖。明确版本关系才使用 `-vN` 和新 slug，无法确认则 conflict。
4. **暂存本体**:source 留在 inbox，CLI 独占复制并生成 journal。

```bash
jspace ingest begin "<filehub>/_inbox/<file>" \
  --target "<owner-root>/<稳定目录或根>/<YYYY-MM-DD-语义名-vN.ext>" \
  --slug "assets/<owner-id>/<语义名[-vN]>" \
  --owner-kind <project|area> \
  --owner-id "<owner-id>" \
  --index-line "| <rel_path> | <document|deck|sheet|data|note> | <YYYY-MM-DD> | assets/<owner-id>/<语义名[-vN]> |"
```

5. **写 asset 页并读回**:按 `gbrain-write.md` 生成完整页，frontmatter 至少含 `project: <owner-id>`、`tags: [asset, source:session|cron]`、`rel_path: <filehub 相对路径>`、`source: <harness>`、`source_sha256: <journal targetHash>`（从 `jspace ingest status <journal-id> --json` 读，写 64 位小写 hex；不要带尖括号、注释或命令）；正文含 Summary、Key Facts、Pointer。调用 `put_page` 后必须 `get_page(include_content:true)` 读回；tags 是合并语义，若新旧来源 tag 同时存在，用 `remove_tag` CAS 清掉旧来源并再次读回。
6. **标 gbrain checkpoint**:只有真实页已读回且 slug/project/rel_path/tags 与 journal 一致，页含 `source_sha256` 时也等于 journal `targetHash`，才运行 `jspace ingest advance <journal-id> --gbrain`。
7. **登记索引**:编辑 owner `index.md`，加入与 `--index-line` 逐字相同的行；然后 `jspace ingest advance <journal-id> --index`。该命令会真实读取 index，不是登记声明。
8. **提交与清理**:`jspace ingest advance <journal-id> --complete` 会重新读 gbrain、重算 target/source hash、核对 index line，最后才移除 source；页 `source_sha256` 与 journal `targetHash` 或已记录 checkpoint 不一致时命令失败（exit 1），journal 停在 `index`，修页后重跑 `--complete`。
9. **验收**:`jspace ingest status <journal-id> --json` 为 committed；`jspace filehub check --json` 的 status 为 `ok` 且对本资产无新增 finding（含 warning：`source_digest_changed` / `source_digest_invalid` / `source_digest_unreadable`）；`memory-recall` 能按关键词命中。

### gbrain 写入最小请求

```bash
request_id="<fresh-uuid>"
jq -n \
  --arg slug "assets/<owner-id>/<语义名>" \
  --rawfile content page.md \
  --arg request_id "$request_id" \
  --arg source_id "jspace:asset-ingest:<owner-id>/<语义名>" \
  --arg content_origin inferred \
  '{slug:$slug,content:$content,request_id:$request_id,source_id:$source_id,content_origin:$content_origin}' \
  > request.json
gbrain call put_page "$(cat request.json)"
gbrain call get_page "$(jq -cn --arg slug "assets/<owner-id>/<语义名>" '{slug:$slug,include_content:true}')"
```

`content_origin` 按事实选择 `user_said` / `tool_output` / `inferred`；摘要推断不能标成 `user_said`。

## 自动归位与版本

- 同一 owner、组织轴明确、无查重冲突 → 自主选择或创建语义子目录，不逐件追问。
- 同内容已在 filehub 或已 committed journal 中出现 → 报告已有路径并跳过复制；跨项目共用用引用，不复制新本体。
- 同名不同内容且无版本证据 → 保留 source，报告 conflict；不得覆盖目标。
- 明确“修订/新版/替代” → 新文件名 `-vN`、新 slug、新页正文 `Supersedes: [[<old-slug>]]`，旧页正文不改并按 CAS 追加 `status:superseded`。
- 仅移动文件、内容 hash 不变 → 修正现有 asset 页的 `rel_path` / Pointer，使用读到的 revision 做条件替换，不创建新版本。
- 无头模式遇到歧义 → 留在 inbox，报告 owner/命名/版本缺口，不等待、不猜。

## pending 交接

gbrain 锁冲突、超时或响应丢失时，不得让 journal 越过 `staged`:

```bash
jspace pending stage "assets/<owner-id>/<语义名>" \
  --content page.md \
  --producer asset-ingest \
  --intent create \
  --origin inferred
jspace pending apply
```

- 只有 `pending apply` 输出 committed、且 `get_page` 读回一致后，才继续 `ingest advance --gbrain`。
- `staged`、`terminal_failed`、applied 但未读回都不等于完成。
- 已有页更新使用 `--intent replace --expected-revision <stage-时 revision>`；绝不实时重取 revision 冒充基线。

## 完成证据

必须同时成立:

- target 存在且哈希等于 journal 的 source/target 身份；
- index 含精确计划行，target 与 slug 归属一致；
- gbrain page 可读回，revision/标签/owner/rel_path 与 evidence 一致；
- journal 为 `committed`，且 source 已按 hash 核对后清理；
- 报告中的本体、index、slug 三者可互相定位。

任一缺失只能报 `staged`、`partial`、`conflict`、`cleanup-pending` 或 `failed`。

## 失败与恢复

- `begin` 报 target exists → 不覆盖；比较内容后选择 duplicate、版本或人工冲突。
- gbrain 写入失败但未产生 live 页 → 可按 `staged` 失败路径 `jspace ingest fail` 或 `jspace ingest rollback`；source 保留。
- 已产生 live 页但 checkpoint 未推进 → 不 fail/rollback；重新读回并通过 `advance --gbrain` 续接，避免孤儿页。
- index 写入失败 → 保留 journal，修正 index 后重试 `advance --index`。
- `failed/cleanup-pending` → 只重试 `jspace ingest advance <id> --complete`；不要 rollback/fail。
- source 或 target 在处理中变化 → 保留双方，报告 hash 变化并重新判断。
- 半完成的抽取伴生文件 → 保留本体与已写页，标注 partial；不得删除 source。

## 转交

- 用户纠正归位 → `memory-writeback` 写 `profile/filing-prefs`，再用纠正后的计划重试。
- 资料尚未入库就要回答 → `memory-recall` 明示未入库，不伪造证据。
- owner 未注册、filehub 未绑定或 harness 未接线 → `jspace-use`。
- 旧目录整体收编 → `jspace-adopt`；本 skill 只处理已获准的单项/批量入库。

## 按需深入

- Golden run: `~/.agents/skills/asset-ingest/references/example-ingest.md`
- 批量: `~/.agents/skills/asset-ingest/references/batch.md`
- 抽取: `~/.agents/skills/asset-ingest/references/deep-extract.md`
- 存量迁移: `~/.agents/skills/asset-ingest/references/migration.md`

## 自检

```bash
jspace ingest list
jspace ingest status <journal-id> --json
jspace filehub check --json
gbrain call get_page '{"slug":"assets/<owner-id>/<语义名>","include_content":true}'
```
