# 工作台 AGENTS.md 块嵌入重构 + 放置原则文档落地 + gen-assets 重跑

## Goal

工作台 `AGENTS.md` **不自带完整独立文件**——模仿 Trellis 的 `<!-- TRELLIS:START -->` 块模式,`jspace init` 只在用户自己的 `AGENTS.md` 里**嵌入一段 JSpace 受管文本块**(`<!-- JSPACE:START -->`…`<!-- JSPACE:END -->`):块内由 jspace 维护(init 嵌入、upgrade 只更新块内),块外内容完全归用户、永不覆盖。同时把**资产放置原则**(入口面在根、其余一律 `.jspace/`,父 design D1)落地到工作台 README、开发仓库顶层文档、spec、filehub notes;gen-assets 重跑刷新嵌入资产。

## Requirements

- **R1 块嵌入模型**:`templates/workbench/AGENTS.md` 从「完整文件模板」改为「JSpace 块模板」——整体用 `<!-- JSPACE:START -->` / `<!-- JSPACE:END -->` 包裹,块内含工作台规则 + 两个生成子块(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV)。**不再提供"完整 AGENTS.md 模板"**;提供的是可嵌入的一段受管文本。
- **R2 init 嵌入**:`jspace init` 物化时——
  - 目标无 `AGENTS.md` → 创建含 JSPACE 块的最小文件;
  - 目标已有 `AGENTS.md` → **不覆盖**,在文件内嵌入/替换 JSPACE 块(块外用户内容原样保留)。
- **R3 upgrade 块更新**:`workspace upgrade` 对 `AGENTS.md` 不做整体 seed 刷新——只对比「目标现有块」vs「bundle 块」,不同则仅替换块内文本(整文件备份,journal 记录,rollback 恢复);块外用户内容永不触碰。所有权:块内 = 机器管理(managed),块外 = 用户(user)。
- **R4 放置原则落地 README**:`templates/workbench/README.md` 目录边界表按「位置即所有权」重写,去掉「与用户数据同目录但所有权不同」的解释段。
- **R5 开发仓库文档同步**:根 `README.md`、根 `AGENTS.md`、`GOAL.md`(仅前瞻性表述)、`.trellis/spec/backend/directory-structure.md` 中描述工作台布局/skill 路径的部分与新原则一致。
- **R6 生成物**:重跑 `scripts/gen-assets.ts`,`cli/assets.generated.ts` / `manifest.generated.ts` / `skills.generated.ts` 刷新;`check-skills` 全绿。

## Acceptance Criteria

- [ ] **AC1** `templates/workbench/AGENTS.md` 整体为 JSPACE 块模板(首行 `<!-- JSPACE:START -->`,末行 `<!-- JSPACE:END -->`),块内含 BRAIN-OPS / SKILL-GOV 两个生成子块;无完整独立 AGENTS.md 语义(块外无任何 JSpace 管理内容)。
- [ ] **AC2** `jspace init` 到空目录:生成的 AGENTS.md 只含 JSPACE 块(最小骨架);init 到已有 AGENTS.md 的目录(`--force`):块被嵌入,块外用户内容原样保留。
- [ ] **AC3** `workspace upgrade`:块内容变化时只更新块内、块外保留;块内容相同但块外被用户编辑 → `no-op`(不触发);rollback 恢复整文件。
- [ ] **AC4** 生成块(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV)渲染一致(`check-skills` C2/C3 绿);块标记被 gen-assets 保留。
- [ ] **AC5** 工作台 README「目录边界与升级范围」按位置即所有权表达;`.jspace/` 不再需要「同目录不同所有权」解释段。
- [ ] **AC6** 开发仓库 `README.md` / `AGENTS.md` / `GOAL.md`(前瞻)/ `directory-structure.md` 中工作台 skill 落位描述均为 `.jspace/skills/`,无旧 `skills/` 工作台语义残留。
- [ ] **AC7** `gen-assets` 重跑后 diff 干净;`bunx tsc --noEmit`、`bun test`、`check-skills` 全绿;全新 init 工作台的 AGENTS.md 为 JSPACE 块,`doctor` 0 error。

## Notes

- 块标记:`<!-- JSPACE:START -->` / `<!-- JSPACE:END -->`(对齐 Trellis 风格;BRAIN-OPS / SKILL-GOV 子标记保留)。
- 所有权模型变更:AGENTS.md 从「整体 seed」→「块 managed / 块外 user」。manifest ownershipFor 对 AGENTS.md 需调整(或 diff/upgrade 特殊路径)。
- 本任务不改 bundle key;不新增 skill;不改 skill 内容逻辑。
- 版本 bump 由父任务集成阶段决定。
