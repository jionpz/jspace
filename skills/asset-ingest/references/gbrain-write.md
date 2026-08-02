# asset-ingest — 入脑模板与纪律(gbrain-write)

## reference 页模板

```markdown
---
type: reference
source: <harness>            # codex | claude | hermes | pi | manual(出处,不占用资产真实来源)
project: <project|area id>
tags: [t1, t2]
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

## slug 派生

- 规则:`assets/<project|area>/<语义名>`(与文件语义名绑定,不随手发明)。
- **版本化**:新版本资产写**新页**,slug 含版本——`assets/<project|area>/<语义名>-vN`,旧页保留并在新页注明 `supersedes: <旧 slug>`。
- 写页前 `gbrain get <slug>` 查重;已存在 → 询问用户:跳过 / **修复**(同名同内容重入,允许覆盖错页)/ 升版本(`-vN`,写新页)。
- 注:`assets/` 前缀为本 skill 命名空间,与 gbrain 文件资产路径不冲突(实证确认);若后续碰撞,在 M2 落地时检查。

## embedding 纪律

- 正常写页(不带 `embed_skip`)。
- **写失败并报 embedding 错误 = embedding 不可达探针** → 以 `embed_skip: true` 重写(写入必须成功)→ 检索降级 `gbrain query`(无 embedding 自动退化为关键词)/ `search` → 输出固定提示。
- 固定提示文本:`embedding 不可用,当前为关键词检索,中文命中率可能偏低`
- bootstrap(未 serve)阶段校验:`gbrain models doctor --json` 看 `embedding_config` + `embedding_reachability`;`gbrain doctor --json` 对 embeddings 仅粗粒度健康报告,不含这两个细粒度字段。
- serve 会话内:doctor 降级为文件系统检查,查不到 embedding → 以"写失败即探针"判断。
- **重写仍失败**(非 embedding 原因)→ 按"失败即停"处理,不留半成品页。
- bootstrap 不因 embedding 缺失而失败(离线可移植);"默认必需"≠"缺失即失败"。

## 版本 / 删除

- **新版本资产 = 写新页**(append-only):新文件 `-vN` → 新 reference 页,slug 含版本,旧页保留并注明 `supersedes`。**绝不覆盖已有知识页**。
- **指针修正**(唯一允许更新现有页 Source 的情形):文件仅移动位置、内容未变时,更新 Source 路径;内容有变化一律走新页。
- 归档/删除文件:reference 页指针可能陈旧;提供可选"失效提示"步,不强做自动清理(留给使用涌现)。

## type 纪律(继承 gbrain.md 约定)

- `reference`/`lesson` = 知识(append-only);`decision`/`note` = 记忆(固定 slug 覆盖写)。
- 本 skill 写 `reference` 页(知识),**不覆盖已有知识页**。
- 资产真实来源(客户/网盘/邮件)放正文 Source 或 tags,不占用 frontmatter `source`(其语义 = harness 出处)。
