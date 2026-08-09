---
name: jspace-use
description: "**使用与维护 JSpace 工作台**:初始化/配置/升级、日常路由、gbrain 记忆与 CLI 诊断(doctor/diff/upgrade/cron)。Use when 初始化或维护 JSpace 工作台、how to use jspace、工作台怎么用、workspace upgrade、jspace doctor、cron check、故障排查、registry broken、gbrain missing、fresh environment。Do NOT use for 机器级多-harness 全局治理(→harness-config)、日常资料入库(→asset-ingest)、会话记忆召回(→memory-recall)、收工写回(→memory-writeback)。"
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
  - "cron check"
  - "故障排查"
  - "workbench broken"
  - "registry broken"
  - "gbrain missing"
  - "wire gbrain"
  - "fresh environment"
---

# jspace-use — JSpace 工作台使用指南

工作台内**长期使用指南**:从首次启用到日常路由、记忆与资产、维护与诊断,按需读对应章节。**不是一次性安装脚本** —— 首次启用只是其中一章(第 2 章)。首次启用时按第 2 章顺序执行、不跳验证步,末尾报 checklist。

## 何时用 / 何时不用
- ✅ 用:新工作台首次启用 / 日常「怎么用工作台 / 怎么路由 / 怎么维护诊断」/ registry 坏 / gbrain 缺失或未接线 / 故障排查。
- ❌ 不用:配置**机器级**多-harness 全局治理文档(`~/.agents/agents.md` 单源接线)→ `harness-config`;日常把资料入库 → `asset-ingest`;用户问句召回 → `memory-recall`;会话收工写回 → `memory-writeback`。
- **前提**:至少一个 harness(Pi/Claude Code/Codex/Cursor)已装且可用;本指南不装 harness。

## 1. 工作台模型

JSpace 工作台 = 本地工作控制平面:根 `AGENTS.md` 是入口面,其余官方资产一律在 `.jspace/`。三层:

- **控制平面**:`AGENTS.md` JSPACE 块(域/资源路由规则)+ `.jspace/hub.json`(域/资源索引)+ `.jspace/cron.json`(定时任务声明)。
- **记忆层**:gbrain 统一记忆库(PGLite + 知识图谱 + 本地 embedding),会话开始检索式注入、结束写回持久事实。
- **资产层**:filehub 文件中心,重资产归位 `filehub/`,要点写进 gbrain reference 页。

**位置即所有权**:`AGENTS.md` 块内 = managed、块外 = user;`.jspace/skills/` = seed(未改随升级刷新,本地改动保留);`.jspace/hub.json` / `cron.json` = user 数据(永不覆盖);`.jspace/marker.json` / `local.json` / `state/` = machine 状态。升级边界与所有权详情见 `README.md`「目录边界与升级范围」;域/资源/skill 创建规则与 cron 运维等治理细节 → 第 8 章。

## 2. 首次启用(first-use)

全新工作台 `jspace init` 后,按步骤启用(细节指向 references;golden run 见 `~/.agents/skills/jspace-use/references/example-first-use.md`):

0. **Prerequisites**:检测 bun/git;缺失按决策表给官方安装命令,**默认不执行**(治理红线:下载临时文件→展示核验→用户确认后跑)。
   - bun 缺失(装 gbrain 需要):官方脚本 `curl -fsSL https://bun.sh/install | bash`(macOS/Linux)或 `powershell -c "irm bun.sh/install.ps1 | iex"`(Windows)——**默认不执行**(`curl | bash` 一类,治理红线)。
   - 确需安装:① 下载临时文件、不直接管道执行(`curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh`);② 展示来源(bun.sh 官方)+ 抽查脚本核验;③ **用户显式确认后**才 `bash /tmp/bun-install.sh`。
1. **gbrain**(first core):解析二进制 → `bun install -g gbrain` → `gbrain init` → `gbrain doctor --json` 修所报 → embedding(默认本地 Ollama bge-m3;不可达 `embed_skip: true` 保底,不失败)。细则 `~/.agents/skills/jspace-use/references/gbrain.md`。
2. **Registry health**:`jspace doctor --dir .`;`hub.json` 合法 JSON;域文件夹/id 一致;每资源恰一 primary。细则 `~/.agents/skills/jspace-use/references/registry.md`。
3. **File center**:问用户选 filehub 根 → `jspace filehub init <根> --register`;暂不配则告知降级暂存区。**首启验收**:放一份示例文件进 `_inbox/` 跑一次「整理一下 inbox」,确认入库→gbrain 页→中文召回闭环。
4. **Harness wiring**:问用户用哪个 harness,wire 那一个(MCP/CLI + 会话注入/写回)。细则 `~/.agents/skills/jspace-use/references/harnesses.md`。
5. **Final smoke + sign-off**:`jspace doctor` + `jq hub.json` + `gbrain doctor --fast`;报 configured/already-OK/missing-deferred。

## 3. 日常会话路由

进工作台后,会话 hook 已注入工作台状态(见下);`AGENTS.md` 是路由规则常驻源,本指南只给动线、不复制规则。四个高频场景:

