# JSpace 最终目标（North Star）

> 本文件是整个项目的**最高对齐物**：所有 PRD、任务拆分、范围取舍、暂缓决策都向它对齐。
> 根 `AGENTS.md` 的 Product Vision 是它的操作摘要；两者冲突时以本文件为准，并同步修订。
> 最后更新：2026-08-03。决策留痕见当期任务 PRD 的 Key Decisions。

## 一句话终局

在我的电脑上，从一个总控文件夹启动任何 AI harness（Claude Code / Grok Build / OpenCode / Pi / Cursor，codex 兼容 cron），就能带着准确的记忆开展任何工作；工作产生的重资产（pdf / ppt / excel / md …）被自动整理进文件管理中心；日积月累后，记忆可精准召回、资料整整齐齐；定期 AI 任务自动运行，不需要任何常驻程序。

## 使用画面（终局的一天）

1. **上午进入工作**：在工作台目录启动 `claude`（或 pi / codex）。会话读 AGENTS.md → 识别我在跟进「X 项目」→ 从 gbrain 注入 X 项目的最新事实（上次进展、待办、关键决策）→ 直接接着干，不需要我复述背景。
2. **收到一份客户 PPT**：丢进文件管理中心的 `_inbox/`。说一句"整理一下 inbox"，AI 把它改名为 `2026-08-01-acme-kickoff.pptx`、归档到 `projects/acme/decks/`、在项目 `index.md` 登记一行、往 gbrain 写一条事实（这份 deck 是什么 + 文件指针）。
3. **随口一问**："上季度 Acme 报价单里的单价是多少？" → gbrain 召回事实与文件指针 → 会话打开那份 excel 核对 → 给出答案并引用出处。
4. **收工**：会话结束前，本次的持久事实（带项目/域归属）自动写回 gbrain，产出文件归位到文件中心。
5. **夜里**：cron 触发无头 harness（`claude -p` / `codex exec` / `pi -p`）：清理 inbox 残留、生成本周项目周报 md 存进文件中心、把摘要写进 gbrain。
6. **换一台机器**：git 拉取工作台，资产由网盘/Obsidian Sync 同步，记忆层同步其文本源后重建索引——继续工作。

## 架构：一个控制平面 + 两个持久层

| 层 | 载体 | 内容 | 优化目标 |
|---|---|---|---|
| 控制平面 | 工作台（`jspace init` 生成） | 路由规则、注册表、域上下文、cron 定义 | AI 会话入口：轻、纯文本、git 同步 |
| 记忆层 | gbrain | 事实、知识图谱、embedding、**资产指针**；自带资料摄入/文件登记能力（兼作检索层） | 机器精准召回 |
| 资产层 | 文件管理中心（独立目录） | pdf/ppt/excel/md 等重资产 + 项目索引 | 人类可读可浏览（Obsidian 可打开）、整整齐齐 |

四大支柱：**路由**（任何 harness 从同一入口进对的域）、**记忆**（会话起点注入、终点写回、精准召回）、**资产**（自动归档、长期整齐）、**定时**（系统调度 + 无头 harness）。

**第五条:自省**（2026-08-10 补）——前四条负责"把事做成"，但纪律会无声腐化：该写回的没写、新项目没挂接、指针悄悄断掉、模糊项每周被跳过，这些都不报错。因此每周一次取证式自省（`workbench-retro` skill + 周日 cron），审计纪律执行、流程卡点与规则修订候选，产出分级建议清单（只提议不改）。**"越用越强"需要三个飞轮同时转:记忆、资产、以及工作流自身的进化。**

**粘合原则：记忆存"事实与指针"，资产存"文件本体"。** AI 消化一份文件的产出是两笔：文件归位（资产层）+ 事实与指针入脑（记忆层）。不做重资产的全量二进制 embedding——召回靠"事实命中 → 指针取件 → 现场打开"，而不是把 PPT 塞进向量库。

