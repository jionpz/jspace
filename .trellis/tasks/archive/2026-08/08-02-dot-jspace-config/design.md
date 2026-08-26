# .jspace 目录收纳配置 — 技术设计

## 架构与边界

工作台根目录按「人看 / 机器维护」切分,仿 `~/.claude`:

```
jspace-work/                     # 人看的(根)
  AGENTS.md                      # 路由规则
  README.md                      # 导读
  workspace/<domain>/            # 域
  skills/                        # 技能
  .jspace/                       # 机器维护(隐藏,git 同步)
    hub.json                     # 注册表(原根 hub.json,schema v3 不变)
    marker.json                  # 初始化标记(原 .jspace.json)
    logs/                        # 执行日志槽位(.gitignore 忽略)
  .gitignore                     # 含 .jspace/logs/
```

CLI 常量:`REGISTRY_FILE = ".jspace/hub.json"`、`MARKER_FILE = ".jspace/marker.json"`(相对工作台根)。

**检测职责分离**(响专家 C7):`marker.json` 存在 = 初始化完成;`hub.json` 缺失 = 注册表损坏。doctor 的 not-initialized warning 与 init 重入守卫都以 marker 为据;loadRegistry 读 hub.json 缺失即 fail。

## 关键改动

### 1. 模板源文件搬迁 + 新增
- `templates/workbench/hub.json` → **`templates/workbench/.jspace/hub.json`**(模板源文件跟着走,否则 materializeTree 会把 hub.json 写到工作台根)。
- `templates/workbench/.gitignore` 新增:内容 `.jspace/logs/`。
- `templates/workbench/README.md`「结构」清单更新为 `.jspace/hub.json` / `.jspace/marker.json` / `.jspace/logs/`。
- `templates/workbench/AGENTS.md`:操作型 hub.json 引用(路径/命令:look up、`jq . hub.json`、validation)统一为 `.jspace/hub.json`;Registry Access 处一处锚点声明「注册表 = `.jspace/hub.json`,以下 hub.json 概念指代均指此文件」;纯概念指代保留。
- `templates/filehub/README.md` 一处路径更新。

### 2. CLI
- `cli/init.ts`:`MARKER_FILE=".jspace/marker.json"`;`cmdInit` 先 `mkdirSync(join(target, ".jspace/logs"), {recursive:true})` 保证槽位存在(响 C6);写 marker;**旧残留守卫**:若根存在 `hub.json` 或 `.jspace.json` 且 `.jspace/marker.json` 缺 → fail「legacy layout files present at <target>; remove them and re-run init」(防双注册表,响 C1,不做迁移)。
- `cli/registry.ts`:`REGISTRY_FILE=".jspace/hub.json"`;loadRegistry/saveRegistry 用 `join(root, REGISTRY_FILE)`(已如此,改常量即可);错误文案含完整路径。
- `cli/cmds.ts`:
  - doctor:marker 检查(warning not initialized)+ registry fail(hub.json 缺失 → error + exit 1);文案更新为 `.jspace/marker.json` / `.jspace/hub.json`。
  - registerFilehub 的 hub.json 检查与文案更新。
- `cli/args.ts`:filehub help 文案 `(hub.json)` → `(.jspace/hub.json)`。

### 3. skills / 文档
- `asset-ingest`:`SKILL.md` + `references/filing.md` + `references/batch.md` 的「读 hub.json」→「读 .jspace/hub.json」;无头日志路径 `batch.md` L54 与 `SKILL.md` L84 的 `logs/inbox-batch.md` → `.jspace/logs/inbox-batch.md`(响 C5)。
- `jspace-bootstrap`:`SKILL.md` Phase 2 + **Phase 5**(L100-101 `jq . hub.json`、L57 Windows 变体)与 `references/registry.md` 的 hub.json 命令更新为 `.jspace/hub.json`。
- dev 侧:`AGENTS.md` L10/L50(`templates/workbench/hub.json` 死链)、`README.md` L8(产物含 hub.json)同步;GOAL.md 概念引用保留并显式标注;`__DEV_ROOT__` 说明不变。
- **升级约定**:dev AGENTS.md 明确「每次模板/CLI 更新后,本地工作台清空重 init 获取最新状态(`rm -rf <workbench>` 或清残留后 `init --force`)」——本项目无兼容负担,升级即重建。

## 兼容与迁移

- **无迁移机制**:项目未发布、唯一工作台本地自用。旧布局工作台由 `init` 旧残留守卫 fail 提示清除(不静默双注册表),本地工作台手动清空重建。
- hub.json schema 与内容不变,仅位置变化;已注册资源/域路径语义不变。

## 取舍

- **保留 `hub.json` 文件名 + schema v3 不变**:嵌套不改名,churn 最小。
- **marker 独立文件**:承载初始化完成检测与 init 溯源,不并 hub.json。
- **logs 预分配 + 显式 mkdir + gitignore**:真实消费方(asset-ingest 无头日志);机器噪声不进 git,`.jspace/` 其余(控制平面)进 git。
- **旧残留守卫而非迁移**:3 行检查防双注册表,不做自动迁移(无兼容负担)。

## 操作与回滚

- 全部为模板/CLI 常量改动 + 本地工作台重建;回滚 = 还原常量 + `gen-assets`。
- 破坏面:路径常量改动会破坏「旧布局工作台 + 新 CLI」组合——由 `init` 守卫 fail 兜底;任务内把 `~/jspace-work` 重建为同布局。
