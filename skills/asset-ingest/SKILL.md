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

- **文件中心**:读 `.jspace/hub.json` 中 `type: filehub` 的 resource,取其 `primary: true` 的 path entrypoint 作为根(`filehub/`)。
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
  - frontmatter:`type: reference` / `source: <harness>` / `project: <id>` / `tags` / `rel_path`
  - 正文:`Summary` + `Key Facts` + `Pointer`(文件**绝对路径**)
- **rel_path 计算(M5)**:`rel_path` = Pointer 减去 filehub 根前缀(根 = `hub.json` 的 `type: filehub` resource primary path);换机时按「新机根 + rel_path」重解析。
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

## 批量模式(整理一下 inbox)

一次性处理 `_inbox/` 存量。与单文件共用同一套纪律(步骤 1-5),外层加「两遍式 + 幂等 + 汇总 + 日志」。触发:「整理一下 inbox」「批量整理」。无头/定时(cron)用同一模式,只跑第一遍。细则见 `references/batch.md`。

### 0. 定位 inbox
- 读 `.jspace/hub.json` 中 `type: filehub` resource 的 `primary: true` path → `<根>/_inbox/`。
- 未注册 → 降级暂存区(工作台外 `../<workbench>-inbox/`)。可用 `jspace inbox status` 预检。
- 空 inbox → 报告"无事可做",结束。

### 1. 处理前排除(可选)
- 用户指定「这个别动」的文件/模式 → 加入 skip 清单,本轮不处理。

### 2. 第一遍(确定性,零提问)
- 遍历 inbox 剩余文件(排除 `.processing` 已完成项、skip 清单、点文件)。
- 每个文件判断**确定性**:类型明确(pdf/ppt/txt/md/excel)且归属可判(项目/领域)且无查重冲突(`gbrain get assets/<项目|领域>/<语义名>` 未存在)且命名可直接提取。
  - 确定性 → 逐份走「步骤 1-5」,零提问,单文件原子性(该份失败即停、报告、不留半成品)。
  - 不确定 → 记入第二遍清单(附「不确定点」:归属?命名?查重冲突?类型?)。
- 处理前写 `.processing` 标记(瞬态锁),成功或失败都删除;失败的文件留在 `_inbox/` + 原因记日志 → 下次批量(含 cron 无头)自然重试(中断可续跑,不重复已完成项)。

### 3. 第二遍(模糊项,人工过目)
- 把第二遍清单列成**短清单**一次给用户过目,每项:跳过 / 改归属 / 改命名 / 升版本 / 覆盖。
- 用户确认后再处理;无头模式跳过本步(模糊项留清单,等用户在场时处理)。

### 4. 汇总与校验
- 报告:成功 / 跳过 / 失败 + 原因 + 计数对比(批量前后 `_inbox/` 数一致)。
- 召回自检:每份(或抽样)贴出实际 `gbrain query <关键词>` 输出(不得静默)。

### 5. 人工纠错(处理后)
- 用户指出某份归错/命名不当 → 「撤销本次」(移回 `_inbox/`,删/标注 gbrain 页、撤销 index 行)或「重跑该份」(修复语义,允许覆盖错页)。

### 无头模式(cron / `-p`)
- 只跑第一遍(确定性),不提问、不等待;模糊项留清单。
- 写执行日志到 `<filehub>/.jspace-logs/inbox-batch.md`(时间/输入计数/成功/跳过/失败/逐文件结果),供下次会话检查(对接 M3 失败可见性)。

## 纪律

- **失败即停**:任一步失败 → 停止、向用户报告具体原因,不留下半成品(put 前归位完成;put 失败不产生孤儿 reference)。
- **本体不复制进 gbrain**:指针 = reference 页 Source 字段(绝对路径)。不依赖 `files upload-raw`(小文件为 no-op)。
- **embedding 不可用时固定提示**:`embedding 不可用,当前为关键词检索,中文命中率可能偏低`(不得静默)。
- **逐份处理**:单文件模式每次一份(会话可循环);批量模式见「批量模式」与 `references/batch.md`。

## 参考

- `references/filing.md` — 归位/命名/类型策略/文件中心定位/降级
- `references/gbrain-write.md` — 入脑模板 + slug 派生 + embedding 降级 + type 纪律
- `references/batch.md` — 批量模式细则(两遍式、幂等、日志、无头)