域与项目的关系：**域**是工作台里的长期工作区（`workspace/<domain>/`，轻上下文），**项目**是资产层的一级组织（`projects/<项目>/`，重资产）。域 README 登记本域进行中的项目并指向其资产目录，跟踪一个新项目 = 资产层建项目目录 + 域 README 挂一行 + 记忆层建实体。

## 资产管理协议（文件管理中心）

- **位置**：独立于工作台的目录（每机一个根路径，注册进 hub.json 作为资源）。分层同步：内容走网盘/Obsidian Sync，**不进工作台 git**。
- **形态**：markdown + 附件的普通文件夹，同时**可被 Obsidian 作为 vault 打开**。Obsidian 是"视图"不是"系统"：AI 只写纯 md 与 wikilink，不依赖任何插件；哪天换工具，资料一点不坏。
- **骨架**（PARA 变体，最小起步、靠使用涌现细化）：

  ```text
  filehub/
    _inbox/             # 一切新文件先落这里，等待整理
    projects/<项目>/    # 进行中项目：index.md + docs/ decks/ data/ notes/
    areas/<领域>/       # 长期职责域（无明确终点的工作）
    archive/<年>/       # 结项与冷资料
  ```

- **命名**：`YYYY-MM-DD-语义名-vN.ext`——机器可排序、人可扫读。
- **项目索引**：每个项目一份 `index.md`（现状、关键文件表、下一步），是人与 AI 共用的 dashboard；Obsidian 里它就是项目首页。
- **inbox 流程**：新文件进 `_inbox/` → AI（会话内一句话触发，或 cron 定时）分类、改名、归位、登记索引、写记忆。这是"自动整理"的具体机制——整齐不靠自觉，靠这条流水线。

## 记忆协议（精准召回从哪来）

- 会话开始：按域/项目检索注入；会话结束：把持久事实带归属（domain/project 标签、统一的实体 slug）写回。
- 资产入脑只入三样：**这是什么、关键事实、指针**；原文件永远留在资产层。指针 = `Pointer`（绝对路径，本机真理）+ `rel_path`（相对 filehub 根，机器无关，M5 起）；换机按「目标机 filehub 根 + rel_path」重解析。
- 精准 = 一致的实体命名 + 归属标签 + 写回纪律。三者由工作台规则与 jspace-use 指南保障，不靠人自觉。
- 各 harness 的会话能力分级（session-start / session-end / 显式 fallback / crash recovery 的 automated/best-effort/manual/unsupported）见工作台 `.jspace/skills/jspace-use/references/harnesses.md`「Lifecycle 能力矩阵」；本段为愿景措辞，实际能力以矩阵为准（不虚报自动化）。

## 定时自动化（cron）

- cron 定义存在工作台目录（声明式：调度 + 提示词 + harness + 目标域），`jspace cron install` 装进系统调度（crontab / launchd），无头执行，不引入常驻进程。
- 机械恢复层:`jspace ingest`(资料入库 journal,任一步失败补偿无孤儿、中断可续跑)与 `jspace pending`(gbrain 锁冲突写暂存,锁空闲幂等落 live)是失败可见性的代码保证;会话开始 `jspace cron check` 聚合未确认 incident 与 actionable pending。
- 首批任务画像：inbox 整理、项目周报、记忆巩固（归纳近一周事实）。它们都作用于资产层与记忆层——所以资产协议先于 cron 落地（见里程碑）。

## 同步与可移植（分层同步）

- 控制平面：git。
- 资产层：网盘 / Obsidian Sync（重文件不进 git）。
- 记忆层：gbrain 以文本页为规范源（DB/embedding 为派生、每机可重建）——**该假设已于 M5 本机模拟双机验证成立**（见 M5 与开放问题 #1 关闭结论）；退路"单机为主、按机重建记忆"暂不需要。
- registry 里的绝对路径是"本机真理"，按机器各自维护；资产指针经 `rel_path` 承载机器无关部分（M5 落地）；模板去个人化已在分发前完成。

## 非目标

