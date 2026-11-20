# JSpace × JStack：可选工程工作流集成

JSpace 是用户拥有的工作底座；JStack 是软件工程仓库内的工作流（flow / spec / pstack）。**JSpace 负责选择和路由，JStack 负责执行，二者不共享一套插件安装目录，也不共同维护阶段状态。**

## 初始化时启用

```bash
jspace init --dir ~/jworkspace --integration jstack
jspace integration status jstack --dir ~/jworkspace
```

不传 `--integration` 时，JSpace 的默认工作台不包含 JStack 技能、JStack 项目 hooks 或插件。启用后仅增加：

- 工作台的 **用户数据**：`.jspace/integrations.json`（`jstack.enabled` 及受管桥接技能的 SHA-256）；
- 工作台 **桥接技能**：`.jspace/skills/jspace-jstack/SKILL.md`；
- 工作台各 harness 的薄链接投影（与官方 JSpace 技能使用相同机制）。

这一步**不会下载 JStack**、不会运行远程安装脚本，也不会修改任何 Git 仓库。JStack 的完整插件由其官方 `jstack install --scope project` 安装到各自仓库。

## 在已有工作台里启用与停用

```bash
jspace integration enable jstack --dir ~/jworkspace --dry-run
jspace integration enable jstack --dir ~/jworkspace
jspace integration status jstack --dir ~/jworkspace --json
jspace integration disable jstack --dir ~/jworkspace --dry-run
jspace integration disable jstack --dir ~/jworkspace
```

启用、停用是幂等操作。`workspace upgrade` 不会替用户重新开启已关闭的集成，也**不会自动更新桥接技能本体**，以确保其升级 journal/rollback 不会遗漏另一个版本变更。升级预览和完成输出会提示可用的桥接更新；由用户显式运行 `jspace integration enable jstack` 刷新未修改的桥接文件。修改过的技能或同名冲突文件会被保留并明确报告，不静默覆盖。

停用**只移除工作台层受 JSpace 管理的桥接及投影**，不会修改已经安装到工程仓库的 `.jstack/`、`.agents/`、`.claude/`、项目 hooks 或 Git 版本历史。

## 为一个工程项目接入

1. 先把目标仓库注册成工作台的资源，通常通过 `jspace domain add` 和 `jspace resource add <id> --domain <domain> --path <absolute-git-root>`。仓库的机器本地路径存入 `.jspace/local.json`；不要复制整个 Git 仓库到 JWorkspace。
2. 获取一个**事先审阅、可信的本地 JStack checkout**，确认该 checkout 的插件已经构建。
3. 先预览，确认目标仓库与实际变更；再显式执行：

```bash
jspace integration attach jstack --dir ~/jworkspace \
  --repo /absolute/path/to/your/git-repo \
  --source /absolute/path/to/trusted/jstack-checkout \
  --dry-run

jspace integration attach jstack --dir ~/jworkspace \
  --repo /absolute/path/to/your/git-repo \
  --source /absolute/path/to/trusted/jstack-checkout
```

JSpace 会核对目标是**已注册资源的 Git 仓库根目录**，并验证指定的 JStack checkout。执行顺序为：`jstack install --all --scope project --dry-run` → `jstack install --all --scope project` → `jstack doctor --json --repo <repo>`。任一步失败都必须明确报告，不能把“安装命令完成”宣称为“真实阶段门禁已验证”。

**JStack 的仓库安装可能增加 hooks、skills、插件缓存与配置**；它是显式、非干跑的工程变更，应在可审阅的仓库分支中执行。当前 JStack 安装器需要 POSIX bash（Windows 请使用 WSL）。两边的版本及卸载由各自工具管理。

### Trellis 项目特别注意

目前 JSpace 的**开发仓库**仍具有 Trellis 规则。JSpace 不会在 attach 时自动移除它；先通过 JStack 自身的 `retire trellis` 预览、保护活跃任务并确认迁移，避免在同一个 Git 根目录长期加载两套阶段流程。

## 任务路由与记忆写回

- 软件工程任务：JSpace 定位 domain/resource → 进入 Git 仓库并读取其规范 → 由**项目级** JStack `route` 执行、验证、审查并汇报 PR/CI 证据。
- 非工程任务：沿用 JSpace 本身的工作方式，不启动 JStack 阶段流程。
- 知识与状态：JStack 可以提出归档建议；真正持久写入 gbrain 时统一遵守 JSpace `memory-writeback` 的来源和唯一写回契约。JSpace 不复制 JStack 阶段账本。
- “项目已安装”不同于“hook 在运行时已实际生效”。完整可靠性验证仍需要在具体 harness 中进行端到端演练。JStack 关于阶段门禁与子代理状态的待修问题不能通过本适配层自动解决。

## 诊断与恢复

```bash
jspace integration status jstack --dir ~/jworkspace
jspace doctor --dir ~/jworkspace --verbose
jspace workspace upgrade --dir ~/jworkspace --dry-run
```

`doctor` 会对启用状态、桥接 SHA、各 harness 投影以及损坏的集成 JSON 报警。它**不会远程拉取代码**或执行 JStack 命令。配置存在损坏时先修复再启用；本地改过的桥接文件不会被覆盖。工作台的升级和回滚仍遵循 JSpace 原有 journal 机制；项目级 `.jstack/` 由 JStack 负责。
