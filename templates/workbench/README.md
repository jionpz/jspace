# JSpace Workbench

本目录由 JSpace CLI (`jspace init`) 生成，是日常工作的控制平面；它不是 JSpace 开发仓库。

## 结构

- `.jspace/hub.json` - domain/resource/project 注册表(portable;**用户数据**,由 CLI 维护;升级永不覆盖)
- `.jspace/cron.json` - 声明式 cron 定义(portable;**用户数据**,由 CLI 维护;升级永不覆盖)
- `.jspace/marker.json` - 初始化标记(portable,含 workbench_id;机器维护)
- `.jspace/local.json` - 本机状态(安装实例 id + 路径绑定;git 忽略,init 生成)
- `.jspace/logs/` - 执行日志(cron / 无头批量;git 忽略)
- `.jspace/state/` - 运行时状态槽(升级 journal / 材料化记录;git 忽略)
- `.jspace/skills/` - 官方打包技能(`jspace init` 物化;升级刷新未改动副本、保留本地修改)
- `AGENTS.md` - 工作模式操作规则
- `workspace/` - 域目录（初始不预建；按 AGENTS.md 的 Domain Governance 从真实使用涌现，首个域创建时生成）
- `skills/` - 用户自建技能保留地（需用户确认；官方技能不在根目录）
- `.gitignore` - 忽略 `.jspace/logs/`、`.jspace/local.json`、`.jspace/state/`

## 目录边界与升级范围

`jspace workspace upgrade` 只动**材料化清单(manifest)内的文件**,其余一概不碰。三类所有权:

| 类别 | 含义 | 升级行为 |
| --- | --- | --- |
| `seed`(模板) | 可定制的模板文件:README/AGENTS/.gitignore/.claude 设置、官方 skill(`.jspace/skills/`) | **未修改**随升级刷新到新模板;**本地修改过**的一律保留(显示 `skip`,不阻断) |
| `user`(数据) | 用户数据:`.jspace/hub.json`、`.jspace/cron.json` | **永不覆盖**;schema 演进走迁移。hub.json 缺失时升级重建空注册表;cron.json 删除即视为停用,升级不复活 |
| machine(状态) | `.jspace/marker.json`/`local.json`/`logs/`/`state/` | 机器生成/重写,不进替换范围 |

**用户预留区**:`workspace/`、`filehub/` 以及工作台根目录下任何不在上面清单内的文件夹(如你自己建的 `notes/`、`drafts/`)——升级永不触碰。判断方法:`jspace workspace diff --json` 看每条 action,`skip`/`no-op` 即升级不动。

## 使用

1. 先读 `AGENTS.md`。
2. 首次使用按 `.jspace/skills/jspace-bootstrap/SKILL.md` 配置 gbrain 与所选 AI harness。
3. 用 JSpace CLI 校验本目录（`jspace` 为编译二进制，需在 PATH 上；源码检出则运行 `bun run cli/main.ts`）：

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
