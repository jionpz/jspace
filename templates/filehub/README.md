# 文件管理中心 (Filehub)

这是你的 JSpace **文件管理中心**(资产层本体)。重资产(pdf / ppt / excel / md)归位在这里,**不进工作台 git**;同步走网盘 / Obsidian Sync。

> 本目录可被 Obsidian 作为 vault 打开。AI 只写纯 md 与相对链接,不依赖任何插件——哪天换工具,资料一点不坏。

## 结构(PARA 变体,最小起步,靠使用涌现细化)

- `_inbox/` — 新文件一律先落这里,等待整理。说一句「整理一下 inbox」即可批量归档。
- `projects/<项目>/` — 进行中的项目:`index.md`(dashboard)+ `docs/` `decks/` `data/` `notes/`
- `areas/<领域>/` — 长期职责域(无明确终点的工作)
- `archive/<年>/` — 结项与冷资料

## 结项归档

项目结项时,把 `projects/<x>/` 整个移入 `archive/<年>/`,并更新所属域 README 的挂接行。
**必须用户确认**——涉及移动文件,不自动执行。判定与动线见 `~/.agents/skills/jspace-use/SKILL.md` 第 8.6 节「退役与回收」(filehub 是独立目录,无工作台的 `.jspace/`;用户级 skills 由 `jspace skills install` 物化后任何位置可读);`jspace doctor` 的 `filehub.project_stale`(120 天未动)会提示候选。

## 命名

`YYYY-MM-DD-语义名-vN.ext` —— 机器可排序、人可扫读。

例:`2026-08-02-acme-kickoff-v1.pptx`、`2026-07-31-概率论第三章-v2.pdf`

## 项目 index.md 模板

每个项目一份 `projects/<项目>/index.md`,是人与 AI 共用的 dashboard;在归位/建项目时由 AI 创建。约定模板:

```markdown
---
type: project-index
project: <id>
tags: []
created: YYYY-MM-DD
---
# <项目名>

## 现状
...

## 关键文件
- [[docs/xxx|说明]]

## 下一步
- [ ] ...
```

## 同步

- 内容走**网盘整目录同步**或 **Obsidian Sync**,不进工作台 git。
- filehub 主路径经 `local.bindings` 绑定(绝对路径是本机真理,按机器各自维护);`jspace doctor` 对缺失路径仅告警。

## 使用

1. 把第一个文件丢进 `_inbox/`。
2. 说一句「整理一下 inbox」——AI 会改名、归位、登记 index、写入记忆。
3. 想查什么直接问,AI 会打开对应文件核对并给出处。
