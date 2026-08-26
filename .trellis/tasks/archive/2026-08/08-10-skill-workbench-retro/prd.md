# workbench-retro 周自省 skill

## Goal

补齐「越用越强」缺失的第三个飞轮:新增官方 skill `workbench-retro`,把「工作流/纪律/skill 自身的进化」从碰运气变成每周机制。复杂任务:`task.py start` 前需补 `design.md` + `implement.md`。

## 背景

审查(2026-08-10)判定:记忆飞轮(writeback/consolidate)与资产飞轮(asset-ingest/inbox-tidy)有机制,但没有任何机制回顾「纪律有没有被执行、流程哪里反复卡、规则/skill 该怎么修」。开发仓自己有 Trellis+spec 进化闭环,工作台侧为零。jspace-use §8.3 只回答「何时新建 skill」,不回答「何时修订」。

## Requirements

### R1 输入(近一周使用痕迹,全部只读)

- gbrain 近一周页面变更(state 页、consolidate 页、assets 页)。
- `<filehub>/.jspace-logs/`(inbox-batch 日志、pending 暂存)与 `jspace cron check` 结果。
- `workspace/<domain>/` 与 filehub 结构变更(新项目/新文件是否按纪律挂接)。

### R2 检查维度(纪律执行审计)

- 写回纪律执行率:本周会话是否有该写未写的持久事实(state 页久未更新 vs 明显有活动)。
- 挂接一致性:filehub 新项目是否进域表/hub;资产是否有 gbrain 指针页。
- 流程卡点:重复出现的失败/降级(召回未命中、pending 堆积、cron 失败)。
- 规则进化候选:反复出现的非显然流程 → 按 jspace-use §8.3 信号提议 skill 新建**或修订**;域 README 应沉淀的新惯例。

### R3 输出

- 一份修订建议清单(分:立即可做 / 需用户决策 / 观察中),呈用户确认;**不自动修改任何规则、skill、README**(红线:进化动作全部需确认)。
- 按 dated memory record 纪律写 gbrain 页(如 `memory/retro/<YYYY-MM-DD>`,同周重跑覆盖同页,具体 slug 设计定)。

### R4 交付物范围

- `skills/workbench-retro/`(SKILL.md + 必要 references,含触发词如「周自省」「retro」)。
- `skills-manifest.json` 注册 + `gen-assets` 重跑(Brain-ops/SKILL-GOV 块自动渲染)+ 各投影物化。
- 触发形态:会话内触发词为基线;是否另挂 cron 或并入 memory-consolidate 后半段,由 design 决定(与 08-10-cron-contract-skills 协调,避免两处改同一契约)。

## 约束

- 遵循现有 skill 形态学:薄入口 + 决策表 + 命令速查 + golden run + 自检;引用统一 `~/.agents/skills/<skill>/...`。
- 无头模式(若挂 cron)只产报告不做变更,与 inbox-tidy 的「无头零提问」同风格。

## Acceptance Criteria

- [x] `check-skills` / `check-manifest-integrity` / `gen-assets` 无残留 diff;CI 绿。
  → `bunx tsc --noEmit` 0;`bun test` 535 pass / 0 fail;check-skills C1(97 refs)/C2/C3/C4 全过;check-harness-consistency all pass;check-manifest-integrity 42 路径存在且被跟踪。
  → 过程中红过两次并修复:C1 一处裸 `references/checks.md`(改为 `~/.agents/skills/...` 形式);manifest-integrity 要求新文件先 `git add`(issue #6 的 gitignored-source 防线,符合预期)。
- [x] `/tmp` smoke `init` 后新 skill 在 `.jspace/skills/` 与各投影齐备,AGENTS.md 受管块 Brain-ops 含其触发词。
  → `/tmp/jspace-retro-smoke`:5 处投影(`.jspace/ .claude/ .agents/ .grok/ .opencode/`)均含 `workbench-retro/{SKILL.md,references}`;Brain-ops 自动渲染出 retro 行;cron.json 含第 4 个任务(`target=workbench-retro`,`enabled=false`);doctor 0 error。
- [x] 在本机工作台跑一次真实 retro:产出建议清单 + gbrain retro 页,且未发生任何未经确认的规则修改。
  → gbrain `memory/retro/2026-08-10`(id 54,`type: note`,`tags: [retro, weekly]`)。产出 立即可做 2 / 需你决策 3 / 观察中 1 / 无法判定 1 + 7 项基线数据。全程零文件修改,doctor 前后一致(0/0/0)。
- [x] GOAL「终局的一天」对照表中「工作流自省」不再是零覆盖(父任务验收引用)。
  → skill(SKILL.md 109 行 + checks.md 六条取证细则 + example-retro golden run)+ cron 通道(周日 23:00,已装 launchd)双通道覆盖。

## Key Decisions

- **D1 独立 skill**(不并入 memory-writeback/consolidate):按 jspace-use §8.3 命中 4 条提议信号;并入会污染既有 skill 的单一职责。
- **D2 会话触发 + cron 双通道**:只做会话触发是自指陷阱——审计「该做没做」的机制若自身依赖人记得触发,会和写回一样停摆;而 cron 腿已证稳定(08-07 起每日自然触发)。新 cron 直接用 `kind: skill` 形态,不产生新的契约冻结死角,并为 08-10-cron-contract-skills 提供迁移范例。排期 `0 23 * * 0`,在 consolidate(22:00)之后以便消费其产出。
- **D3 输出 = gbrain dated page + cron 自带日志**:不写 filehub(retro 是治理产物非资产,写进去会污染资产层语义);人可读落点复用 cron 框架已有的 `.jspace/logs/cron/<id>/<ts>.md`。
- **D4 取证强约束**:每条结论必须绑定实际命令输出,拿不到证据写「无法判定 + 缺什么 + 怎么补」。首跑即验证有效——检查 6 的语义面在 12 页小语料下失效,被诚实记为无法判定而非编造结论。
- **D5 只提议不改**(红线):无头模式一律不改;会话模式下逐项确认后才执行。
- **存量迁移**:模板 cron.json 是 user ownership,新 cron 不随 upgrade 下发;本机已手动添加并 `cron install`(launchd 新增 1 个 agent,未触碰既有 3 个)。通用迁移通道留给 08-10-cron-contract-skills。

## 实现记录

- 零 TS 逻辑改动 —— 新增 skill 全由 `skills-manifest.json` 驱动,是单一事实源架构的红利。仅 4 处文档字符串硬编码「4 个」需手改(AGENTS.md / README.md / core/contracts/skills.ts 注释 / gbrain.md)。
- 首跑发现的问题已回流:遗留测试页 `assets/foo/doc`、契约外 type(`concept`/`project`)→ 后者印证 08-10-doctor-drift-checks 的 R4 有真实需求。
