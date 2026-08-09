# JSpace Workbench

本目录由 JSpace CLI (`jspace init`) 生成，是日常工作的控制平面；它不是 JSpace 开发仓库。

## 结构

**位置即所有权**:入口面在根,其余一律在 `.jspace/`。

- 根目录(入口面 + 用户区):
  - `AGENTS.md` - 你的文件:`<!-- JSPACE:START -->…<!-- JSPACE:END -->` 块内是 JSpace 规则(init 嵌入、upgrade 只更新块内),块外内容归你,永不覆盖
  - `CLAUDE.md` / `README.md` / `.gitignore` / `.claude/settings.json` - 入口文件(未修改随升级刷新,本地修改保留)。`CLAUDE.md` 内容为 `@AGENTS.md` 导入,让 Claude Code 通过官方 memory 通道加载工作台路由
  - `workspace/` - 域目录（初始不预建；按 AGENTS.md 的 Domain Governance 从真实使用涌现，首个域创建时生成）
  - `skills/` - 用户自建技能保留地（需用户确认；官方技能不在根目录）
  - `.claude/skills/` - 官方 skill 的 Claude Code 同字节投影（机器托管；勿手工编辑，改动会产生 `skills.projection_drift` 告警）
  - `.agents/skills/` - 官方 skill 的项目级多 harness 同字节投影（机器托管；同 `.claude/skills/` 纪律，用户级 `~/.agents/skills/` 由 `jspace skills install` 物化）
- `.jspace/`(JSpace 管理区):
  - `hub.json` - domain/resource/project 注册表(**用户数据**;升级永不覆盖;缺失时重建空注册表)
  - `cron.json` - 声明式 cron 定义(**用户数据**;升级永不覆盖;删除即停用,不复活)
  - `skills/` - 官方打包技能(seed;未修改随升级刷新,本地修改保留)
  - `marker.json` / `local.json` / `logs/` / `state/` - 机器状态(git 忽略;本地/日志/升级 journal)

## 目录边界与升级范围

`jspace workspace upgrade` 只动**材料化清单(manifest)内的文件**,其余一概不碰。按位置与所有权分四类:

| 位置 | 所有权 | 升级行为 |
| --- | --- | --- |
| 根 `AGENTS.md` | 块内 = managed / 块外 = user | 只对比并更新 `<!-- JSPACE:START -->…<!-- JSPACE:END -->` 块内文本(整文件备份 + rollback);块外内容永不触碰。块相同 → `no-op` |
| 根 `README.md`/`.gitignore`/`CLAUDE.md`/`.claude/settings.json`、`.jspace/skills/`、`.claude/skills/`、`.agents/skills/` | seed(模板) | **未修改**随升级刷新;**本地修改过**的一律保留(显示 `skip`,不阻断) |
| `.jspace/hub.json`、`.jspace/cron.json` | user(数据) | **永不覆盖**;schema 演进走迁移。hub.json 缺失时升级重建空注册表;cron.json 删除即视为停用,升级不复活 |
| `.jspace/marker.json`/`local.json`/`logs/`/`state/` | machine(状态) | 机器生成/重写,不进替换范围 |

**用户预留区**:`workspace/`、`filehub/` 以及工作台根目录下任何不在上面清单内的文件夹(如你自己建的 `notes/`、`drafts/`)——升级永不触碰。判断方法:`jspace workspace diff --json` 看每条 action,`skip`/`no-op` 即升级不动。

## 使用

1. 先读 `AGENTS.md`。
2. 安装用户级 skills(多 harness 统一位置,SKILL.md 引用的 `~/.agents/skills/` 文档在此物化):`jspace skills install`(幂等;`--refresh` 更新过期副本)。
3. 首次使用按 `.jspace/skills/jspace-use/SKILL.md` 使用指南配置 gbrain、接线所选 AI harness,并了解日常路由/维护。
4. 用 JSpace CLI 校验本目录（`jspace` 为编译二进制，需在 PATH 上；源码检出则运行 `bun run cli/main.ts`）：

```bash
jspace doctor --dir .
```

## 与开发仓库的关系

本工作台是生成物，不是 JSpace 开发仓库。默认不注册 dev-repo 链接；如需维护 JSpace 的 CLI/模板/技能，到开发仓库按其 `AGENTS.md` 流程操作，并可用 `jspace domain add` / `jspace resource add` 手动登记链接。

## 资产管理(跟踪新项目)

重资产(pdf/ppt/excel/md)归位在**文件中心(filehub)**——独立目录,由 `jspace filehub init` 生成并注册(`type: filehub` resource),可作 Obsidian vault 打开;内容走网盘/Obsidian Sync,不进本工作台 git。协议见 filehub 根 `README.md` 与 `.jspace/skills/asset-ingest/`。

**跟踪一个新项目 = 三步**:

1. 资产层建 `filehub/projects/<项目>/index.md`(dashboard:现状 / 关键文件表 / 下一步);
2. 所属域 README「本域进行中的项目」表挂一行;
3. 记忆层建实体(gbrain,记录项目事实与指针)。

新资料一律先落 `filehub/_inbox/`,说一句「整理一下 inbox」批量归档。

## 任务管理

本工作台不内置任务管理。如需任务管理，可在工作台运行 `trellis init` 初始化。
