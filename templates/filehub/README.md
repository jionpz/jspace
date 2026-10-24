# 文件管理中心 (Filehub)

这是你的 JSpace **文件管理中心**(资产层本体)。重资产(pdf / ppt / excel / md)归位在这里,**不进工作台 git**;同步走网盘 / Obsidian Sync。

> 本目录可被 Obsidian 作为 vault 打开。AI 只写纯 md 与相对链接,不依赖任何插件——哪天换工具,资料一点不坏。

<!-- JSPACE:FILEHUB:START -->
> filehub-contract-version: 5

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
