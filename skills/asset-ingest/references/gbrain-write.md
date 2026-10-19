# asset-ingest — 入脑模板与纪律(gbrain-write)

## asset 指针页模板

```markdown
---
type: <descriptive metadata>  # 例如 reference / spreadsheet-summary；不用于路由
source: <harness>            # codex | claude | hermes | pi | manual(出处,不占用资产真实来源)
project: <project|area id>    # owner namespace；项目资产写 project id，area 资产写 area id
owner_kind: <project|area>    # 与 slug/rel_path 的 owner 一致
tags: [asset, source:session]  # 路由 tag asset + 来源 tag:会话内 source:session / 无头 cron source:cron
                               # 来源 tag 按运行模式选,纪律源见 jspace-use/references/gbrain.md「Provenance tag」
rel_path: <相对 filehub 根的路径>   # M5 起:机器无关指针标识(见下)
---
# <语义名>

**Source:** <文件绝对路径>    # 指针 = 本体;可选附 wikilink(文件中心可被 Obsidian 打开)
**Format:** <pdf/ppt/txt/md/book/excel>
**Created:** <日期>

## Summary
<是什么:一两句>

## Key Facts
- <关键事实 1>
- <关键事实 2>

## Pointer
<原文件绝对路径>
```

## 深度抽取(office)页内纪律

excel / ppt 走深度抽取(`~/.agents/skills/asset-ingest/references/deep-extract.md`)时,asset 指针页在此模板上补两条:

- `Key Facts` 只收**策展后的关键数字/表头要点**(精炼 ≤ ~10 条),不 dump 全量;数字带出处语境:`- 单价 32000 元/台 [Source: <rel_path>, Sheet 报价单 B2, YYYY-MM-DD]`。
- `Pointer` 后加一行抽取注记:`抽取: <伴生文件 rel_path>`(如 `projects/<项目>/2026-08-03-acme报价.extract.md`),全量数据可随时重开。

原则:**页内策展、伴生全量**。大表永远不进 gbrain 页(保持页精简与检索命中质量);抽取是派生数据,伴生文件删除安全(注记一并撤)。

## rel_path(机器无关指针,M5)

- **定义**:从 filehub 根到文件的**全相对路径**(如 `projects/<项目>/<YYYY-MM-DD>-<语义名>.txt`),不含根前缀。
- **计算**:`rel_path` = Pointer 减去 filehub 根绝对路径前缀。根 = `type: filehub` resource 的 primary path(经 `local.bindings` 解析的绝对路径)。
- **换机解析**:新机读其 `hub.json` 的 filehub primary path(根)→ 根 + `rel_path` = 新机 Pointer。`Pointer`(绝对路径)保留为本机真理,日常打开用;`rel_path` 是可移植部分。
- **存量页**:M5 演练起补 rel_path(演练给 2 个存量 reference 页补写);此后新写页一律带。

## slug 派生

- 规则:`assets/<project|area>/<语义名>`(与文件语义名绑定,不随手发明)。
- **版本化**:明确新版资产写**新页**,slug 含版本——`assets/<project|area>/<语义名>-vN`；新页正文写 `Supersedes: [[<旧 slug>]]`，旧页正文不改，另以完整页 + revision 的 CAS 只保留一个当前 `status:superseded`。旧页从此只作历史，不再参与当前 `rel_path`、owner、index 和重复指针校验；index 必须改指新页。
- 写页前用 `gbrain call get_page '{"slug":"<slug>","include_content":true}'` 查重；`page_not_found` 才新建。已存在且同内容 → 报告已有页并跳过；不同内容但无新版依据 → conflict；只有明确新版关系才升 `-vN`。
- 注:`assets/` 前缀为本 skill 命名空间,与 gbrain 文件资产路径不冲突(实证确认);若后续碰撞,在 M2 落地时检查。

结构化写入与读回:

```bash
gbrain call put_page '{"slug":"<slug>","content":"<full-page-markdown>","request_id":"<uuid>","source_id":"jspace:asset-ingest:<owner>/<topic>","content_origin":"inferred"}'
gbrain call get_page '{"slug":"<slug>","include_content":true}'
```

替换现有页时先读取 revision，再在 `put_page` JSON 中加 `expected_revision`；响应丢失先 `get_write_request`，不得换新 request id 重写。

`put_page` 不会替换已有 tags，而是合并 tags。重写已有页后若读回同时含 `source:session` 与 `source:cron`，用 `remove_tag` 删除不属于本次运行模式的一项（带读回的 `expected_revision` 和独立 request id），再读回确认只剩一个来源 tag。

## embedding 纪律

- 正常写页(不带 `embed_skip`)。
- **写失败并报 embedding 错误 = embedding 不可达探针** → 以 `embed_skip: true` 重写(写入必须成功)→ 检索降级 `gbrain query`(无 embedding 自动退化为关键词)/ `search` → 输出固定提示。
- 固定提示文本:`embedding 不可用,当前为关键词检索,中文命中率可能偏低`
- 首次启用(未 serve)阶段校验:`gbrain models doctor --json` 看 `embedding_config` + `embedding_reachability`;`gbrain doctor --json` 对 embeddings 仅粗粒度健康报告,不含这两个细粒度字段。
- serve 会话内:doctor 降级为文件系统检查,查不到 embedding → 以"写失败即探针"判断。
- **重写仍失败**(非 embedding 原因)→ 按"失败即停"处理,不留半成品页。
- 首次启用不因 embedding 缺失而失败(离线可移植);"默认必需"≠"缺失即失败"。

## 版本 / 删除

- **新版本资产 = 写新页**(append-only):新文件 `-vN` → 新 asset 页,slug 含版本,新页正文声明旧 slug。**绝不覆盖已有页**；旧页只做生命周期元数据 CAS。
- **指针修正**(唯一允许更新现有页 Source 的情形):文件仅移动位置、内容未变时,更新 Source 路径;内容有变化一律走新页。
- 归档/删除文件:reference 页指针可能陈旧;提供可选"失效提示"步,不强做自动清理(留给使用涌现)。

## type 纪律(继承 gbrain.md 约定)

- `type` 只是描述性元数据，不是合法性或角色过滤条件；分类由 slug + tags 承载（`assets/<归属>/` + `asset` tag）。
- 本 skill 写 asset 指针页,**不覆盖已有页**(新版本走 `-vN` 新页,旧页保留并注明 supersedes)。
- 资产真实来源(客户/网盘/邮件)放正文 Source 或 tags,不占用 frontmatter `source`(其语义 = harness 出处)。