- 不做常驻运行时、事件驱动/入站多端网关、自主代理（定时 ≠ 事件）。
- 不自研执行器、不封装 gbrain、不自研文件同步引擎。
- 不做重资产的全量二进制 embedding、不做"文件数据库"。
- 不强依赖 Obsidian 的任何插件或私有格式。

## 演进里程碑

- **M0 ✅** 工作台可生成、可校验（`init` / `doctor`）。
- **M1 ✅** 注册表可维护（R3 domain/resource 增删查 + R8 模板修正）——M2 的地基：文件管理中心经 `jspace resource add` / `filehub init --register` 注册。
- **M2 ✅** 资产层最小协议：`filehub init` 骨架 + `type: filehub` 注册 + inbox 批量整理 skill（两遍式 / 人工调整 / cron 可驱动）+ 域↔项目挂接规则 + 首次启用(first-use)文件中心引导。先定协议，历史才会整齐。
  - 待真实环境验证：① 示例资料「入库→gbrain 页→中文召回」端到端（live gbrain）——**已于 M4 验证通过**（2026-08-03，见 M4）；② 双机重建冒烟——**已于 M5 本机模拟验证通过**（2026-08-03，见 M5）。
- **M3 ✅** cron MVP（R4）：`.jspace/cron.json` 声明式定义 + `jspace cron install` + `cron run` 无头执行（argv 安全 + 权限白名单 + flock 互斥）+ 失败可见性（cron-failed + doctor 摘要 + status）。**跨平台调度后端**：macOS launchd / Linux crontab / Windows schtasks（一 cron 一任务，`--dir` 显式传 root，win 进程树杀）。首批任务：inbox-tidy（旗舰，驱动 M2 无头批量，每日 21:00）。纯函数单测 + 验证矩阵见 `docs/PLATFORMS.md`。
  - 待真实环境验证：`jspace cron run inbox-tidy` 端到端跑通后再依赖；Linux/Windows 真机验证待 CI 解锁。
- **M4 ✅** 记忆精度打磨：校准召回 + 端到端验收（"问一句，找到那个文件里的那个数"；不重设 M2 已锁 slug 骨架）。示例环境验收通过（2026-08-03：2 份示例资料经 asset-ingest 入库→gbrain reference 页→四条中文语义查询含语义变体/负对照/×3 重跑/search·query 双路径全 top-1 + 指针定位「12800 / 示例值」）。weekly-report / memory-consolidate 契约解锁（模板 `enabled: true`，契约内联 prompt；gbrain.md 新增 dated memory record 周快照纪律）。可复跑验收协议见 `skills/memory-recall/references/memory-acceptance.md`。
  - 待真实使用验证：机器端 `jspace cron install` 与首次 `cron run`（install 前 rehearsal gate）；语料增长后按 `skills/memory-recall/references/memory-acceptance.md` 复跑协议。
- **M5 ✅** 分发（R7）：模板去个人化、打包安装已提前落地（v1.0.1/一键安装/update/CI 6 平台全绿）。本机模拟双机演练通过（2026-08-03）：A `gbrain export` → B 独立 brain `import`+embedding 重建 → B 侧四条中文查询 top-1 与 A 一致 → **指针换机解析成立**（`rel_path` 相对 filehub 根，换机按「目标机根 + rel_path」重解析）→「问一句」闭环引用机器 B 路径。记忆层可移植假设验证成立；**开放问题 #1 关闭**（结论基于本机模拟，真实第二机待实际使用）。指针纪律落 `rel_path`（asset-ingest 写页 + memory-recall 换机解析 + MEMORY-ACCEPTANCE 扩展节）。
- **M6 ✅** 飞轮补全与漂移硬化（2026-08-10）：审查发现「建造质量远超使用里程」——记忆与资产有机制但转速近零，**工作流自省完全缺失**，且已建好的厚度没到使用现场（分发链过时、受管块外躺着 205 行旧模板全文）。交付：① `workbench-retro` skill（六条取证式检查 + 分级建议 + 只提议不改红线）+ 周日 cron，补上第三个飞轮；② weekly-report / memory-consolidate 契约从 `cron.json` 内联 prompt **升格为 upgrade 受管 skill**（user 数据冻结死角消除），新 init 的四个 cron 全为 `kind: skill`；③ jspace-use §8.7 项目生命周期 checklist（含「project id 用 ascii、资产目录保留中文、经 `--asset-rel-path` 绑定」的命名约定）；④ doctor 三个静默漂移检查（`agentsmd.stale_outside_block` / `skills.bundle_stale` / `registry.project_unlinked`）。官方 workbench skill 4 → 7（另有 global 段的 `harness-config` 机器级治理 skill，manifest 合计 8 个）。**开放问题 #3 全部闭合**（真实定时触发观察确认）。
  - 待真实使用验证：首次无头 `workbench-retro` cron（2026-08-16 周日 23:00）；写回腿的习惯养成（当前 gbrain 写入仍全部来自 cron，0 条来自日常会话）。
