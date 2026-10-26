---
name: jspace-use
description: "JSpace 工作台使用入口:首次配置、域/资源路由、记忆与资产日常操作、cron、诊断、升级和退役。Use when 工作台怎么用/首次启用/jspace doctor/维护工作台。Do NOT use for 机器级 harness 治理(→harness-config)或旧目录收编(→jspace-adopt)。"
triggers:
  - "initialize jspace"
  - "setup jspace"
  - "configure jspace"
  - "first-use jspace"
  - "how to use jspace"
  - "工作台怎么用"
  - "maintain jspace"
  - "维护工作台"
  - "workspace upgrade"
  - "jspace doctor"
  - "cron failures"
  - "故障排查"
  - "workbench broken"
  - "registry broken"
  - "gbrain missing"
  - "wire gbrain"
  - "fresh environment"
---

# jspace-use - 工作台使用入口

工作台是用户拥有的本地工作控制平面:规则在 `AGENTS.md`,域/资源在 `.jspace/hub.json`,持久事实在 gbrain,文件本体在 filehub,执行交给惯用 harness,定时交给系统调度。本指南负责使用与维护,不复制其他 skill 的写入契约。

## 触发 / 非目标

- 用:首次启用、日常路由、registry/filehub 配置、harness 项目级接线、cron 运维、诊断、升级和退役。
- 不用:单份资料入库 → `asset-ingest`;问句召回 → `memory-recall`;收工写回 → `memory-writeback`;周期任务 → `memory-consolidate` / `weekly-report` / `workbench-retro`;机器级 `~/.agents/AGENTS.md` 治理 → `harness-config`;旧目录整体收编 → `jspace-adopt`。
- 不新增常驻服务、任务影子库、通用编排器或 JSpace 自有聊天客户端。

## 输入与前置

- 工作台根、已装 harness、可用的 bun/git 和明确的 filehub 选择。
- gbrain 二进制按 `$GBRAIN_BIN` → PATH 解析;缺失时停在安装/诊断步骤。
- 首次配置、升级、删除域/资源、移动项目目录或修改 cron 前,先按工作台 `Confirmation Rules` 取得所需确认。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- gbrain 安装、页契约、生命周期、周期和 pending:`references/gbrain.md`
- registry schema、binding 和 drift:`references/registry.md`
- 域/资源/skill 创建规则、cron 运维、项目生命周期:`references/governance.md`
- harness 能力与接线:`references/harnesses.md`
- 各 harness 接线细节:`references/harness-{claude,grok,opencode,cursor,pi,codex}.md`
- 无头运维:`references/headless-ops.md`
- 首次启用、使用里程和台账:`references/example-first-use.md`、`references/usage-mileage.md`、`references/usage-mileage-ledger-template.md`

## 写集

- 首次启用:`.jspace/hub.json`、`.jspace/cron.json`、`.jspace/local.json`、工作台 seed 和各 harness 接线。
- 日常治理:用户确认后的 domain/resource/project 注册、README/domain 文档和 filehub 注册。
- 升级:`jspace workspace upgrade` 管理的 seed、skill 投影和迁移 journal。
- 不写:gbrain 事实页、资产本体、owner index、机器级全局治理文档、项目任务系统。

## 输出

| 阶段 | 必须报告 |
|---|---|
| 首次启用 | configured / already-ok / deferred / blocked |
| 日常路由 | 读取的域/资源/状态和下一步 |
| 诊断 | 命令、exit code、具体 finding 和修复入口 |
| 升级 | diff、应用项、skip/conflict、备份和回滚入口 |
| cron | enabled、installed、最近运行、failures/pending |

## 主流程

### 1. 工作台模型

- `AGENTS.md` JSPACE 块内由 upgrade 管理,块外归用户。
- `.jspace/skills/` 是官方 skill 唯一物理副本;`.agents/skills/`、`.claude/skills/` 等是投影。
- `.jspace/hub.json` / `cron.json` 是用户数据;`.jspace/state/` 是机器状态。
- 记忆存事实与指针,资产存本体;共享上下文不等于同步私有会话。

### 2. 首次启用

1. **环境**:确认 bun/git;安装命令先展示来源,未经确认不执行远程管道脚本。
2. **gbrain**:解析二进制 → 初始化/诊断 → 配置 embedding;不可达时使用 `embed_skip: true`,不把降级写成成功。
3. **registry**:`jspace doctor --dir .`;检查 `hub.json`、域文件夹/id、资源 binding 和恰好一个 primary。
4. **filehub**:按用户选择运行 `jspace filehub init <root> --register`;未配置时明确降级。
5. **harness**:按用户选择的 harness 运行 `jspace harness wire --harness <name> --dir .`;不新增未验证的生命周期能力。
6. **cron**:先问用户是否启用;按 `enable → rehearsal → install → status` 执行。模板任务默认全禁用。
7. **验收**:用一份真实 inbox 文件走通 `asset-ingest`,再跑 `memory-recall`;工程命令成功不能替代业务闭环。

### 3. 日常路由

- 进入工作台:先看 session-start 状态和 `<next-action>`,再读 `.jspace/hub.json` 获取路由。
- 进入域:读 `workspace/<domain>/README.md` 与 `domain.json`。
- 收工:有持久事实 → `memory-writeback`;有文件 → `asset-ingest`;只读问题 → `memory-recall`。
- 周期:周报、巩固和 retro 都先运行 `jspace memory period --json`,只消费其 `week_start`、窗口和 `observed_through`。

