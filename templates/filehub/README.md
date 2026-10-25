# 文件管理中心 (Filehub)

这是你的 JSpace **文件管理中心**(资产层本体)。重资产(pdf / ppt / excel / md)归位在这里,**不进工作台 git**;同步走网盘 / Obsidian Sync。

> 本目录可被 Obsidian 作为 vault 打开。AI 只写纯 md 与相对链接,不依赖任何插件——哪天换工具,资料一点不坏。

<!-- JSPACE:FILEHUB:START -->
> filehub-contract-version: 8

## 归档契约

**目录回答"属于哪项工作、哪个稳定阶段";文件类型只做元数据。** 同一份资料只有一个规范位置。

```text
filehub/
  _inbox/             # 新文件先落这里,等待整理
  projects/<项目>/    # index.md + 资产,可按真实浏览需要局部组织
  areas/<领域>/       # 长期职责域;必须有 index.md 才能接收入库
  archive/<年>/       # 结项与冷资料
```

### 项目组织

每个项目必须有 `index.md`:登记资产、说明收录范围。目录如何分层由归属和真实浏览需要决定:

- 文件少时直接放项目根;某一类资料形成稳定集合、或直接子项过多时,再建语义子目录。
- 同一层级只用一种组织轴(工作流/阶段、年份、周期),不要同层混用。
- 完整的工程套件可以保留内部结构;由 `index.md` 指向其入口,不为了"看起来整齐"拆散带自身引用、配置和代码入口的套件。
- 旧 `layout: flat | workstream | period` 字段仍可读,作为布局说明;不再是必填声明,也不再限制目录形状。未知值仍会报错。
- 目录按归属和用途起名,不按文件格式起名;但已有的历史目录名不会因此被判定为错误或自动移动。

### 类型与索引

文件类型由扩展名、项目 `index.md` 的类型列和 gbrain asset 页共同表达。`index.md` 至少登记:

| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| `<相对路径>` | `document / deck / sheet / data / note` | `YYYY-MM-DD` | `assets/...` |

跨项目引用用链接,不复制文件本体。引用资料用普通链接单列,不要写进上面的拥有表。

项目内的套件、Agent 治理和运行支撑文件不是独立资产。由 owner `index.md` 的
`support_paths` 显式声明(相对 owner 根,可指向文件或整个稳定目录):

```yaml
support_paths:
  - project-context.md
  - mcp-server/
```

支撑路径仍受 owner 边界、存在性与 index 登记冲突检查;不能用它隐藏普通资料或跨 owner 排除文件。

### 资料包 (bundle)

一组必须保持内部引用与成员字节的资料(工程套件、图表集合)可以整体入库,而不是拆成独立资产:

- 入口是一个包内常规文件(如 `README.md`),同时是 gbrain 页的 `rel_path` 与 owner index 的登记目标;当前表该行类型写 `bundle`。
- manifest 在包外,由 JSpace 管理:`<owner 根>/.jspace/bundles/<sha256(slug)>.json`。不要手改或移动;它记录按 UTF-8 字节序排序的成员、大小、摘要、可执行位与整树聚合 `aggregateSha256`。
- asset 页除 `rel_path` 外还写 `asset_kind: bundle`、`bundle_root`、`bundle_manifest`、`bundle_sha256`、`bundle_manifest_sha256`;`source_sha256` 仍是入口文件摘要。
- 只有 manifest 身份、入口摘要与整棵树逐成员双向比较全部通过,包内文件才豁免普通无索引/重复内容检查;任一失败(多文件、少文件、改字节、manifest 损坏)整包退回普通扫描并报错,不能只报"包存在"。
- 入库拒绝符号链接、特殊文件、受限路径(密钥/凭据)与超过固定预算的包(10,000 成员、2 GiB 文件字节、深度 32);拒绝时不回显敏感成员路径。
- 完成后 `_inbox` 原件保留(`sourcePolicy: retain`),待用户显式清理;同一身份重复入库返回 duplicate,不产生第二份。
- 引用锁 `bundle-sha256:<aggregate>` 只有在指向已验证包时才比较;没有已验证包覆盖时明确标 unverified。

### 历史与引用

`index.md` 的当前表回答"这个 owner 现在拥有什么"。曾经拥有和只是引用别处资料的两类条目,分别写进独立受管块,不混进当前表:

```markdown
<!-- JSPACE:ASSET-HISTORY:START -->
- [2026-07-31-概率论第三章-v2.pdf](2026-07-31-概率论第三章-v2.pdf) — `assets/<owner>/<语义名>`
<!-- JSPACE:ASSET-HISTORY:END -->

<!-- JSPACE:ASSET-REFERENCES:START -->
- [外部资料](./other/doc.pdf) — `assets/<owner>/<语义名>` `sha256:<64 位小写 hex>`
<!-- JSPACE:ASSET-REFERENCES:END -->
```

