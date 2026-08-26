# 工作台资产布局与文档重构 — 官方资产落位原则 + AGENTS.md 重写 + 升级迁移

## Goal

JSpace 工作台的官方资产落位长期没有稳定原则:近三版官方 skill 连跳三次(根 `skills/` → `.space/skills/` → `.jspace/skills/`),每次迁移不彻底留下断链;工作台 `AGENTS.md` 是开发仓库 `AGENTS.md` 的派生(同 commit 诞生、共享骨架),角色错位;且官方 skill 移入 `.jspace/skills/` 后运行时引用没跟上,`compileSkillTarget` / inbox-tidy 守卫仍查根 `skills/`。本项目重构目标:确立并落地**资产放置原则**(入口面在根、其余一律 `.jspace/`),重写工作台 `AGENTS.md` 为独立工件,修复运行时 skill 路径,让升级能清理旧布局残留。**当前无使用者,不做兼容,直接重构。**

## 源需求

- **R1 放置原则**:确立「官方资产放根目录的唯一判据 = harness/人类必须在工作台根目录发现它」;其余 CLI 管理资产一律 `.jspace/` 下按所有权分子区。目录位置 = 所有权,不需要逐文件解释。原则落文档(父设计 + 子任务文档落地),现状路径保持不变(避免无谓 churn)。
- **R2 运行时修复**:官方 skill 物化在 `.jspace/skills/` 后,所有运行时引用同步——`compileSkillTarget`(cron skill 校验)、inbox-tidy 守卫、filehub notes 文案等不再查/指根 `skills/`;skill 路径收敛为单一来源函数(`skillRel`/`skillRoot`),消除「路径散落各处、改位置必然漏改」。
- **R3 升级迁移**:旧工作台(官方 skill 曾在根 `skills/`)升级到新布局时,未修改的旧官方副本随升级清理(不永久残留),本地修改过的保留并提示;升级保持 backup + journal + rollback。
- **R4 工作台 AGENTS.md 重写**:工作台 `AGENTS.md` 是**独立工件**,为「这个工作台」角色设计,不是开发仓库 `AGENTS.md` 的去个性化拷贝;删掉与 README / skill references 重叠的「产品实现」细节(升级所有权、cron 契约),保留行为规则;结构更薄、细节外指。
- **R5 文档同步**:开发仓库顶层文档(README/AGENTS/GOAL)、`.trellis/spec/backend/directory-structure.md`、`application/registry/filehub.ts` notes 中描述工作台布局/skill 路径的部分与新原则一致;gen-assets 重跑刷新嵌入资产。

## 任务地图

| # | 子任务 | 交付物 | 依赖 |
|---|---|---|---|
| C1 | `skill-path-single-source` | `skillRel`/`skillRoot` 单一来源;`definitions.ts` / `execute.ts` / `filehub.ts` 引用修正;测试 | 无 |
| C2 | `upgrade-stale-cleanup` | 升级清理未修改旧官方 skill 残留;legacy 测试反转;backup/journal/rollback 覆盖 | C1(skillRel 已存在) |
| C3 | `workbench-agents-redesign` | 工作台 AGENTS.md 重写为独立工件;放置原则落地(README/模板/开发 AGENTS.md/spec/GOAL);gen-assets 重跑 | C1 |

## 跨子任务验收(父级集成 gate)

- **X1** 全新工作台 `jspace init` 产物:官方 skill 仅 `.jspace/skills/`;`jspace cron install` 与 `cron run inbox-tidy` 的 skill 校验通过(不再报 `missing skills/...`);`doctor` 0 error。
- **X2** 模拟旧工作台(v1.0.5 布局,根 `skills/` 含未修改官方副本)升级:`.jspace/skills/` 就位、旧未修改副本被清理、本地修改过的保留;升级日志可 rollback。
- **X3** 工作台 AGENTS.md 重写后:无开发仓库 AGENTS.md 的骨架拷贝(结构独立);无 `skills/<name>` 旧路径;升级所有权/cron 契约细节不再内联(外指 README/references);gen-assets 生成块保持。
- **X4** `bunx tsc --noEmit`、`bun test`、`bun run scripts/check-skills.ts`、`bun run scripts/gen-assets.ts` 全绿;`git diff` 无意外路径残留。
- **X5** 用户真实工作台 `~/jspace-work`(v1.0.5 布局)在本机升级演练通过(如用户愿意);至少 dry-run 输出符合预期。

## Constraints

- bundle key(`skills/<name>/...`)与 gen-assets 结构**不变**——只改「key → 工作台路径」映射,回归面收敛。
- 放置原则下现状路径基本保持(官方资产仍在 `.jspace/skills/`,根 4 文件在根);本次以「原则固化 + 一致性 + 迁移」为主,不引入新的顶层目录。
- `.jspace/skills/` 不 gitignore(官方 skill 随工作台可提交/可移植)。
- 工作台 AGENTS.md 的生成块(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV)由 gen-assets 单源渲染,重写时保留标记、手改散文可自由调整。
- 删文件升级需走现有 backup + journal + rollback;仅「未修改的旧 seed 副本」可清理,用户内容永不自动删。
- 本次不新增 skill、不改 skill 内容逻辑、不动全局 skill(`harness-config` 的 `~/.agents/skills/...`)。