### 4. 诊断与日常检查

```bash
jspace doctor --dir . --verbose
jspace workspace diff --json
jspace memory period --json
jspace memory check --json
jspace filehub check --json
jspace filehub weekly-path --week <Monday> --json
jspace cron failures --json
jspace ingest list --json
jspace pending list --json
```

- `memory check` / `filehub check` 是显式只读审计,不放进每次 hook。`memory check` 退出码:status `ok` → 0,`attention`/`partial` → 1;exit 1 表示「需要人看一眼」,不是命令坏了。
- `memory period` 是只读周期时钟;补跑用 `--week <Monday>`,周一凌晨运行的周任务用 `--last-complete`(取刚结束的完整周),固定取证用 `--now <ISO-8601>`。
- `filehub weekly-path` 只读裁决同周周报的唯一位置:`default`(无既有记录)、`reuse`(已登记年份位置)或 `conflict`(根/年双份、索引与文件不一致、损坏索引),冲突时 exit 1,不生成第三份。
- `cron failures` 聚合未 ack incident、actionable pending 和各 cron 状态;非 0 表示需要关注,不表示命令本身坏了。
- pending 位于 `.jspace/state/pending/*.APPLY.json`;`staged`、journal checkpoint、exit 0 和提醒次数都不等于业务完成。
- gbrain 查询、读页和写页主路径使用结构化 `gbrain call`;来源计数见 `gbrain.md`。

### 5. 升级与回滚

```bash
jspace workspace diff
jspace workspace upgrade --dry-run
jspace workspace upgrade
jspace workspace upgrade --rollback <id> --dry-run
jspace workspace upgrade --rollback <id>
```

- 先保存 diff、受影响清单和恢复材料,再应用。
- 未修改 seed 随升级刷新;用户数据和本地编辑保留或报告 conflict。
- 模板中的旧命令、旧 pending 根和旧 schema 只在显式 upgrade 迁移边界识别。
- 官方 skill 被改名/删除时,只清理可证明属于 JSpace 的旧用户级副本;同名用户自建目录保留并报告 conflict。

### 6. 域、资源与项目

- 域:跨天/项目/会话复现,且有独立入口、资源或规则时才创建;最小形态 `README.md + domain.json`。
- 资源:注册可再次发现的仓库、URL、provider 或容器;主路径经 `local.bindings`,每项恰好一个 `primary: true`。
- 项目:资产目录、域挂接、registry 和 state 四层保持一致。新 project id 使用 ascii slug;存量中文 slug 不因整理而改名。
- 记忆归属:`knowledge/<domain>/*` 的 `project` 写 domain id;`profile/*` 的 `project` 写工作台 id;`records/project/*` 用 `knowledge` 路由 tag(详见 `references/gbrain.md` §4)。
- 创建、删除、移动或覆盖这些对象前按工作台确认规则执行;详细门槛与退役阈值见 `references/governance.md`。

### 7. cron

- 官方 cron 使用 `target: {kind:"skill", skill, entrypoint}`,契约留在 skill,不写内联长 prompt。
- `cron run --id <id>` 是人工 rehearsal,不证明系统调度自然触发。
- `cron install` 只登记平台调度,不代替首跑。
- 启用状态、模型、harness 和用户自建任务不得被升级静默覆盖。

## 完成证据

- 首次启用:doctor 通过;registry、filehub、harness、gbrain 和选定 cron 状态均有实际输出;一次真实入库与召回闭环成立。
- 日常操作:读到的域/资源与用户任务匹配,没有跨域误写。
- 诊断:每个 finding 有命令输出与下一步,partial/unknown 未被写成成功。
- 升级:dry-run 零写入、应用结果可读回、rollback 预览零写入、备份位置明确。
- cron:安装、启用、最近运行和 failures 的证据彼此一致;自然触发证据与人工 rehearsal 分开记账。

## 失败与恢复

- gbrain 缺失/损坏:停止写入,保留现有待写;先修复二进制或数据库,再重放同一 request id/意图。
- registry 冲突:保留冲突文件和原文,不覆盖 `hub.json`;给出具体 add/remove 命令等待确认。
- filehub 未注册/路径失效:报告 unknown,不猜根目录,不批量移动文件。
- upgrade 冲突或中断:读取 journal,按 id 继续;不使用清空重建解决局部冲突。
- cron 失败:保留 incident 与日志;修正前置后 `jspace cron run --id <id>`;自然触发需另外取证。
- 旧 skill 同名目录无法证明归属:保留并报告,不按名字删除用户内容。

## 转交

- 资料入库/整理 inbox → `asset-ingest`
- 用户问句 → `memory-recall`
- 会话写回 → `memory-writeback`
- 周任务 → `memory-consolidate` / `weekly-report` / `workbench-retro`
- 机器级全局接线 → `harness-config`
- 旧项目结构收编 → `jspace-adopt`

## 自检

```bash
jspace doctor --dir .
jspace memory check --json
jspace filehub check --json
jspace cron failures --json
```

首次启用的最终验收必须包含一次真实资料归档和一次带出处召回;没有该证据只能报 `configured`,不能报 `business-verified`。
