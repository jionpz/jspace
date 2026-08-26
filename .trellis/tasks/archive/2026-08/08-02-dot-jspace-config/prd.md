# .jspace 目录收纳配置(仿 .claude)

## Goal

把工作台根目录的机器维护配置收进隐藏的 `.jspace/` 目录(仿 `~/.claude`):为机器配置建立稳定命名空间,并为 M3 cron/执行日志预铺 `.jspace/logs/` 槽位。根目录只留用户关心的 `AGENTS.md` / `README.md` / `workspace/` / `skills/`。**项目未发布、无其他用户:不做迁移/兼容机制;本地工作台 `~/jspace-work` 手动清空重建,以后每次更新模板/CLI 一律清空重 init 获取最新状态。**

## Background(确认事实)

- 当前工作台根目录混着:人看的(`AGENTS.md`/`README.md`/`workspace/`/`skills/`)+ 机器维护的(`hub.json` 注册表、`.jspace.json` 初始化标记)。
- 改动面(已 grep 定位):CLI `cli/init.ts`/`registry.ts`/`cmds.ts`/`args.ts`;模板 `templates/workbench/`(README/AGENTS)+ `templates/filehub/README.md`;skills `asset-ingest`(SKILL/filing/batch)+ `jspace-bootstrap`(SKILL/registry.md)。
- 现有工作台 `~/jspace-work` 为旧布局(根 hub.json + .jspace.json),由本任务清空重建。
- `materializeTree` 只写不删;`gen-assets` 只收文件 → `.jspace/logs/` 空目录不会自动物化,需显式 mkdir。
- 专家评审(已做)确认:logs 预分配非 YAGNI(asset-ingest 无头日志有真实消费方);hub.json 文件名保留 + marker 独立正确;「根干净」是次要价值,真实价值 = 稳定命名空间 + 日志槽位。

## Requirements

- **R1 `.jspace/` 布局**:`jspace init` 生成 `.jspace/` 目录,含:
  - `.jspace/hub.json` — 注册表(原根 `hub.json`,文件名保留,schema v3 不变);
  - `.jspace/marker.json` — 初始化标记(product/template_version/created_at/source,替代根 `.jspace.json`);
  - `.jspace/logs/` — 执行日志槽位(M3 cron / asset-ingest 无头日志用),**显式 mkdir** 保证存在;模板 `.gitignore` 忽略 `.jspace/logs/`。
  - 根目录**不再生成** `hub.json` / `.jspace.json`。
- **R2 CLI 路径改造**:`REGISTRY_FILE=".jspace/hub.json"`、`MARKER_FILE=".jspace/marker.json"`;doctor/domain/resource/filehub/inbox 全部跟随。
  - **检测职责**:`marker.json` 存在 = 初始化完成(doctor not-initialized warning、init 重入守卫同源);`hub.json` 缺失 = 注册表损坏(fail)。
- **R3 旧残留守卫(防双注册表,不迁移)**:`init` 检测到根 `hub.json` 或 `.jspace.json`(旧布局残留)且 `.jspace/marker.json` 缺 → fail「legacy layout files present;remove them and re-run init」。**不做**旧布局自动迁移/doctor 迁移提示。
- **R4 模板/文档/skill 路径同步**:工作台 README(结构清单)、AGENTS.md(操作引用)、filehub README、`asset-ingest`/`jspace-bootstrap` skills 的 hub.json 引用改为 `.jspace/hub.json`;asset-ingest 无头日志路径改 `.jspace/logs/inbox-batch.md`;dev 侧 AGENTS.md/README.md/args.ts help 文案同步。
- **R5 本地工作台重建**:手动清空 `~/jspace-work`(rm 旧布局)+ 重 init 为新布局,doctor 通过。
- **R6 升级约定(写进 dev 文档)**:每次模板/CLI 更新后,本地工作台**清空重 init**获取最新状态(`rm -rf <workbench>` 或清残留后 `init`);此即本项目的升级通道。

## Acceptance Criteria

- [ ] AC1 新 `init` 生成 `.jspace/{hub.json,marker.json}` + `.jspace/logs/`(实际存在);根无 `hub.json`/`.jspace.json` 残留。
- [ ] AC2 doctor/domain/resource/filehub/inbox 全命令面读写 `.jspace/hub.json`;新工作台 doctor 通过。
- [ ] AC3 `init` 遇旧残留(根 hub.json/.jspace.json)→ fail 并提示清除(不静默双注册表)。
- [ ] AC4 模板/技能/文档中 hub.json 路径引用已更新;asset-ingest 无头日志指向 `.jspace/logs/`。
- [ ] AC5 `~/jspace-work` 重建为新布局,doctor 通过,注册表可用。
- [ ] AC6 回归:`gen-assets` 重新生成、`tsc`、`bun run build` 编译产物全命令可用。

## Key Decisions

- **不做迁移/兼容**:项目未发布、唯一工作台本地自用;旧布局由 `init` 守卫 fail + 本地手动清除解决,无自动迁移、无 doctor 迁移提示。
- **`.jspace/hub.json` 保留文件名 + schema v3 不变**:只嵌套不改名,churn 最小。
- **marker 独立**:承载初始化完成检测与 init 溯源;不与 hub.json 合并(避免 schema churn)。
- **检测职责分离**:marker=初始化完成,hub.json=注册表存在(响应专家 C7 收敛)。
- **`.jspace/logs/` 预分配 + 显式 mkdir + gitignore**:有真实消费方(asset-ingest 无头日志),机器噪声不进 git,`.jspace/` 其余(控制平面)进 git。
- **升级 = 清空重 init**:写进 dev 文档作为本项目既定工作流。

## Out of Scope

- 旧布局迁移命令、doctor 迁移提示、多工作台兼容(项目未发布)。
- M3 cron 定义落地(仅预分配 logs/ 槽位)。
- `workspace/`、`skills/`、`AGENTS.md`、`README.md` 的位置。
- 分发/去个人化(M5)。

## Open Questions

- **无阻塞开放问题**。

## Notes

- 复杂度:跨 CLI/模板/skill 的中型重构,需 design + implement。
- 专家评审修改已吸收:C1(防双注册表:init 守卫 + 手动清残留)、C2/C3(不做迁移提示,删除对应机制)、C4/C5/C8(路径引用全量更新)、C6(logs 显式 mkdir)、C7(检测职责分离)、C9(Goal 诚实定性)。
