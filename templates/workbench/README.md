# JSpace Workbench

本目录由 JSpace CLI (`jspace init`) 生成，是日常工作的控制平面；它不是 JSpace 开发仓库。

## 结构

- `.jspace/hub.json` - domain/resource 注册表(机器维护,平时无需手改)
- `.jspace/marker.json` - 初始化标记(机器维护)
- `.jspace/logs/` - 执行日志(cron / 无头批量;git 忽略)
- `AGENTS.md` - 工作模式操作规则
- `workspace/jspace-dev/` - 指向 JSpace 开发仓库的 domain
- `workspace/agent-infra/` - AI 资源管理 domain
- `skills/jspace-bootstrap/` - 首次配置技能
- `skills/asset-ingest/` - 资料转知识资产技能
- `.gitignore` - 忽略 `.jspace/logs/`

## 使用

1. 先读 `AGENTS.md`。
2. 首次使用按 `skills/jspace-bootstrap/SKILL.md` 配置 gbrain 与所选 AI harness。
3. 用 JSpace CLI 校验本目录（`jspace` 为编译二进制，需在 PATH 上；源码检出在 `__DEV_ROOT__` 用 `bun run cli/main.ts`）：

```bash
jspace doctor --dir .
```

## 与开发仓库的关系

- 开发仓库：`__DEV_ROOT__`
- 开发模式：去开发仓库修改 CLI、模板或技能，再重新初始化或同步本目录。

## 资产管理(跟踪新项目)

重资产(pdf/ppt/excel/md)归位在**文件中心(filehub)**——独立目录,由 `jspace filehub init` 生成并注册(`type: filehub` resource),可作 Obsidian vault 打开;内容走网盘/Obsidian Sync,不进本工作台 git。协议见 filehub 根 `README.md` 与 `skills/asset-ingest/`。

**跟踪一个新项目 = 三步**:

1. 资产层建 `filehub/projects/<项目>/index.md`(dashboard:现状 / 关键文件表 / 下一步);
2. 所属域 README「本域进行中的项目」表挂一行;
3. 记忆层建实体(gbrain,记录项目事实与指针)。

新资料一律先落 `filehub/_inbox/`,说一句「整理一下 inbox」批量归档。

## 任务管理

本工作台不内置任务管理。如需任务管理，可在工作台运行 `trellis init` 初始化。
