---
name: jspace-use
description: "工作台使用入门 + 首次配置 + 路由/记忆/资产/诊断日常操作。当用户问如何使用工作台、如何首次配置、如何诊断维护时触发。"
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
- ❌ 不用:配置**机器级**多-harness 全局治理文档(`~/.agents/agents.md` 单源接线)→ `harness-config`;日常把资料入库 → `asset-ingest`;用户问句召回 → `memory-recall`;会话收工写回 → `memory-writeback`;每周纪律自省 → `workbench-retro`。
- **前提**:至少一个 harness(Pi/Claude Code/Codex/Cursor)已装且可用;本指南不装 harness。

## 1. 工作台模型

JSpace 工作台 = 本地工作控制平面:根 `AGENTS.md` 是入口面,其余官方资产一律在 `.jspace/`。三层:

- **控制平面**:`AGENTS.md` JSPACE 块(域/资源路由规则)+ `.jspace/hub.json`(域/资源索引)+ `.jspace/cron.json`(定时任务声明)。
- **记忆层**:gbrain 统一记忆库(PGLite + 知识图谱 + 本地 embedding)。会话开始检索式注入(hook,best_effort);**收工写回始终显式**——hook 与轻提示只提醒、从不写 gbrain,写入由你说「收工」触发 `memory-writeback`(能力分级见 `~/.agents/skills/jspace-use/references/harnesses.md`)。
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
4. **Harness wiring**:问用户用哪个 harness,选一个跑同一条命令 `jspace harness wire --harness <claude|grok|opencode|cursor|pi> --dir .`(幂等写该端 gbrain MCP + session-start briefing + 打印能力边界;Cursor 还链官方 skills 到 `~/.cursor/skills/`;claude 的旧入口 `jspace gbrain wire` 仍是等价别名)。细则 `~/.agents/skills/jspace-use/references/harnesses.md`。
4.5. **Scheduled tasks(默认推荐启用;**必须问用户一次**,不许默默跳过)**:出厂 `.jspace/cron.json` 四个任务全是 `enabled: false`(未接线的机器上不该有东西被拉起),所以**不动它 = 定时层永久空转**。给用户念清代价再问:

   | 不开的后果 | 谁停转 |
   |---|---|
   | `_inbox/` 只在你想起来时才整理 | 资产飞轮(inbox-tidy) |
   | 没有周报、没有周记忆巩固页 | 记忆飞轮(weekly-report / memory-consolidate) |
   | 纪律腐化没人取证(写回率/断指针/僵尸域) | 自省飞轮(workbench-retro) |

   一键开启(最短序列,逐条 rehearsal 后再装调度):
   ```bash
   for id in inbox-tidy weekly-report memory-consolidate workbench-retro; do jspace cron enable "$id" --dir .; done
   jspace cron run inbox-tidy --dir .        # rehearsal gate:先手跑一次验证契约(逐个跑一遍最稳)
   jspace cron install --dir .               # 装进系统调度(launchd / crontab / schtasks)
   jspace cron status --dir .                # 确认已安装
   ```
   - **只想开一部分**:`jspace cron enable <id> --dir .` 逐条开(推荐至少开 `inbox-tidy` + `workbench-retro`——一条转资产、一条转纪律)。
   - **第 4 步选的不是 Claude Code?先改 harness 字段**:出厂 `.jspace/cron.json` 四个任务都是 `"harness": "claude"`;选了其他 harness 就把各任务的 `harness` 改成对应值(`grok`/`opencode`/`pi`/`codex`;Cursor 无 headless CLI 不进 cron enum,cron 改用其中一个无头 harness),否则 rehearsal 会因本机没有 claude 可执行文件而失败。cron.json 是 user 数据,改后升级不覆盖。
   - **harness 未接线/配额未配就先别装调度**:先做第 4 步,再 rehearsal。`cron run` 失败是安全失败(记 incident + `jspace cron check` 可见,不改任何数据);`cron install` 只登记调度、不代跑。
   - **用户确认要跳过**:标 `deferred` 并告知 `jspace doctor --verbose`(或 `--json`)会持续报 `cron.all_disabled`(info,不是错误——info 默认只计数不打印),想开时回到本步。
