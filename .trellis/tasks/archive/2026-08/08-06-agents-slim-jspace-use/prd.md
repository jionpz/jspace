# AGENTS 块瘦身 + jspace-use 承接治理细节

## Goal

`templates/workbench/AGENTS.md` 的 JSPACE 块从 ~190 行正文瘦到 ~100 行：只保留每会话都需要的**路由与红线**，把按需才用的**治理细节**（域创建信号、资源 schema、skill 提议规则、cron 运维）移入 `skills/jspace-use/SKILL.md` 新增的**第 8 章「治理细节」**。两处相互承接：AGENTS.md 块内顶部加指针指向第 8 章，第 8 章承接细节、不再与 AGENTS 互推。

## Requirements

### R1. AGENTS.md 块内重写为 ~100 行正文
结构按已确认骨架：

- **保留（可微调措辞，不删功能）**：定位段（精简为几句话 + gbrain 一句）、`Modes`、`Language`、`Daily Work Intake`（请求分类表不变）、`Registry Access`（三文件入口 + doctor）、`Durable Knowledge Routing`（路由表不变）、`Agents`、`Confirmation Rules`、`End-of-Work Capture`、`Quality Checks`。
- **精简**：
  - `Domain Governance` → ~6 行：域从真实使用涌现 + 建域前读 jspace-use 第 8 章（创建信号 / 最小形态 / 确定度分级在那边）。
  - `Resource Governance` → ~4 行：资源是域内可发现入口；schema/drift → `references/registry.md`。
  - `Development Mode` → 收敛为 3 步，升级所有权句指 README「目录边界与升级范围」。
  - `Scheduled Tasks (cron)` → ~2 行：session start 跑 `jspace cron check` + 上报失败/pending；运维细节 → jspace-use 第 8 章。
- **生成块不动**：`<!-- TRELLIS-SKILL-GOV -->` 官方 skill 列表、`<!-- TRELLIS-BRAIN-OPS -->` 解析行，及其说明行、marker 原样保留。块头注释（JSPACE:START 受管块说明）保留。

### R2. AGENTS.md 块内顶部指针
定位段之后加一行：治理与流程细节 → `.jspace/skills/jspace-use/SKILL.md` 第 8 章（按需读，不在此复制）。

### R3. jspace-use 新增第 8 章「治理细节」
承接以下内容（与 AGENTS.md 移除的原文一致，不丢失）：

- **域**：创建信号（≥2 条）、最小形态（workspace/<domain>/{README.md, domain.json}）、确定度分级（高置信直接建/中置信问一句/低置信保持一次性或挂已有域）、`workspace/<domain>/AGENTS.md`/runbook 何时加。
- **资源**：schema/drift 指针 → `references/registry.md`（不复制）。
- **skill**：提议信号（≥2 条）、禁区（一次性笔记/简单元数据/应进 AGENTS.md 的约定/大段内容）、用户确认前置。
- **cron**：session start 契约（跑 `jspace cron check` + 上报失败与 pending `.jspace-logs/*.APPLY.json`）、定义即代码（git 同步、应用前 review）、rehearsal gate（`jspace cron run` 先验一次）、运维细节指针 → `references/headless-ops.md`。
- **衔接**：清理 jspace-use 其它章里与 AGENTS 块重复/互推的句子（如「此处不复制，读那两处」这类回指），使 AGENTS → 第 8 章是单向承接；第 1 章「工作台模型」所有权部分保留（那是模型，不是治理细节）。

### R4. 不改生成机制与合同
- `scripts/skill-frontmatter.ts` / `scripts/gen-assets.ts` 渲染逻辑不改：散文改动经重跑 gen-assets 后不漂移（renderAgentsBlocks 只替换 marker 区间）。
- 本次不改 SKILL.md frontmatter（name/description/triggers），生成块内容随之不变。
- `application/workspace/agents-block.ts` marker 机制不动；块外用户内容不受影响。

## Acceptance Criteria

- [ ] `templates/workbench/AGENTS.md` 块内正文 ≤ ~110 行（含注释头与两个生成块）；各段按 R1 骨架；生成块 marker 完整、内容与之前一致。
- [ ] 块内顶部含指向 jspace-use 第 8 章的指针（R2）。
- [ ] jspace-use 新增第 8 章，含域 / skill / cron 三组治理细节 + 资源指针，与 AGENTS.md 移除的原文信息一致（R3）。
- [ ] jspace-use 不再出现与 AGENTS 块重复/互推的表述；各章衔接自然（R3）。
- [ ] 重跑 `gen-assets` 后 `git diff` 对模板为干净（无残余漂移）；`check-skills` C1–C4 通过（R4）。
- [ ] `bun tsc` + 全部测试通过（init / upgrade / agents-block / workspace 相关测试仍绿）。
- [ ] 全新 `jspace init` 到临时目录 → `jspace doctor --dir .` 0 error；块内为精简版。
- [ ] 对既有带 marker 工作台 `jspace workspace upgrade --dry-run` 显示 `block-update`（仅块内刷新），块外内容不动。

## Notes

- 这是内容/设计任务：不改渲染逻辑与合同。若实施中发现必须改 `skill-frontmatter` / `agents-block`，回到 Plan 更新本 prd。
- 「搭配」的含义：AGENTS.md = 常驻（每会话注入），jspace-use 第 8 章 = 按需读；顶部指针是两者之间的唯一入口。