- 顺序理由：cron 的第一批任务操作资产层，故 M2 在 M3 前；里程碑随真实使用可重排，重排时更新本文件。

## 开放问题

1. **gbrain 多机**："同一份记忆"依赖文本规范源假设——**已于 M5 关闭（2026-08-03，本机模拟双机）**：A export → B import 重建 + embedding 重建 + 中文召回 top-1 与 A 一致 + 指针换机解析成立（`rel_path` 相对 filehub 根）。结论：假设成立、双字段指针采用；**真实第二机演练待实际使用**（本机模拟效力有限：同机/同 OS/同 embedding 可达；新机 setup 教训=init 即配 embedding）。图谱边/backlink 保留未验证（本语料无互链，边以正文 wikilink 承载）。
2. **文件管理中心选址与存量迁移**——**已闭合（2026-08-03）**：根=本机 filehub 目录（如 `~/filehub`，每机一个根，注册进 hub.json 的 `type: filehub` resource primary path）；同步策略=内容走网盘/Obsidian Sync（重资产不进 git），根目录本身可由网盘同步或暂不同步，换机按「目标机根 + rel_path」重解析（M5 已验证）；存量收编=增量（新走 inbox，旧按项目/领域按需），runbook 见 `skills/asset-ingest/references/migration.md`；真实使用时代入 runbook 验证。
3. **无头执行的运维**——**已闭合（2026-08-03）**：失败可见性硬化——`jspace cron failures`（alias `check`，聚合 cron-failed + pending 暂存写 + 各 cron 状态，需关注退出码 1）+ 工作台 SessionStart hook 自动检查（其他 harness 手动）+ doctor 摘要；账号/配额模型沉淀于 `skills/jspace-use/references/headless-ops.md`（cc-switch 代理 + failover、耗尽处置、敏感边界）；真实运行验证通过（成功路径 3 任务 real run ok；失败路径真实诱导 → cron-failed → check/doctor 闭环）。**真实定时触发已于 2026-08-10 观察确认**：launchd 自 08-07 起每日自然触发（08-07 21:14 inbox-tidy 失败 API 520 → incident 开 → 08-08 21:01 成功并 ack → 08-09 21:06 weekly-report / 22:11 memory-consolidate → 08-10 21:02 inbox-tidy 成功），证据在 `.jspace/logs/cron/` 与 `.jspace/state/runs|incidents/`，`jspace cron check` 汇总一致。本条**全部闭合**。
4. **office 文件解析深度**——**已闭合（2026-08-03，#4 深度抽取交付）**：零依赖抽取器 `skills/asset-ingest/scripts/office-extract.py`（xlsx 逐表 / pptx 逐页，幻影行过滤 + 每 sheet 行数上限），深度路径=伴生 `.extract.md` 落 asset 层 + 页内 Key Facts 策展（含关键数字 + 引文）；示例验收 top-1（关键数字命中）。细则 `references/deep-extract.md`；可复跑协议 `skills/memory-recall/references/memory-acceptance.md`「office 深度抽取扩展(#4)」。