5. **Final smoke + sign-off**:`jspace doctor` + `jq hub.json` + `gbrain doctor --fast`;报 configured/already-OK/missing-deferred。若有启用的 cron,再确认 `jspace cron status --dir .` 显示已安装/可运行;选择跳过 cron 的标 `deferred`(`jspace doctor --verbose` 只报 `cron.all_disabled` info,不失败)。

## 3. 日常会话路由

进工作台后,会话 hook 已注入工作台状态(见下);`AGENTS.md` 是路由规则常驻源,本指南只给动线、不复制规则。四个高频场景:

### 进入工作台(每天第一件事)
SessionStart hook(`.claude/settings.json`)注入 `<current-state>`(域/pending/cron 失败/inbox)与 `<next-action>`(求值后的下一步)。**直接按 `<next-action>` 走**;要看全貌读 `.jspace/hub.json`。状态没出现 → `jspace doctor --dir .` 查 `hooks.not_wired` / `claude.pointer_missing`。

### 进入某个域
读 `workspace/<domain>/README.md` + `domain.json`(域入口与细节);该域有 `AGENTS.md` / `runbook.md` 则一并读。域该不该建/怎么建 → 第 8 章。

### 收工
有持久事实(进展/决策/教训)→ 说一句「收工」跑 `memory-writeback`,**写回页带 `tags: source:session`**(写回率取证的唯一依据);有产出文件 → `asset-ingest`(先归位本体,再写 gbrain 指针)。都没有则静默结束。

会话里最多出现**一次**收工轻提示(`jspace context turn`,无更高优先级状态时才出;去重锚点 `.jspace/state/briefing.json`),claude/cursor 另有 session-end hook。**提醒 ≠ 写入**:三者都不写 gbrain,不触发 `memory-writeback` 就等于本次没沉淀。

### 每周体检
`jspace doctor --dir .` 看 `info` 级体检项(僵尸域 / 待归档项目 / 失效指针,见第 8 章「退役与回收」);`jspace workspace diff` 看升级差异。想确认三个飞轮**在转**(而不只是机制在)→ 走使用里程清单 `~/.agents/skills/jspace-use/references/usage-mileage.md`。

## 4. gbrain 记忆

记忆层用法(写回纪律 / 召回 / 指针 / 周快照):**深入章节 → `~/.agents/skills/jspace-use/references/gbrain.md`**。要点:状态写固定 slug 覆盖、知识 append-only 新页、每页带 `project` + `tags` + `source`、embedding 不可达 `embed_skip: true` 保底、promotion 记忆→知识。写回走 `memory-writeback`、召回走 `memory-recall`(各自 SKILL.md),本指南不重复其纪律。

**写回率自查(随手可跑;正式取证在 `workbench-retro` 检查 1)**:

```bash
gbrain list --type note --tag source:session -n 20   # 会话沉淀的写入(分子)
gbrain list --type note --tag source:cron -n 20      # 定时归纳的写入(另一半)
```
两边一比就知道「记忆在长,长的是 cron 归纳的还是会话沉淀的」。`source:session` 长期为 0 = 收工写回这条腿没在转(提醒发了但没人触发写回),按第 3 章「收工」补上;来源 tag 语义 → `~/.agents/skills/jspace-use/references/gbrain.md`「Provenance tag」。

要把这条腿**验成达标**(连续两周落窗口计数 > 0)而不只是随手看一眼,用取证协议 `~/.agents/skills/jspace-use/references/usage-mileage.md`(含窗口口径、禁伪造红线、retro 无头首跑与三飞轮清单)。

## 5. 资源与资产

- **hub.json 增删查**:`jspace domain add` / `jspace resource add` / `jspace domain list` / `jspace resource list`;schema(hub schema_version 1 / local / marker)与 drift 规则 → `~/.agents/skills/jspace-use/references/registry.md`。
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

