---
name: asset-ingest
description: "将工作资料(书籍 pdf/ppt/txt/md、excel、报告)转化为可召回的知识资产:归位到文件中心 + 写 gbrain reference 页 + 中文语义召回。复用 gbrain 现成检索能力,遵守 JSpace 记忆/知识纪律。Use when the user asks to file a document, tidy the inbox, or turn a resource into knowledge."
triggers:
  - "资料入库"
  - "整理 inbox"
  - "归位资料"
  - "把这份资料入库"
---

# asset-ingest — 资料转知识资产

把一份资料变成"可召回的知识资产":**本体归位到文件中心 + 要点写进 gbrain**。调用 gbrain 现成检索能力,skill 只负责 JSpace 侧纪律(归位、命名、type 映射、写回)。

## 前置

- **文件中心**:读 `hub.json` 中 `type: filehub` 的 resource,取其 `primary: true` 的 path entrypoint 作为根(`filehub/`)。
  - 未注册 → 用**降级暂存区**:工作台同级、不进 git 的 `../<workbench>-inbox/`(或用户指定目录),并提示"待文件中心注册为 type=filehub 后正式归位"。
- **gbrain**:经 CLI 或 MCP 操作;brain 被 `gbrain serve` 持锁时按其提示处理,不绕过锁。
- 归档纪律:按**主要内容物**归档、不按格式(源自 gbrain `_brain-filing-rules.md`;本 skill 细则见 `references/filing.md`)。

## 步骤

### 1. 识别
- 确定类型:pdf / ppt / txt / md / book / excel。
- 判断归属:项目产出 → `projects/<项目>/`;书籍/领域资料 → `areas/<领域>/`。
- **查重**:检查目标目录同名/同语义文件,以及 `gbrain get assets/<项目|领域>/<语义名>` 是否已建页。
  - 已存在 → 询问用户:跳过 / **修复**(同名同内容重入,允许覆盖错页)/ 升版本(`-vN`,写新页、旧页保留并注 supersedes)。

### 2. 归位
- 命名:`YYYY-MM-DD-语义名-vN.ext`(机器可排序、人可扫读)。
- 移动到目标目录(`projects/<项目>/...` 或 `areas/<领域>/...`)。

### 3. 入脑
- 写 gbrain reference 页(slug `assets/<项目|领域>/<语义名>`,与文件语义名绑定):
  - frontmatter:`type: reference` / `source: <harness>` / `project: <id>` / `tags`
  - 正文:`Summary` + `Key Facts` + `Pointer`(文件**绝对路径**)
- **embedding**:正常写(不带 embed_skip);若**写失败并报 embedding 错误** → 以 `embed_skip: true` 重写(写入必须成功),随后检索降级并提示。

### 4. 登记
- 项目 `index.md` 挂一行:文件名 + 日期 + gbrain slug(areas 是否建 index 按 filing.md:由使用涌现,不预先设计)。

### 5. 召回自检(必做)
- `gbrain query <关键词>` 确认命中;未命中 → 检查 slug / tags / embedding。

### 6. (可选,用户要求时)深入
- `strategic-reading`:纯 markdown skill,会话内可执行 → 产出 playbook。
- `book-mirror`:CLI 命令,serve 持锁时阻塞、需 Anthropic 子代理与成本确认;不在常规路径。
- `media-ingest`:serve 会话内经 MCP `file_upload`(其 Phase 2 CLI 被锁阻塞);MVP 不 invoke。
- 需要时按 gbrain 提示操作。

## 纪律

- **失败即停**:任一步失败 → 停止、向用户报告具体原因,不留下半成品(put 前归位完成;put 失败不产生孤儿 reference)。
- **本体不复制进 gbrain**:指针 = reference 页 Source 字段(绝对路径)。不依赖 `files upload-raw`(小文件为 no-op)。
- **embedding 不可用时固定提示**:`embedding 不可用,当前为关键词检索,中文命中率可能偏低`(不得静默)。
- **逐份处理**:MVP 每次一份资料,会话可循环调用;批量自动化留给 M2。

## 参考

- `references/filing.md` — 归位/命名/类型策略/文件中心定位/降级
- `references/gbrain-write.md` — 入脑模板 + slug 派生 + embedding 降级 + type 纪律
