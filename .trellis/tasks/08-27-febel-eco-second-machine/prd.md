# Eco: 双机记忆与指针真实演练协议

## Background

- **M5（2026-08-03）** 本机模拟双机已通过：A `gbrain export` → B 独立 brain `import` + `embed --all` → 四条中文查询 top-1 与 A 一致 → `rel_path` 换机解析成立 →「问一句」引用机器 B 路径。
- **GOAL 开放问题 #1** 已关闭，结论「假设成立、双字段指针采用」；效力边界写明：**同机 / 同 OS / 同 embedding 可达**，真实第二机待实际使用。
- 指针纪律已落 skills（asset-ingest 写 `rel_path`、memory-recall §8 换机解析、`memory-acceptance.md`「换机解析扩展(M5)」）；存量迁移 runbook 见 `skills/asset-ingest/references/migration.md`。
- 本任务属 FEBEL **Eco**：交付物是**可复跑协议 + GOAL 回写槽**，不是在本云环境或同机再假装第二机。

## Goal

产出一份可在**真实物理第二机**上按步骤复跑的 gbrain + `rel_path` 演练协议，并在 `GOAL.md` 预留回写槽位，使实际使用后能诚实闭合「真实第二机」跟踪项——不伪造证据、不封装 gbrain。

## Requirements

### R1 — 协议定位（相对 M5）

- 本协议是 `skills/memory-recall/references/memory-acceptance.md`「换机解析扩展(M5)」在**真机**上的执行面，不另造第二套指针语义。
- **机器 A** = 已有工作台 + live gbrain + 已注册 filehub（含至少一份带 `rel_path` 的 asset 指针页与可召回语料）。
- **机器 B** = **另一台物理机**（不同主机名 / 不同本机绝对路径；OS 可同可异，须如实记录）。禁止用同机第二目录、`GBRAIN_HOME` 旁路或容器冒充 B 作为本任务关闭依据（那些仍属 M5 模拟效力）。
- 资产同步走既有分层策略（网盘 / Obsidian Sync / 手工拷贝均可），不自研同步；记忆走 gbrain Tier 3：`export` / `import` / `embed --all`（见 `skills/jspace-use/references/gbrain.md`）。

### R2 — 可复跑协议大纲（交付正文须覆盖下列阶段）

协议全文可落在本任务 `notes.md` / `research/real-second-machine-protocol.md`（执行期），或升级后中性摘入 `memory-acceptance.md`「真实第二机」小节；**PRD 阶段只要求大纲完整、字段可填**。

| 阶段 | 目的 | 关键动作（CLI 面，不封装） | 必过断言 |
|---|---|---|---|
| **P0 前置** | 两边可对照 | A：`gbrain models doctor --json`（embedding_config / reachability）；抽样 `gbrain get <slug>` 确认 frontmatter 含 `rel_path`；记录 A 侧 filehub 根与 ≥2 条规范查询（复用 M4/M5 Q1/Q1'/Q2/Q2' 或当前语料等价集）的 top-1 slug | A embedding 可达性留痕；目标页均有 `rel_path`；A 召回基线分数可复述 |
| **P1 A 导出** | 文本规范源离机 | 在 serve 停泊窗口内：`gbrain export --dir <export-dir>`；probe 产物为 md 页（slug 路径 + frontmatter）；记录是否有独立边/backlink 导出物 | 导出页数 ≥ 预期；`rel_path` 字段保留；边/backlink 状态如实记（有互链语料则验回灌，无则标 N/A） |
| **P2 B 建台** | 独立控制面 + 资产根 | B：`jspace init`（或既有工作台）→ `jspace filehub init <B根> --register`（**B 根绝对路径 ≠ A**）→ 资产按同步策略落到 B 根且 **相对布局与 `rel_path` 一致**；`jspace doctor` 无 filehub 致命项 | B filehub primary 可解析；抽样 `test -f "$(B根)/$(rel_path)"` 成立 |
| **P3 B brain** | 独立记忆库 | B：`gbrain init` **即带正确 embedding**（M5 教训：勿先 `--no-embedding` 再改维）；`gbrain import <export> --no-embed` → `gbrain embed --all`；`gbrain models doctor --json` | B brain 与 A 隔离；embedding_reachability ok（或显式降级路径见 R4）；import 页含原 `rel_path` |
| **P4 换机解析** | 指针可移植 | 对每条验收 slug：读 B `hub.json` filehub primary → `B根 + rel_path` → 得本机 Pointer → `test -f` →（可选）grep 关键数字；**不得**直接信任页内旧机绝对 `Pointer` | 解析成功且文件存在；记录「旧 Pointer ≠ 新 Pointer、rel_path 相同」 |
| **P5 召回对照** | 记忆可移植 | B 侧跑与 A 相同规范查询（含变体 + 负对照）；canonical 面 = CLI（与 `discipline.md` §1 一致） | 四条（或声明的最小集）top-1 slug 与 A 一致；负对照不串台 |
| **P6 问一句闭环** | 产品句验收 | 在 B 按 `memory-recall`：query → 四连（① get ② 用 **重解析后** Pointer `test -f` ③ 找数 ④ top-1）→ 作答 | 答案引用 **B 机绝对路径** + slug；不得只报「页里有」 |
| **P7 回写** | 闭合跟踪 | 填本 PRD「GOAL 回写槽」→ 更新 `GOAL.md` 开放问题 #1 / M5 跟踪句；真实证据留任务 notes（路径/主机名不进中性 skill 文档） | 槽位无空必填项；效力边界诚实 |