- **`memory.writeback_habit_unverified`(info,`jspace doctor --verbose` / `--json` 可见)**:会话已有一定里程且收工轻提示发出过,但 **doctor 不查 gbrain**——它只提示「提醒面在转,请自己核对写回腿」,不是「写回率 = 0」的证明。处置:跑第 4 章的 `gbrain list --type note --tag source:session -n 20` 自查(精确计数走 `workbench-retro` 检查 1);真有事实要留,说一句「收工」跑 `memory-writeback`(带 `tags: source:session`)。这条永远是 info,不影响 exit;全手动写回是合法选择,当已知状态即可。接线是否坏了看 `briefing.stale` / `harness.session_start_not_wired`,不看这条。

## 7. 边界与故障排查

- **本指南 vs 其它事实源**:本指南是「怎么用」的入口;`AGENTS.md` 是常驻路由与红线(每会话注入;域/skill/cron 治理细节 → 第 8 章);CLI `--help` 是命令细节;`docs/PLATFORMS.md` 是跨平台能力矩阵;各 skill `SKILL.md` 是能力边界。**不复制、只指引**。
- **何时用别的 skill**(路由表):

| 场景 | 用 |
|---|---|
| 机器级全局治理接线 | `harness-config` |
| 日常资料入库 / 整理 inbox | `asset-ingest` |
| 用户问句精准召回 | `memory-recall` |
| 会话结束收工写回 | `memory-writeback` |
| 每周自省(纪律审计 / 规则修订提议) | `workbench-retro` |
| 本周项目周报(人读汇总) | `weekly-report` |
| 周记忆巩固(周快照 + state 回写) | `memory-consolidate` |

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

- **session start 契约**:跑 `jspace cron check`,把失败与 pending 暂存写(`<filehub>/.jspace-logs/*.APPLY.json`)上报用户。
- **定义即代码**:定义在 `.jspace/cron.json`(声明式:schedule + harness + prompt),git 同步、应用前 review。
- **契约归 skill,不写内联 prompt**:官方周期任务用 `target: {kind: "skill", skill: <名>, entrypoint: "weekly"}`,`input` 只留一句薄引导——契约正文在 SKILL.md(随 `workspace upgrade` 刷新)。**内联长 prompt 会被永久冻结**:`cron.json` 是 user 数据,升级永不覆盖。
- **存量迁移**:老工作台的 `weekly-report` / `memory-consolidate` 若仍是内联 prompt,`jspace doctor` 会报 `cron.inline_prompt_legacy`(info)。改法:把该 cron 的 `prompt` 字段换成上面的 `target` 结构(自定义 cron 不受影响,内联 prompt 是它们的正常形态)。
- **出厂全禁用,开启是显式动作**:模板四个任务都是 `enabled: false`(未接线机器上不该有东西被拉起)。开启序列 = `jspace cron enable <id>` → `jspace cron run <id>`(rehearsal)→ `jspace cron install` → `jspace cron status`,首启版本见第 2 章 4.5。**全禁用时 `jspace doctor --verbose` 报 `cron.all_disabled`(info,不是错误;info 默认只计数)**——它就是"定时层从没启用过"的提示;真要全手动,把这条当已知状态即可。
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

### 8.7 项目生命周期(立项 / 结项)

项目横跨三层(资产层本体 / 控制平面挂接 / 记忆层实体),漏一层就会漂移——**最常见的坏味是「filehub 里有项目,域 README 和 registry 都不知道」**,后果是 `weekly-report` 的项目发现源失效。按下面两张清单走,别凭记忆。

#### 命名约定(先定这个,否则第 ④ 步会卡)

| 面 | 取值 | 例 |
|---|---|---|
| **project id**(机器标识) | ascii slug,`[a-z0-9-]`;用于 gbrain slug、`ingest --project`、registry | `tiyanying-52` |
| **资产目录名**(人读) | 自由,可中文;经 `--asset-rel-path` 绑到 id | `projects/52期体验营/` |

两者由 `jspace project add <id> --asset-rel-path projects/<中文名>` 绑定 —— **不必为了注册把目录改成英文**。

