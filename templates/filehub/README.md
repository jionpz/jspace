# 文件管理中心 (Filehub)

这是你的 JSpace **文件管理中心**(资产层本体)。重资产(pdf / ppt / excel / md)归位在这里,**不进工作台 git**;同步走网盘 / Obsidian Sync。

> 本目录可被 Obsidian 作为 vault 打开。AI 只写纯 md 与相对链接,不依赖任何插件——哪天换工具,资料一点不坏。

<!-- JSPACE:FILEHUB:START -->
> filehub-contract-version: 2

## 归档契约

**目录回答"属于哪项工作、哪个稳定阶段";文件类型只做元数据。** 同一份资料只有一个规范位置。

```text
filehub/
  _inbox/             # 新文件先落这里,等待整理
  projects/<项目>/    # index.md + 扁平文件,或单一稳定组织轴下的子目录
  areas/<领域>/       # 长期职责域,不按文件格式分目录
  archive/<年>/       # 结项与冷资料
```

### 项目组织

每个项目必须有 `index.md`,并在 frontmatter 声明一种组织方式:

```yaml
layout: flat | workstream | period
```

- `flat`: 文件较少时直接放项目根。
- `workstream`: 按稳定工作流/阶段分组,如 `kickoff/`、`delivery/`、`合同/`。
- `period`: 按稳定周期分组,如 `2026-Q3/`。
- 同一层级只能使用一种组织轴;不得同时混用工作流、周期或文件格式。
- 不为单个文件机械建目录。只有同一稳定组已形成明显集合,或直接子项过多影响浏览时,才创建语义目录。
- **禁止**把 `docs/`、`decks/`、`data/`、`notes/` 等文件形态作为归档目录。类型写入 `index.md`,不写进路径。

### 类型与索引

文件类型由扩展名、项目 `index.md` 的类型列和 gbrain asset 页共同表达。`index.md` 至少登记:

| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| `<相对路径>` | `document / deck / sheet / data / note` | `YYYY-MM-DD` | `assets/...` |

跨项目引用用链接,不复制文件本体。

### 旧结构迁移

已有 `docs/ decks/ data/ notes/` 不会被自动移动。先运行 `jspace doctor` 获取只读提示,再按 `asset-ingest/references/migration.md` 逐文件确认、移动并更新 `index.md` 与 gbrain 指针。迁移必须用户确认,可逐文件回滚。
<!-- JSPACE:FILEHUB:END -->

## 命名

`YYYY-MM-DD-语义名-vN.ext` —— 机器可排序、人可扫读。

例:`2026-08-02-acme-kickoff-v1.pptx`、`2026-07-31-概率论第三章-v2.pdf`

## 项目 index.md 模板

每个项目一份 `projects/<项目>/index.md`,是人与 AI 共用的 dashboard;在归位/建项目时由 AI 创建。约定模板:

```markdown
---
type: project-index
project: <id>
layout: flat
tags: []
created: YYYY-MM-DD
---
# <项目名>

## 现状
...

## 关键文件
| 文件 | 类型 | 日期 | gbrain slug |
|---|---|---|---|
| [[2026-08-01-xxx-v1.pdf|说明]] | document | 2026-08-01 | assets/<id>/<语义名> |

## 下一步
- [ ] ...
```

## 结项归档

项目结项时,把 `projects/<x>/` 整个移入 `archive/<年>/`,并更新所属域 README 的挂接行。
**必须用户确认**——涉及移动文件,不自动执行。判定与动线见 `~/.agents/skills/jspace-use/SKILL.md` 第 8.6 节「退役与回收」;`jspace doctor` 的 `filehub.project_stale`(120 天未动)会提示候选。

## 同步与维护

- 内容走**网盘整目录同步**或 **Obsidian Sync**,不进工作台 git。
- filehub 主路径经 `local.bindings` 绑定(绝对路径是本机真理,按机器各自维护);`jspace doctor` 对缺失路径仅告警。
- 归档契约升级是显式动作:`jspace filehub upgrade [path] --dry-run`。它只更新上方 managed block,不移动资产。

## 使用

1. 把第一个文件丢进 `_inbox/`。
2. 说一句「整理一下 inbox」——AI 会改名、按 `layout` 归位、登记 index、写入记忆。
3. 想查什么直接问,AI 会打开对应文件核对并给出处。