- **历史**:本 owner 曾经持有、现在退场的资产。每条必须是一个本地 Markdown 链接 + 一个反引号包住的严格 `assets/<owner>/<语义名>` slug;对应 gbrain 页必须是非现行状态(`status:superseded|deprecated|archived`)且 `rel_path` 指向同一文件。只有完整验证过的历史行才豁免该路径的"无索引"提示;页仍活跃、路径不符、文件缺失或只是普通链接都不算证明。
- **引用**:资料由别处拥有,这里只导航。引用永不提供 ownership,也永不豁免"无索引"。本地目标必须存在,不可经 symlink 逃逸或指向受限路径;可选的 `<slug> + sha256` 锁证明引用时看到的字节;`bundle-sha256` 仅在目标被已验证资料包覆盖时与整树聚合比较,否则明确报未验证;外部 URL 不抓取,只标 unverified。块外的普通链接仍可读,但只算部分引用覆盖。
- 同一路径或 slug 不能同时出现在当前表与历史块。

### 派生导航

根 `README.md` 与 `projects/README.md` 各有一个由 registry 生成的受管块(`JSPACE:FILEHUB:NAV:*`):活跃项目、长期主题、完整项目目录(含"待补归属")。它们只是视图:

```bash
jspace filehub refresh [--dir <workbench>] [--dry-run] [--json]
```

- 只重算这两个块,按 UTF-8 字节序稳定排序,不写时间戳;块外用户文字逐字节保留。
- 先预检两个文件(坏标记、symlink、非 UTF-8、并发修改全部拒绝),通过后才写;`projects/README.md` 先写、根 README 最后写。
- `jspace filehub check` 只读比较并报告 missing / stale / malformed;`filehub upgrade` 只维护归档契约块,永不碰导航块。

### 周期产物

周报默认 `areas/周报/<Monday>-周报.md`,slug 为 `assets/周报/<Monday>`;`areas/周报/index.md`
是该 area 的 owner index,同周只保留一行登记。位置先由
`jspace filehub weekly-path --week <Monday> --json` 裁决:

- `default`:没有既有记录,用默认路径(首次先把 area index 建好)。
- `reuse`:index 已登记唯一的年份位置(如 `areas/周报/<year>/...`)时复用,不按运行日期另开。
- `conflict`:根/年双份、索引与文件不一致、索引损坏或同名文件未登记时停止并报告,不再写第三份。

### 旧结构

历史目录名(如 docs、decks、data、notes)不再被判定为违规,也不会被自动移动。需要整理时按 `asset-ingest/references/migration.md` 显式、逐文件处理,可回滚。

### 结项

用 `jspace project set-status <id> --status archived` 原地结束:资产路径、文件和 gbrain 页保持有效,项目从活跃导航移出。恢复用 `--status active`。物理移入 `archive/<年>/` 是单独的显式迁移,不在关闭动作里自动执行。
<!-- JSPACE:FILEHUB:END -->

## 命名

建议 `YYYY-MM-DD-语义名-vN.ext` —— 机器可排序、人可扫读。

例:`2026-08-02-acme-kickoff-v1.pptx`、`2026-07-31-概率论第三章-v2.pdf`

原生制品、上游版本号、工程包内部路径保持原名,不强制改写。

## 项目 index.md 模板

每个项目一份 `projects/<项目>/index.md`,是人与 AI 共用的 dashboard;在归位/建项目时由 AI 创建。约定模板:

```markdown
---
type: project-index
project: <id>
support_paths: []
tags: []
created: YYYY-MM-DD
---
# <项目名>

## 收录范围
- 收:...
- 不收:...

## 现状
...

## 关键文件
| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| [[2026-08-01-xxx-v1.pdf|说明]] | document | 2026-08-01 | assets/<id>/<语义名> |

## 下一步
- [ ] ...
```

## area index.md 模板

每个 area 必须有 `index.md`,说明它收什么、不收什么。没有可读 index 的 area 不能接收入库:

```markdown
---
type: area-index
owner: <area-id>
tags: []
---
# <领域名>

## 收录范围
- 收:...
- 不收:...
```

## 结项归档

优先用 `jspace project set-status <id> --status archived` 原地关闭。
确需物理归档时,把 `projects/<x>/` 整体移入 `archive/<年>/` 并同步更新 registry 与索引;
这是显式迁移,**必须用户确认**,不自动执行。`jspace doctor` 的 `filehub.project_stale`(120 天未动)会提示候选。

## 同步与维护

- 内容走**网盘整目录同步**或 **Obsidian Sync**,不进工作台 git。
- filehub 主路径经 `local.bindings` 绑定(绝对路径是本机真理,按机器各自维护);`jspace doctor` 对缺失路径仅告警。
- 归档契约升级是显式动作:`jspace filehub upgrade [path] --dry-run`。它只更新上方 managed block,不移动资产。

## 使用

1. 把第一个文件丢进 `_inbox/`。
2. 说一句「整理一下 inbox」——AI 会定归属、改名、登记 index、写入记忆。
3. 想查什么直接问,AI 会打开对应文件核对并给出处。
