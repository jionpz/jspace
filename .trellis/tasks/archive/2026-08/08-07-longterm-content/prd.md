# 内容对齐长期使用：AGENTS.md 瘦身 + 日常路由 + 退役体检

> 子任务 C of `08-06-workbench-context-wiring`。父任务持有问题全貌与跨子任务验收。
>
> **依赖（必须写在这里，不靠父子树位置表达）**：
> - C 的「AGENTS.md 瘦身」**依赖子任务 A 完成**——官方 skill selector 接管之后，
>   `Skill Governance` 渲染块才成为冗余；A 未完成就删会造成 skill 彻底失联
> - C 的「日常路由章补强」**依赖子任务 B 完成**——要引用 hook 注入的块名（`<current-state>` /
>   `<next-action>`），B 未定稿就写会指向不存在的东西
> - 因此 **C 必须最后启动**。可在 A/B 进行中撰写草稿，但不得在 A/B 验收前应用改动

## Goal

让工作台的**内容**撑得住长期日常使用：常驻块只留真常驻的规则，日常入口真正可用，
以及给"用久了会变脏"的部分补上退役与体检机制。

父任务 P3 的三条缺口对应本任务三块交付物。

## 背景（父任务 P3 摘要）

1. **没有"第 N 天"的入口**：`jspace-use` 自称长期指南，8 章里首启（第 2 章）与
   维护诊断（第 6/7 章）占主要重量；第 3 章「日常会话路由」仅 6 行，
   且内容是"路由规则以 `AGENTS.md` 为准，本指南不复制"——外包给一个 harness 读不到的文件
2. **常驻块塞了不常驻的东西**：`Skill Governance` 段整段复制 4 条 SKILL.md description、
   `Brain operations` 段又复制一遍 triggers，共约 15 行（占 JSPACE 块 111 行的 1/7），
   都是给"选 skill"服务的——而子任务 A 完成后，Claude Code 用官方 selector 直接读
   `.claude/skills/*/SKILL.md` frontmatter，这两段对它变成纯冗余
3. **只有准入，没有退出**：建域有创建信号（≥2 条）、禁止清单、确定度分级；
   但僵尸域、失效资源指针、该归档的结项项目、停在三个月前的 `project/<id>/state`
   全无机制。`jspace doctor` 只查结构合法性（JSON 合法、目录在、id 一致），不查"是否还活着"。
   `GOAL.md` 骨架里有 `archive/<年>/`，但没有任何 skill 负责往里挪

## Requirements

### C1 — AGENTS.md JSPACE 块瘦身
- **C1.1** `Skill Governance` 段的 4 条 description 全文复制**移除**，
  代之以一句治理约定 + 指向 jspace-use 第 8 章的指针
- **C1.2** `Brain operations` 段**保留**——gbrain resolver 解析它做 skill 路由。
  **前置验证**：必须先确认 gbrain 实际读的是哪个文件、是否真依赖工作台 `AGENTS.md`；
  未确认前不得改动该段（详见 `design.md` §2）
- **C1.3** `Development Mode`（3 步）与 `Registry Access` 的 jq 用法细节下沉到
  jspace-use 第 8 章 / `references/registry.md`，常驻块只留一句指针
- **C1.4** `Durable Knowledge Routing` 表精简，保留路由语义、去掉可推导的解释
- **C1.5** 瘦身后 JSPACE 块行数较当前 111 行显著下降；官方建议 `CLAUDE.md` 控制在 200 行内，
  而工作台 `CLAUDE.md` 通过 `@AGENTS.md` 导入整个文件（含块外用户内容），预算要留给用户

### C2 — jspace-use 日常章补强
- **C2.1** 第 3 章「日常会话路由」重写为真正的日常入口，不再整章外包给 AGENTS.md
- **C2.2** 至少覆盖四个真实高频场景：进入工作台（hook 已给状态，按 `<next-action>` 走）、
  进入某个域、收工、每周体检
- **C2.3** 引用子任务 B 定下的块名与字段，措辞与实际注入内容一致
- **C2.4** 与 AGENTS.md 保持"不复制、只指引"的既有纪律，不制造第二个事实源

### C3 — 退役与回收
- **C3.1** 在 jspace-use 第 8 章新增「退役与回收」小节，与既有创建规则对称：
  僵尸域、失效资源指针、待归档项目、陈旧 `project/<id>/state` 各自的判定与处置
- **C3.2** 处置动作必须**明确要用户确认**——涉及删除/移动，撞治理红线"未经确认不执行破坏性操作"
- **C3.3** `filehub` 结项项目归档到 `archive/<年>/` 的动线补齐（`GOAL.md` 骨架已有该目录，无人负责）

### C4 — doctor 体检诊断
- **C4.1** 新增 `info` 级诊断（**不用 warning**，避免日常噪音）：
  - `domain.dormant` — 域目录长期未更新
  - `resource.primary_missing` — 资源 primary 路径不存在（**先确认现有是否已覆盖**，避免重复）
  - `filehub.project_stale` — `filehub/projects/<x>/` 长期未动，建议归档
- **C4.2** 阈值可配且默认保守（宁可漏报不可每天刷屏）
- **C4.3** 不引入 gbrain 依赖（`project/<id>/state` 陈旧检测因此**本轮不做**，记入开放问题）

## Acceptance Criteria

- [ ] AC-C1 JSPACE 块行数较 111 行显著下降，且 `bun run scripts/check-skills.ts` 通过
- [ ] AC-C2 gbrain 对工作台的 skill 路由在瘦身后**实测仍正常**（C1.2 的前置验证结论落到文档）
- [ ] AC-C3 `jspace-use` 第 3 章覆盖四个高频场景，措辞与子任务 B 实际注入的块名一致
- [ ] AC-C4 第 8 章「退役与回收」小节与创建规则对称，处置动作均标注需用户确认
- [ ] AC-C5 `jspace doctor` 三条 `info` 诊断可正确报出与消除；干净工作台**不产生新噪音**
- [ ] AC-C6 `bun run scripts/gen-assets.ts` 后 `git diff` 干净；`check-skills` C1-C4 全过
- [ ] AC-C7 `bunx tsc --noEmit`、`bun test` 全绿
- [ ] AC-C8 仓库 PUBLIC：新增示例一律中性占位（`acme` / `~/filehub` 一类），无真实个人数据

## 非目标

- 不做自动写回（子任务 B 的 D3 已定：Claude Code 无 session-end hook，本轮不虚报该能力）
- 不引入 gbrain 依赖到 doctor
- 不改物化路径与 hook 机制（A/B 的范围）
- 不自动执行任何退役动作——只给规则与诊断，执行由用户确认

## Key Decisions

- **D1｜`Brain operations` 段保留、`Skill Governance` 段移除**。两段看起来对称，
  但依赖方不同：前者被 gbrain resolver 解析（外部消费者），后者只服务于让 AI 选 skill
  （子任务 A 后由官方 selector 接管）。**对称的外形不等于对称的依赖**，
  删除前必须逐个确认消费者。
- **D2｜体检诊断用 `info` 而非 `warning`**。这类"用久了会脏"的提示每天都会命中，
  用 warning 会让 `doctor` 从"出事才看"退化成"每天刷屏然后被忽略"。
  `info` 级保证它在需要时可查、不在日常碍事。
- **D3｜退役只给规则与诊断，不自动执行**。删域/移文件是破坏性操作，
  全局治理红线要求"未经确认不执行"。这也是为什么 C3.2 把"需用户确认"写成硬性要求
  而不是建议。