### 进入工作台(每天第一件事)
SessionStart hook(`.claude/settings.json`)注入 `<current-state>`(域/pending/cron 失败/inbox)与 `<next-action>`(求值后的下一步)。**直接按 `<next-action>` 走**;要看全貌读 `.jspace/hub.json`。状态没出现 → `jspace doctor --dir .` 查 `hooks.not_wired` / `claude.pointer_missing`。

### 进入某个域
读 `workspace/<domain>/README.md` + `domain.json`(域入口与细节);该域有 `AGENTS.md` / `runbook.md` 则一并读。域该不该建/怎么建 → 第 8 章。

### 收工
有持久事实(进展/决策/教训)→ `memory-writeback`;有产出文件 → `asset-ingest`(先归位本体,再写 gbrain 指针)。都没有则静默结束。

### 每周体检
`jspace doctor --dir .` 看 `info` 级体检项(僵尸域 / 待归档项目 / 失效指针,见第 8 章「退役与回收」);`jspace workspace diff` 看升级差异。

## 4. gbrain 记忆

记忆层用法(写回纪律 / 召回 / 指针 / 周快照):**深入章节 → `~/.agents/skills/jspace-use/references/gbrain.md`**。要点:状态写固定 slug 覆盖、知识 append-only 新页、每页带 `project` + `tags` + `source`、embedding 不可达 `embed_skip: true` 保底、promotion 记忆→知识。写回走 `memory-writeback`、召回走 `memory-recall`(各自 SKILL.md),本指南不重复其纪律。

## 5. 资源与资产

- **hub.json 增删查**:`jspace domain add` / `jspace resource add` / `jspace domain list` / `jspace resource list`;schema(hub v4 / local / marker)与 drift 规则 → `~/.agents/skills/jspace-use/references/registry.md`。
- **filehub 协议**:`jspace filehub init <根> --register`;跟踪新项目三步(资产层 index → 域 README 挂接 → 记忆层实体)见 `README.md`「资产管理」+ `~/.agents/skills/jspace-use/references/registry.md` + `asset-ingest`。
- 重资产归位与入库 → `asset-ingest` skill(本指南不重复其流程)。

## 6. CLI 维护与诊断

```bash
jspace doctor --dir .                  # 注册表 + 工作台健康(含 orphan skill 诊断)
jspace workspace diff                  # 与当前 bundle 的差异预览
jspace workspace upgrade --dry-run     # 只预览不执行
jspace workspace upgrade               # 应用差异(seed 未改刷新 / 用户改动保留 / 可 --rollback)
jspace cron check                      # cron 失败 + pending 暂存写聚合
jspace ingest list                     # 入库 journal 续跑(fail/cleanup-pending 收尾)
```
命令细节以 `jspace <cmd> --help` 为准;跨平台权威矩阵(外部稳定依赖,不随工作台物化)见 `docs/PLATFORMS.md`。

## 7. 边界与故障排查

- **本指南 vs 其它事实源**:本指南是「怎么用」的入口;`AGENTS.md` 是常驻路由与红线(每会话注入;域/skill/cron 治理细节 → 第 8 章);CLI `--help` 是命令细节;`docs/PLATFORMS.md` 是跨平台能力矩阵;各 skill `SKILL.md` 是能力边界。**不复制、只指引**。
- **何时用别的 skill**(路由表):

| 场景 | 用 |
|---|---|
| 机器级全局治理接线 | `harness-config` |
| 日常资料入库 / 整理 inbox | `asset-ingest` |
| 用户问句精准召回 | `memory-recall` |
| 会话结束收工写回 | `memory-writeback` |
| 周快照 | memory-consolidate cron |

- **registry broken / gbrain missing / upgrade 异常 / 自检命令**:先跑 `jspace doctor --dir .` 看诊断;`jspace workspace diff --dry-run` 看差异;`jspace workspace upgrade --rollback <id>` 回退已应用升级。无头运维(账号/配额/failover/失败可见性)→ `~/.agents/skills/jspace-use/references/headless-ops.md`;命令级排障 → CLI `--help`。

## 8. 治理细节

治理细节(建域 / 建 skill / cron 运维)按需读;常驻路由与红线在 `AGENTS.md` JSPACE 块,本章只承接细节。

### 8.1 域

- **创建信号**(满足 ≥2 条):跨天/项目/会话复现;有值得跟踪的外部资源;有独立入口/流程/安全规则;需要 AI 专属边界;作为无关资源标签会变吵;用户显式要求从本工作台管理。
- **禁止创建**:一次性操作、单一代码仓库、模糊主题、无管理面的重内容。
- **确定度分级**:高置信 → 直接建并简要说明;中置信 → 问一句;低置信 → 保持一次性或挂已有域。
- **最小形态**:`workspace/<domain>/{README.md, domain.json}`。
- **何时加 `workspace/<domain>/AGENTS.md` 或 `runbook.md`**:重复流程或安全边界需要时。
- **建域同步**:在 `.jspace/hub.json` 加索引;细节进 `workspace/<domain>/domain.json` 与 markdown 文件,不塞进 hub.json。

