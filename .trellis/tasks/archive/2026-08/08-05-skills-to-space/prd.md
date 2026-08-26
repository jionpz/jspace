# 官方 skill 移入 .jspace/skills/ — 与用户自建 skills/ 分离

## Goal

`jspace init` 生成的 JWorkspace 把官方打包 skill 落在根 `skills/`,与「用户自建 skill 保留地」的命名空间混在一起,且工作台 AGENTS.md Governance 又写着不要建根 `skills/`——自相矛盾。目标:官方打包 skill 移入隐藏目录 `.jspace/skills/`,根 `skills/` 明确归用户自建;存量工作台升级不破坏、不静默丢改动。

## Requirements

- **R1 落位**:官方 workbench skill(`jspace-bootstrap` / `asset-ingest` / `memory-recall` / `memory-writeback`)在 `jspace init` 产物中从根 `skills/` 移至 `.jspace/skills/`。bundle key / ownership / gen-assets 内嵌资产结构**不变**(仅「bundle key → 工作台路径」的物料化映射变化)。
- **R2 根 `skills/` 归用户**:工作台模板 AGENTS.md「Skill Governance」措辞澄清——根 `skills/` 为用户自建 skill 保留地;官方 skill 位于 `.jspace/skills/`(机器管理,seed 语义不变:未改动被 upgrade 刷新,改过保留)。
- **R3 引用同步**:所有指向工作台 skill 的路径引用更新到 `.jspace/skills/`——工作台 AGENTS.md / README.md、`jspace init` 提示文案、仓库顶层文档描述工作台的段落。
- **R4 内部交叉引用**:skill 文档内跨 skill 的写死路径(`skills/<other>/...`)改为「开发仓库 + 工作台」两侧都可解析的引用,不留指向旧路径的死链。
- **R5 旧工作台兼容**:升级不引入自动化迁移——新 `.jspace/skills/` 由 upgrade 按 create 就位,旧 `skills/` 报 stale 不自动删;用户改过的官方 skill 不静默丢失(改动保留在旧目录,新副本按 bundle 就位),并给出清理指引。
- **R6 发布同步**:版本 bump 1.0.6 → 1.0.7 + 重跑 gen-assets + 重编译二进制;安装后的新工作台走新落位。

## Acceptance Criteria

- [x] **AC1** `materializedRel("skills/<name>/SKILL.md")` → `.jspace/skills/<name>/SKILL.md`;`ownershipFor("skills/<name>/SKILL.md")` 仍为 `seed`。
- [x] **AC2** 源码态 `jspace init` 到临时目录:官方 skill 出现在 `<dir>/.jspace/skills/<name>/`;根 `skills/` 无官方内容;`init` 提示文案指向 `.jspace/skills/jspace-bootstrap/SKILL.md`。
- [x] **AC3** 新工作台 AGENTS.md / README.md 中 skill 路径均为 `.jspace/skills/`;gen-assets 渲染块与 SKILL.md frontmatter 一致(C2 绿)。
- [x] **AC4** skill 内跨 skill 引用无 `skills/<other>/...` 残留指向旧工作台路径;`bun run scripts/check-skills.ts` C1/C2/C3/C4 全绿。
- [x] **AC5** 更新后的 manifest / workspace / init 相关用例 + `bun test` + `bunx tsc --noEmit` 全绿(CI R5 门)。
- [x] **AC6** 用 v1.0.6 初始化的旧工作台,新代码 `workspace diff` 报 `.jspace/skills/` create + 旧 `skills/` stale;`upgrade` 后 `.jspace/skills/` 就位、旧 `skills/` 未自动删除。
- [x] **AC7** 重编译 `bin/jspace` 后 `jspace init` 临时目录验证新落位;`jspace --version` 报 1.0.8。
- [x] **AC8** 仓库顶层文档(README.md / AGENTS.md / docs/PLATFORMS.md)描述工作台 skill 落位与实现一致;GOAL.md 仅前瞻性表述同步,历史 milestone 记录不改。

## Notes

- **约束**:bundle key 保持 `skills/<name>/...` 不变 → gen-assets、`cli/assets.generated.ts` / `manifest.generated.ts` key、assets-reachability / lifecycle 测试(断言 bundle key)均零改动,回归面收敛到 2 个映射点。
- `.jspace/skills/` 不 gitignore:官方 skill 继续随工作台仓库可提交 / 可移植,与现状 `skills/` 被提交一致。
- **边角**:用户改过官方 skill 时,新 `.jspace/skills/` 副本不携带改动——旧改动留在 `skills/<name>/`(upgrade 报 `seed: local content kept`),文档提示用户对比 / 迁移后手动清理。
- 本任务**不含**:新增 skill、改 skill 内容逻辑、全局 skill(`harness-config` 的 `~/.agents/skills/...`)迁移。