### R3 — 与既有文档的衔接（不漂移）

- 指针语义唯一源：`skills/asset-ingest/references/gbrain-write.md`「rel_path」+ `skills/memory-recall/references/discipline.md` §8。
- 回归断言复用：`memory-acceptance.md`「换机解析扩展(M5)」通过标准；本协议只加真机前置与回写字段。
- 资产未同步 / 缺 `rel_path` / 根读不到 → 按 discipline §5 诊断，报告用户，不改 gbrain、不静默改 Pointer。
- 存量收编若 B 侧缺文件：走 `migration.md` 增量策略，不把「搬文件」做成 jspace 新命令。

### R4 — 降级与替代关闭（允许写进 GOAL，须标效力）

| 情形 | 处置 | 可否关闭「真实第二机」跟踪 |
|---|---|---|
| B embedding 暂不可达 | `embed_skip` 已有页 + `gbrain search` 关键词冒烟 + 固定降级提示；**P4 换机解析仍必须过** | 仅可标「指针真机过 / 语义召回降级待复跑」，**不可**宣称与 M5 同等召回效力 |
| 用户长期只有单机 | 跟踪项保持开放；不得用本云/同机模拟关闭 | 否 |
| 图谱边/backlink | 有互链语料则 P1/P3 验正文 wikilink 是否仍在；无则 N/A（与 M5 一致） | 不阻塞指针/召回主结论 |

### R5 — GOAL 回写槽（执行真机后必填）

在 `GOAL.md`「开放问题 #1」与/或 M5「真实第二机待实际使用」句旁，按下列字段回写（日期 + 结论一句 + 指针到本任务 notes）：

| 字段 ID | 含义 | 填写示例形态 |
|---|---|---|
| `eco.date` | 真机演练日期 | `YYYY-MM-DD` |
| `eco.machine_a` / `eco.machine_b` | 主机标识（OS + 主机名或匿名标签，**勿提交私密家目录全文到 skill 中性文档**） | `macOS/arm64 · A` / `Linux/x86_64 · B` |
| `eco.path_divergence` | A/B filehub 绝对根是否不同 | `yes` + 相对差异说明 |
| `eco.asset_sync` | 资产如何到 B | `icloud` / `obsidian-sync` / `manual-copy` / … |
| `eco.export_import` | export→import→embed 是否成功 | `pass` / `fail` + 一句原因 |
| `eco.rel_path_resolve` | P4 抽样条数与结果 | `N/N pass` |
| `eco.recall_parity` | P5 top-1 与 A 一致？ | `pass` / `degraded-keyword` / `fail` |
| `eco.ask_loop` | P6 是否引用 B 路径 | `pass` / `fail` |
| `eco.edges` | 边/backlink | `pass` / `n/a-no-wikilinks` / `fail` |
| `eco.verdict` | 相对 M5 假设的真机结论 | `confirmed` / `partial` / `refuted` |
| `eco.lessons` | 新机 setup 教训（可追加 M5「init 即配 embedding」） | 自由短句 |
| `eco.evidence` | 证据位置 | `tasks/08-27-febel-eco-second-machine/notes.md`（本地-only） |

