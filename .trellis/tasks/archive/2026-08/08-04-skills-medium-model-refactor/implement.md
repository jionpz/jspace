# Implement — Skills 重构:面向中等模型可执行性

> 有序执行清单。对齐 `design.md`。每阶段有验证 + review gate。可直接 break,无迁移通道。

## 执行顺序总览

结构先于内容:**元模板 → spike 路由 → asset-ingest 样板 → 其余 4 skill → 范例 → 自检脚本 → 语言统一 → 集成验证**。asset-ingest 作为第一个套模板的样板,验证元模板可用后再铺开。

---

## Stage 0 — 基线快照(rollback point)
- [ ] `git status` 干净;记录当前 commit hash 作为回滚点。
- [ ] 跑一次现有测试基线:`bunx tsc --noEmit` + `bun test`,确认全绿(改动前的对照)。
- [ ] 确认 `git log` 无未提交 skill 改动。

**Gate**:基线绿。任何阶段失败可 `git checkout -- skills/ templates/` 回此点。

---

## Stage 1 — 元模板标准(R1)
- [ ] 写 `.trellis/tasks/08-04-skills-medium-model-refactor/research/skill-template.md`:固定小节骨架 + 编写规范(见 design §2)。
- [ ] 定义行数纪律与「什么进主文件、什么下沉 reference」的判据。

**Gate**:模板 self-review——能否套进 asset-ingest?若不能,修模板再继续。

---

## Stage 2 — Spike:gbrain resolver 路由格式(R4 前置)
- [ ] 查证 gbrain resolver row 的实际格式要求:读工作台 `AGENTS.md`「Brain operations」现有格式 + gbrain 文档/行为,确认关键词来源。
- [ ] 确认 `triggers` 是否已在 `core/contracts/skills.ts` 的 SkillsManifestV1 内;不在则定如何扩(加字段 + decoder)。已查证:triggers 即 gbrain resolver 关键词来源(见 design §4.1),子决策"关键词从哪来"已关闭——**就是 triggers 本身**。
- [ ] 跑一次手工渲染对照:取现 AGENTS.md 两块,确认"生成器输出"应与现状逐字一致(零行为变化回归基线;先手算一次,再写生成器对齐)。
- [ ] R4 方案已定 A(生成器),无需再做 A vs B 选择;把此定案与查证写回 design.md §4(留痕)。

**Gate**:路由单源方案确定。**这是 R4 的关键决策点,定错会返工**,故独立成阶段先做。

---

## Stage 3 — asset-ingest 样板(R2,第一个套模板)
- [ ] `SKILL.md` 套元模板:批量模式(65–97 行)收成条件指针 → `references/batch.md`;深度抽取 → 条件指针。
- [ ] 去重:主文件与 `batch.md` 重复的 cleanup-pending/journal 段落,单源留 `batch.md`,主文件留命令速查 + 指针。
- [ ] triggers:保留 frontmatter 字段(它是 gbrain resolver 关键词单源);仅核实内容与新结构一致,不改不删。真正的"渲染 AGENTS.md 两块"在 Stage 6。
- [ ] 补决策表(归属/查重/类型)+ 命令速查(ingest 全签名)+ 自检行。

**Gate**:asset-ingest 主文件达行数纪律;references 引用未断(手查);元模板证明可用。**若此处发现模板缺陷 → 回 Stage 1 修模板**(Phase 回滚)。

---

## Stage 4 — 其余 4 skill 套模板(R2)
- [ ] `memory-recall`:套模板;未命中诊断五类提为决策表。
- [ ] `memory-writeback`:套模板;分类表提为决策表。
- [ ] `jspace-bootstrap`:套模板;Phase 精简,命令速查集中。
- [ ] `harness-config`:套模板;Phase 保留。
- [ ] triggers:`triggers` 字段全部保留(单源),本阶段不做手脚;实际渲染见 Stage 6。

**Gate**:5 个 SKILL.md 全部套模板;triggers 字段保留完好(注意不再标"无 triggers"——已更正为"保留")。

---