### 8.2 资源

- 资源是域内可发现的入口(项目/仓库/URL/provider/容器/笔记等值得再次找到的对象)。
- schema(entrypoints/binding/primary)与 drift 规则 → `~/.agents/skills/jspace-use/references/registry.md`,不在此复制。

### 8.3 skill

- **提议信号**(满足 ≥2 条):代理反复需要同一非显然流程;流程跨多文件/工具/域;需要清晰自动触发规则;没有可复用检查清单代价高;太过程式化不适合根 `AGENTS.md`、又太横切不适合单一域 README;用户显式要可复用 AI 能力。
- **禁区**:一次性笔记、简单域元数据、应进 `AGENTS.md` 的编码约定、大段内容 dump、能清楚放进 `AGENTS.md` 或域 README 的规则。
- **用户确认前置**:根 `skills/` 只放用户自建 skill,创建前必须用户确认。

### 8.4 cron

- **session start 契约**:跑 `jspace cron check`,把失败与 pending 暂存写(`.jspace-logs/*.APPLY.json`)上报用户。
- **定义即代码**:定义在 `.jspace/cron.json`(声明式:schedule + harness + prompt),git 同步、应用前 review。
- **rehearsal gate**:机器侧 `jspace cron install` 前,先 `jspace cron run` 各任务一次验证契约。
- **运维细节** → `~/.agents/skills/jspace-use/references/headless-ops.md`(无头代理/账号/配额/失败可见性)。

### 8.5 知识路由纪律

只写**有助于未来会话**的持久记录。根 `AGENTS.md` 应含**长期运行规则**,而非临时偏好或一次性任务笔记。

### 8.6 退役与回收

用久了会变脏:僵尸域、失效指针、结项项目、陈旧 state。**所有处置动作必须先问用户**——删域/移文件是破坏性操作,未经确认不执行。每周体检入口 → 第 3 章「每周体检」。

| 对象 | 退役信号 | 处置 | 确认 |
|---|---|---|---|
| 域 | `workspace/<d>/` 长期未更新(≥90 天)且 hub 无活跃资源 | 归档或合并进邻近域;同步从 `.jspace/hub.json` 移除索引 | **必须问** |
| 资源 | primary 路径不存在,且非"任务本就关于缺失路径" | 修正指针,或从 hub 移除 | **必须问** |
| 项目(filehub) | `projects/<x>/` 长期未动(≥120 天)、`index.md` 标记结项 | 移入 `filehub/archive/<年>/`,更新域 README 挂接 | **必须问** |
| gbrain state 页 | 项目结项后 `project/<x>/state` 不再更新 | 保留(历史记录);不自动删 | — |

**`jspace doctor` 的体检诊断**:`domain.dormant` / `filehub.project_stale` 按上表阈值报 `info` 级(非 error——它只是提示"看一眼",mtime 会被 git clone / 网盘同步重写,阈值取保守值防误报)。

## 按需深入(条件读指针)

- 治理细节(域/资源/skill 创建规则、cron 运维)→ 第 8 章
- gbrain 安装/embedding 三方案/frontmatter schema/离线策略 → `~/.agents/skills/jspace-use/references/gbrain.md`
- registry schema(hub v4 / local / marker)/drift 规则 → `~/.agents/skills/jspace-use/references/registry.md`
- 逐 harness 接线(Pi/Claude/Codex/Cursor + 跨平台路径 + lifecycle 矩阵)→ `~/.agents/skills/jspace-use/references/harnesses.md`
- 无头执行运维(账号/配额/失败可见性)→ `~/.agents/skills/jspace-use/references/headless-ops.md`
- 首次启用 golden run → `~/.agents/skills/jspace-use/references/example-first-use.md`

## 自检(做完跑这条)

```bash
jspace doctor --dir .        # 注册表通过
gbrain doctor --fast          # brain 健康
jq .jspace/hub.json           # 合法 JSON
```
(首次启用真正验收 = 第 2 章第 3 步的「放一份文件跑 inbox 整理」闭环成立)

## 参考
- `~/.agents/skills/jspace-use/references/gbrain.md` — gbrain 安装/embedding/schema/离线策略
- `~/.agents/skills/jspace-use/references/registry.md` — 注册表 schema + drift
- `~/.agents/skills/jspace-use/references/harnesses.md` — 逐 harness 接线 + lifecycle 矩阵
- `~/.agents/skills/jspace-use/references/headless-ops.md` — 无头运维(账号/配额/失败可见性)
- `~/.agents/skills/jspace-use/references/example-first-use.md` — 首次启用 golden run(S5 产出)

> **Note**:官方 skill 只随 `jspace init` 物化;既有工作台经 `jspace workspace upgrade` 刷新(未修改的模板/skill 随升级更新,本地改动保留为 `skip`);`jspace init --force .` 对已有工作台会拒绝(用 upgrade,不用 init)。