回写后 GOAL 文案目标态（示意，非现在就改）：

- 开放问题 #1：在既有「本机模拟」句后追加「**真实第二机：`<eco.verdict>`（`<eco.date>`）**」并链 `eco.evidence`。
- M5 子弹「真实第二机待实际使用」改为已验证或 partial，并保留效力边界（若 OS/embedding 仍同构须写明）。

### R6 — 非目标与红线

- **不封装 gbrain**；不新增 jspace「多机同步」子系统；不引入常驻运行时。
- **不**在 CI / Cloud Agent / 同机第二目录上把本任务标完成。
- **不**为关闭跟踪而伪造 `source:session` 或假造第二机路径证据（与 E/L 飞轮红线一致）。
- 本规划轮**不改业务代码**、不 `task.py start`；协议落地与 GOAL 回写属后续执行轮（真机可用时）。

## Acceptance Criteria

- [ ] **AC1** PRD（本文）含完整 P0–P7 协议大纲，且每阶段有可观察断言；明确机器 B = 物理第二机，排除同机模拟关闭路径。
- [ ] **AC2** 协议显式引用并服从既有纪律源：`gbrain-write.md` rel_path、`discipline.md` §8、`memory-acceptance.md` M5 扩展、`migration.md`、`gbrain.md` Tier 3；无冲突第二语义。
- [ ] **AC3** 「GOAL 回写槽」字段表（R5）齐全：日期、双机标识、路径分歧、资产同步、export/import、rel_path、召回、问一句、边、裁决、教训、证据路径；并给出 GOAL #1 / M5 句的目标回写形态。
- [ ] **AC4** 降级与替代关闭（R4）写明哪些可 partial、哪些不可关闭；图谱边保持 N/A 诚实路径。
- [ ] **AC5** Non-goals 含：不封装 gbrain、不云环境假绿、不改业务代码完成本规划交付。
- [ ] **AC6**（执行轮，非本规划关闭条件）真机跑完 P0–P7 后：R5 槽位填满 + `GOAL.md` 回写 + 证据在任务 notes；规划轮**不要求**本环境执行 P0–P7。

## Key Decisions

- **交付物 = 协议 + 回写槽**，不是再跑一遍本机模拟（M5 已裁决假设成立）。
- **真机定义收紧**：不同物理机 + 不同 filehub 绝对根；同机 `GBRAIN_HOME` 旁路仅作调试，不能关闭本跟踪项。
- **断言分层**：P4（rel_path）与 P5（召回）可独立记分，避免 embedding 暂不可达时整单作废或假绿。
- **证据分层**：主机真实路径/分数进本地 `notes.md`；REPO / skill 文档保持中性占位（与 memory-acceptance 约定一致）。
- **依赖**：无阻塞工程子任务；可与 B（平台台账）、L（使用里程）并行；真机窗口由用户实际换机触发。

## Non-Goals

- 在 Cloud Agent / CI 中模拟第二机并关闭 GOAL 跟踪
- 封装或 fork gbrain；自研文件同步或「一键换机」CLI
- 重做 M5 指针纪律或改 hub schema
- 本轮修改 `templates/` / `cli/` / `skills/` 业务源码或 `task.py start`

## Notes

- 父任务：`08-27-febel-post-m6-roadmap`（Eco 行）。
- 前序裁决证据（本地）：`archive/2026-08/08-03-m5-distribution/notes.md`。
- 轻量任务：PRD-only 即可进入「待真机执行」；若执行轮需拆命令级 checklist，再补 `implement.md`，仍不把同机模拟写入 Acceptance 关闭条件。