## Stage 5 — golden-run 范例(R3)
- [ ] `asset-ingest`:`references/example-ingest.md`,覆盖 journal 四步 + 一次 cleanup-pending 收尾,复用 52期体验营/2 文档语料。
- [ ] `memory-recall`:范例复用 `memory-acceptance.md` 的 Q1/Q2 四连断言。
- [ ] `memory-writeback`、`jspace-bootstrap`、`harness-config`:各 1 个精简范例。
- [ ] 各 SKILL.md 的「Golden run」小节指向对应 example 文件。

**Gate**:每 skill 有可照抄的端到端范例。

---

## Stage 6 — 单源化路由落地(R4)
- [ ] 写 `gen-assets` 渲染逻辑(R4 已定方案 A):读 `skills-manifest.json` + 各 SKILL.md frontmatter(`name`/`description`/`triggers`)→ 渲染 `templates/workbench/AGENTS.md` 两个块到标记区间(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV);区间外保留。
- [ ] 先给 AGENTS.md 两块加标记区间(注释提示"区间内机器生成,勿手工编辑"),再让生成器只替换区间内行。
- [ ] 对照 Stage 2 的手工基线,确认生成器输出与现状逐字一致(零行为变化);若有变,校准渲染器直到 diff 为空。
- [ ] 若生成器引入回归(`assets-reachability.test.ts`/`init` 冒烟失败):fallback 手工维护两块 + 自检校验,不阻塞 skills 瘦身主线。

**Gate**:路由单源确立。

---

## Stage 7 — 自检脚本(R6)
- [ ] 写 `scripts/check-skills.ts`:C1 断链 / C2 渲染一致(「Brain operations」resolver rows 与各 SKILL.md `triggers` 逐字一致;「Skill Governance」描述与 frontmatter 一致) / C3 路由完整(两块的 skill 集合 == `skills/` 下 workbench skill 集合,排除 harness-config) / C4 生成物新鲜(重跑 gen-assets 后 git diff 干净)。
- [ ] 跑 `bun run scripts/check-skills.ts` → 全 PASS。

**Gate**:自检 PASS。

---

## Stage 8 — 语言统一(R5)
- [ ] `asset-ingest`/`memory-recall`/`memory-writeback` 叙述统一中文;命令/frontmatter key/配置键保留英文(逐句 review,不误改)。
- [ ] `jspace-bootstrap`/`harness-config`:成本低则顺手,否则跳过(PRD 允许)。

**Gate**:三个高频 skill 语言一致;命令/键未被误改。

---

## Stage 9 — 集成验证(AC6 + AC1)
- [x] `bun run gen-assets`(或 `build`)重跑,同步嵌入式资产。
- [x] `bun test` 231 pass → 242 pass(含 scheduler 新增)。
- [x] `bunx tsc --noEmit` 通过。
- [x] `bun run cli/main.ts init /tmp/jspace-skills-smoke` → `doctor` 通过;物化 skills 带 triggers/决策表/golden runs。
- [x] `bun run scripts/check-skills.ts` → C1-C4 PASS。
- [x] **AC1 核心验收**:`scripts/prepare-ac1.sh` 准备隔离环境 → Haiku 模型冷跑(Agent 子代理,仅凭 SKILL.md + 按需 references)→ `scripts/check-ac1.sh` **5 pass / 0 fail → 通过**。transcript 见 `research/ac1-haiku-transcript.md`。
- [x] AC1 done → `python3 .trellis/scripts/task.py archive 08-04-skills-medium-model-refactor`

---

## Rollback points
- Stage 0 是总回滚点(`git checkout -- skills/ templates/ scripts/ cli/*.generated.ts`)。
- 每 Stage 独立可回退;Stage 3 发现模板缺陷回 Stage 1(Phase 回滚,不硬推)。

## 验证命令速查
```bash
bunx tsc --noEmit
bun test
bun run gen-assets
bun run cli/main.ts init /tmp/jspace-skills-smoke
bun run cli/main.ts doctor --dir /tmp/jspace-skills-smoke
bun run scripts/check-skills.ts
```