> **存量项目的中文 slug 不迁移**:在本约定确立前建的 gbrain 页(如 `project/<中文名>/state`、`assets/<中文名>/<语义名>`)**保留原样,不要重命名**。理由有二:① 记忆层是 append-only 的历史,重命名的代价大于收益;② `memory-recall` 的可复跑验收基线正是建立在这些 slug 上,迁移会让基线失效。**新项目一律用 ascii id**,新旧并存是可接受的过渡态。

#### 立项(四步,缺一不可)

```bash
# ① 资产层:建项目目录与 dashboard
mkdir -p <filehub>/projects/<项目名> && $EDITOR <filehub>/projects/<项目名>/index.md   # 现状 / 关键文件表 / 下一步
# ② 控制平面:域 README 项目表挂一行
$EDITOR workspace/<domain>/README.md      # | <项目名> | filehub/projects/<项目名>/ | 进行中 |
# ③ 记忆层:建实体(起始 state 页)
gbrain put project/<id>/state < <正文>    # 固定 slug,后续覆盖更新
# ④ registry 注册(稳定 slug、消除 ingest warning)
jspace project add <id> --asset-rel-path projects/<项目名>
```

- ④ 可延后但别忘:不注册时 `jspace ingest begin --project <x>` 会报 `warn: project ... is not registered`(不阻塞,slug 稳定性略降)。
- ③ 的正文起手只需三行:这个项目是什么 / 现在到哪了 / 下一步。别等"想清楚"再写。

#### 结项(三步)

```bash
# ① 资产层:移入年度归档
mv <filehub>/projects/<项目名> <filehub>/archive/<年>/
# ② 控制平面:域 README 项目表改状态或删行(指向新路径)
# ③ 记忆层:state 页写结项终态(保留不删——历史记录)
gbrain put project/<id>/state < <终态正文>
```

**移动/删除是破坏性操作,执行前必须问用户**(§8.6 确认列同款)。

#### 与 doctor 体检项的对应

| doctor 诊断 | 含义 | 处置 |
|---|---|---|
| `filehub.project_stale`(info) | `projects/<x>/` ≥120 天未动 | 若已结项 → 走上面「结项」三步 |
| `filehub.inbox_unfiled`(warning) | `_inbox/` 有未归位文件 | → `asset-ingest`(「整理一下 inbox」) |
| `domain.dormant`(info) | 域 ≥90 天未更新且无活跃资源 | → §8.6 退役表 |


## 按需深入(条件读指针)

- 治理细节(域/资源/skill 创建规则、cron 运维)→ 第 8 章
- gbrain 安装/embedding 三方案/frontmatter schema/离线策略 → `~/.agents/skills/jspace-use/references/gbrain.md`
- registry schema(schema_version=1 / local / marker)/drift 规则 → `~/.agents/skills/jspace-use/references/registry.md`
- 逐 harness 接线(Claude Code / Grok Build / OpenCode / Pi / Cursor 各自 `harness-<name>.md` + capabilities 全景)→ `~/.agents/skills/jspace-use/references/harnesses.md`
- 无头执行运维(账号/配额/失败可见性)→ `~/.agents/skills/jspace-use/references/headless-ops.md`
- 首次启用 golden run → `~/.agents/skills/jspace-use/references/example-first-use.md`
- 使用里程验证(retro 无头首跑 / 两周写回取证 / 三飞轮清单)→ `~/.agents/skills/jspace-use/references/usage-mileage.md`

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
- `~/.agents/skills/jspace-use/references/harnesses.md` — harness 支持全景(capabilities render)+ 逐 harness 接线 `harness-{claude,grok,opencode,pi,cursor}.md`
- `~/.agents/skills/jspace-use/references/headless-ops.md` — 无头运维(账号/配额/失败可见性)
- `~/.agents/skills/jspace-use/references/example-first-use.md` — 首次启用 golden run(S5 产出)
- `~/.agents/skills/jspace-use/references/usage-mileage.md` — 使用里程协议(三飞轮关闭条件 + 取证台账 + 禁伪造红线)

> **Note**:官方 skill 只随 `jspace init` 物化;既有工作台经 `jspace workspace upgrade` 刷新(未修改的模板/skill 随升级更新,本地改动保留为 `skip`);`jspace init --force .` 对已有工作台会拒绝(用 upgrade,不用 init)。
