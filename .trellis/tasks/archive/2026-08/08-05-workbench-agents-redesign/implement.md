# Implement — 工作台 AGENTS.md 重写 + 放置原则文档落地

任务上下文优先级:本文件 → `design.md` → `prd.md`。父 design D4/D6 已定结构与同步清单。**依赖 C1**(路径单一来源已就位);在 C2 之后实施(避免模板与升级逻辑互相踩)。

## 1 重写工作台 AGENTS.md(核心)

1. `templates/workbench/AGENTS.md` 按父 D4 新结构重写。保留:
   - Core Positioning(精简为「工作台是什么、开发回 dev-repo」)。
   - Daily Work Intake 分类表、Domain/Resource/Skill Governance(治理语义照旧,措辞更新)。
   - Durable Knowledge Routing、Registry Access(路径统一 `.jspace/skills/`)。
   - Confirmation Rules、End-of-Work Capture、Scheduled Tasks(cron 行为规则,去契约细节)。
   - Brain operations / Skill Governance 生成块(标记保留)。
   - Agents 段:保留声明式分层 + 项目级继承行,精简对象标签格式示例。
   删除/外指:
   - `## Workspace Upgrade & Ownership` → 并入 README(不在 AGENTS)。
   - cron 契约细节(weekly-report/memory-consolidate 输出契约)→ 不再复述(契约在 cron.json prompt)。
   - 升级所有权逐文件解释 → 由「位置即所有权」代替。
2. `templates/workbench/README.md`:
   - 结构清单加 `.jspace/skills/`(已在);「目录边界与升级范围」表重写为「位置即所有权」:根=入口(AGENTS/README/.gitignore/.claude)+用户区(workspace/根 skills//filehub);`.jspace/`=JSpace 管理区(用户数据 hub/cron + 官方 skill + 机器状态)。
   - 删「与用户数据同目录但所有权不同」解释段。

## 2 开发仓库文档同步

3. 根 `README.md`:核对工作台产物描述(`.jspace/skills/`)与新结构一致。
4. 根 `AGENTS.md`:「模式边界」段——工作台模板只含工作模式规则;补一句「放置原则:入口面在根,其余在 .jspace/」(描述工作台布局的部分)。
5. `GOAL.md`:仅前瞻性表述核对(里程碑历史不改)。
6. `.trellis/spec/backend/directory-structure.md`:工作台布局描述 + 放置原则一句。

## 3 生成物与门禁

7. `bun run scripts/gen-assets.ts`(刷新 3 个 generated + 重写工作台 AGENTS 生成块)。
8. `bun run scripts/check-skills.ts`、`bunx tsc --noEmit`、`bun test` 全绿。
9. 端到端:`bun run cli/main.ts init /tmp/jspace-smoke` → 检查生成的工作台 AGENTS/README 内容;`doctor --dir /tmp/jspace-smoke` 0 error。
10. grep 检查:工作台模板内 `skills/[a-z]`(无 `.jspace`)0 残留。
