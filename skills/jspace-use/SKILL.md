---
name: jspace-use
description: "**使用与维护** JSpace 工作台(需已装至少一个 harness):理解工作台模型与所有权边界、首次启用(装 gbrain 统一记忆库/PGLite+知识图谱+本地 embedding、校验注册表、接线所选 harness)、日常会话路由、gbrain 记忆(写回/召回/指针/周快照)、资源与资产(hub.json/filehub)、CLI 维护与诊断(doctor/diff/upgrade/cron)。Use when 初始化/配置/使用/维护 jspace、how to use jspace、工作台怎么用、怎么开始、workspace upgrade、jspace doctor、cron check、故障排查、registry broken、gbrain missing、fresh environment。Do NOT use for 机器级多-harness 全局治理接线(→harness-config)、日常资料入库(→asset-ingest)、会话记忆召回(→memory-recall)、收工写回(→memory-writeback)。"
triggers:
  - "initialize jspace"
  - "setup jspace"
  - "configure jspace"
  - "first-use jspace"
  - "how to use jspace"
  - "工作台怎么用"
  - "怎么开始"
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

**位置即所有权**:`AGENTS.md` 块内 = managed、块外 = user;`.jspace/skills/` = seed(未改随升级刷新,本地改动保留);`.jspace/hub.json` / `cron.json` = user 数据(永不覆盖);`.jspace/marker.json` / `local.json` / `state/` = machine 状态。升级边界与所有权详情见 `AGENTS.md` JSPACE 块与 `README.md`「目录边界与升级范围」——**此处不复制,读那两处**。

## 2. 首次启用(first-use)

全新工作台 `jspace init` 后,按步骤启用(细节指向 references;golden run 见 `references/example-first-use.md`):

0. **Prerequisites**:检测 bun/git;缺失按决策表给官方安装命令,**默认不执行**(治理红线:下载临时文件→展示核验→用户确认后跑)。
   - bun 缺失(装 gbrain 需要):官方脚本 `curl -fsSL https://bun.sh/install | bash`(macOS/Linux)或 `powershell -c "irm bun.sh/install.ps1 | iex"`(Windows)——**默认不执行**(`curl | bash` 一类,治理红线)。
   - 确需安装:① 下载临时文件、不直接管道执行(`curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh`);② 展示来源(bun.sh 官方)+ 抽查脚本核验;③ **用户显式确认后**才 `bash /tmp/bun-install.sh`。
1. **gbrain**(first core):解析二进制 → `bun install -g gbrain` → `gbrain init` → `gbrain doctor --json` 修所报 → embedding(默认本地 Ollama bge-m3;不可达 `embed_skip: true` 保底,不失败)。细则 `references/gbrain.md`。
2. **Registry health**:`jspace doctor --dir .`;`hub.json` 合法 JSON;域文件夹/id 一致;每资源恰一 primary。细则 `references/registry.md`。
3. **File center**:问用户选 filehub 根 → `jspace filehub init <根> --register`;暂不配则告知降级暂存区。**首启验收**:放一份示例文件进 `_inbox/` 跑一次「整理一下 inbox」,确认入库→gbrain 页→中文召回闭环。
4. **Harness wiring**:问用户用哪个 harness,wire 那一个(MCP/CLI + 会话注入/写回)。细则 `references/harnesses.md`。
5. **Final smoke + sign-off**:`jspace doctor` + `jq hub.json` + `gbrain doctor --fast`;报 configured/already-OK/missing-deferred。

## 3. 日常会话路由

进工作台后,按 `AGENTS.md` 路由:读 `workspace/<domain>/README.md` + `domain.json`(域工作)、查 `.jspace/hub.json`(资源)、`整理一下 inbox`(→asset-ingest)、`问一句`(→memory-recall)、收工(→memory-writeback)。记忆注入起点 = gbrain 会话开始检索式注入(memory-recall / gbrain resolver)。**路由规则以 `AGENTS.md` 为准**,本指南不替代、不复制。

## 4. gbrain 记忆

记忆层用法(写回纪律 / 召回 / 指针 / 周快照):**深入章节 → `references/gbrain.md`**。要点:状态写固定 slug 覆盖、知识 append-only 新页、每页带 `project` + `tags` + `source`、embedding 不可达 `embed_skip: true` 保底、promotion 记忆→知识。写回走 `memory-writeback`、召回走 `memory-recall`(各自 SKILL.md),本指南不重复其纪律。

## 5. 资源与资产

- **hub.json 增删查**:`jspace domain add` / `jspace resource add` / `jspace domain list` / `jspace resource list`;schema(hub v4 / local / marker)与 drift 规则 → `references/registry.md`。
- **filehub 协议**:`jspace filehub init <根> --register`;跟踪新项目三步(资产层 index → 域 README 挂接 → 记忆层实体)见 `README.md`「资产管理」+ `references/registry.md` + `asset-ingest`。
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

- **本指南 vs 其它事实源**:本指南是「怎么用」的入口;`AGENTS.md` 是路由与所有权规则;CLI `--help` 是命令细节;`docs/PLATFORMS.md` 是跨平台能力矩阵;各 skill `SKILL.md` 是能力边界。**不复制、只指引**。
- **何时用别的 skill**(路由表):

| 场景 | 用 |
|---|---|
| 机器级全局治理接线 | `harness-config` |
| 日常资料入库 / 整理 inbox | `asset-ingest` |
| 用户问句精准召回 | `memory-recall` |
| 会话结束收工写回 | `memory-writeback` |
| 周快照 | memory-consolidate cron |

- **registry broken / gbrain missing / upgrade 异常 / 自检命令**:先跑 `jspace doctor --dir .` 看诊断;`jspace workspace diff --dry-run` 看差异;`jspace workspace upgrade --rollback <id>` 回退已应用升级。无头运维(账号/配额/failover/失败可见性)→ `references/headless-ops.md`;命令级排障 → CLI `--help`。

## 按需深入(条件读指针)

- gbrain 安装/embedding 三方案/frontmatter schema/离线策略 → `references/gbrain.md`
- registry schema(hub v4 / local / marker)/drift 规则 → `references/registry.md`
- 逐 harness 接线(Pi/Claude/Codex/Cursor + 跨平台路径 + lifecycle 矩阵)→ `references/harnesses.md`
- 无头执行运维(账号/配额/失败可见性)→ `references/headless-ops.md`
- 首次启用 golden run → `references/example-first-use.md`

## 自检(做完跑这条)

```bash
jspace doctor --dir .        # 注册表通过
gbrain doctor --fast          # brain 健康
jq .jspace/hub.json           # 合法 JSON
```
(首次启用真正验收 = 第 2 章第 3 步的「放一份文件跑 inbox 整理」闭环成立)

## 参考
- `references/gbrain.md` — gbrain 安装/embedding/schema/离线策略
- `references/registry.md` — 注册表 schema + drift
- `references/harnesses.md` — 逐 harness 接线 + lifecycle 矩阵
- `references/headless-ops.md` — 无头运维(账号/配额/失败可见性)
- `references/example-first-use.md` — 首次启用 golden run(S5 产出)

> **Note**:官方 skill 只随 `jspace init` 物化;既有工作台经 `jspace workspace upgrade` 刷新(未修改的模板/skill 随升级更新,本地改动保留为 `skip`);`jspace init --force .` 对已有工作台会拒绝(用 upgrade,不用 init)。
