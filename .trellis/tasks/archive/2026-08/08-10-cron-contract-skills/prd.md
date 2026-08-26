# cron prompt 契约升格受管 skill

## Goal

消除审查发现的「契约冻结漂移死角」:`weekly-report` / `memory-consolidate` 的输出契约目前以内联 prompt 形式存在于 `.jspace/cron.json`——而 cron.json 是 user 数据、升级永不覆盖,契约自拷入用户工作台起即冻结,未来纪律进化永远到不了存量工作台。把契约移入 upgrade 受管的 skill 层。复杂任务:`task.py start` 前需补 `design.md` + `implement.md`。

## 背景与既有机制

- `templates/workbench/.jspace/cron.json` 中 inbox-tidy 已示范目标机制:`target: { kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "..." }`——cron 指向受管 skill,prompt 只留极薄引导。机制现成,本任务是把另外两个任务迁到同一机制。
- 两个契约现状(内联 prompt,见工作台 cron.json):weekly-report → `<filehub>/areas/周报/<YYYY-MM-DD>-周报.md` + gbrain `assets/周报/<YYYY-MM-DD>`;memory-consolidate → gbrain `memory/consolidate/<YYYY-MM-DD>` + 各 project state 回写。

## Requirements

- R1 契约落点:两个契约各落为受管薄 skill,或作为既有 skill 的 entrypoint(如 memory-consolidate 并入 memory-writeback 家族、weekly-report 独立)——归属由 design 决定,决策记 Key Decisions;与 08-10-skill-workbench-retro 协调避免重叠。
- R2 模板迁移:`templates/workbench/.jspace/cron.json` 两任务改为 `kind: skill` 指向;`skills-manifest.json` / `gen-assets` / Brain-ops 渲染同步。
- R3 存量工作台迁移路径:cron.json 是 user 数据,**不得静默改写**;提供明确迁移指引(upgrade 后提示 / doctor info / README 说明,形态 design 定),用户确认后一条命令或一次编辑完成。
- R4 契约不变性:迁移前后输出契约字节级语义一致(产物路径、slug、同周幂等覆盖语义均不变),不破坏既有 gbrain 页与周报文件。

## Acceptance Criteria

- [x] 新 `init` 的工作台 cron 三任务全部 `kind: skill`,内联长 prompt 消失。
  → `/tmp/jspace-cron-smoke` 四个 cron 全部 `kind: skill`(inbox-tidy/asset-ingest·batch、weekly-report/weekly、memory-consolidate/weekly、workbench-retro/weekly);doctor 0 error、无 legacy 提示。
- [x] rehearsal `jspace cron run weekly-report` / `memory-consolidate` 各一次:产物路径/slug/幂等语义与迁移前一致。
  → 两者 `--dry-run` 均编译通过,prompt 指向 `.jspace/skills/<name>/SKILL.md` 的 `weekly` 流程。契约逐字迁入 SKILL.md:weekly-report → `<filehub>/areas/周报/<周一>-周报.md` + `assets/周报/<周一>`;memory-consolidate → `memory/consolidate/<运行日>` + state 回写;同周幂等语义保持。
- [x] 存量工作台迁移指引存在且经本机 `~/jspace-work` 实际走通(用户确认后应用)。
  → 闭环实证:迁移前 doctor 报 `cron.inline_prompt_legacy` ×2(weekly-report、memory-consolidate)→ 按提示改为 target → doctor `0 error / 0 warning / 0 info`。指引同时写入 jspace-use §8.4。
- [x] `gen-assets` / `check-skills` / `check-harness-consistency` / CI 全绿;契约文本此后归 upgrade 管理。
  → tsc 0;`bun test` **538 pass / 0 fail**(+3 新单测);check-skills C1(103 refs)/C2/C3/C4;harness-consistency all pass;manifest-integrity 44 路径。

## Key Decisions

- **D1 两个独立薄 skill**(`weekly-report` + `memory-consolidate`),不做 entrypoint 复用:cron id == skill name == 它做的事,零指向层;两者作为独立 skill 才有自己的 gbrain triggers(会话内可说「生成周报」「巩固记忆」);并入 memory-writeback 会推翻其「周快照不归我写」的既有边界。代价 skill 数 5→7,以「保持薄 + description 写死 Do NOT use」缓解。
- **D2 迁移信号做成 doctor info 检查**(`cron.inline_prompt_legacy`),而非仅写文档:只写文档等于继续沉默,而本任务要消除的正是无声漂移。零误报设计——只在「cron 用内联 prompt **且** id 恰为官方 skill 名」时触发,自定义 cron(逃生舱)永不命中。
- **D3 契约逐字迁移 + 一处欠定义修补**:发现 memory-consolidate 用「运行日命名」+「同周覆盖」二者不自洽(周日跑完周二再跑会生成不同 slug,幂等失效)。修补方式不改既有页:SKILL.md 写死「重跑前先查当周是否已有 consolidate 页,有则覆盖那一页」。正常周日单次运行的 slug 与迁移前完全一致。
- **存量不破坏**:模板 cron.json 是 user ownership 不下发,老工作台保持内联 prompt 继续可用,只收到 info 级提示,由用户决定何时迁移。

## 实现记录

- 运行时链路无需改动:`compileSkillTarget`(`application/automation/definitions.ts:77`)本就校验 skill 存在 / entrypoint 合法 / 材料化是否过时,并组装 `阅读并执行 <SKILL.md> 的 <entrypoint> 流程:<input>`。
- doctor 侧改动极小:`CronLike` 加 `target?: {skill: string}` 结构视图 + `checkCrons` 内一个循环;3 个单测(阳性 / 已迁移阴性 / 自定义 id 阴性)。
- 本机迁移备份:`~/jspace-work/.jspace/cron.json.bak-20260810`。
