# FE: 合并 PR#26 前台小修落地

> FEBEL **F**（Front）子任务。父任务：`.trellis/tasks/08-27-febel-post-m6-roadmap/prd.md`。
> 对象 PR：[#26](https://github.com/jionpz/jspace/pull/26)（分支 `origin/cursor/review-followup-optimizations-e64e`，base=main，状态 MERGEABLE，CI `verify` SUCCESS）。

## Background

PR #26 是只读审查后的五项前台小修，CI 已绿但尚未合入 main。main 上入口面仍带着这些缺口：

1. `application/context/payload.ts` 的 `SKILL_LIST` 硬编码 4 个技能名（`jspace-use / asset-ingest / memory-recall / memory-writeback`），而 manifest 已长到 7 个 workbench 技能——session-start 注入的 `<available>` 块对用户漂移了 3 个技能。
2. 模板 `AGENTS.md` Skill Governance 只列举 `.claude/skills/` + `.agents/skills/` 投影，漏了 `.grok/skills/` / `.opencode/skills/`。
3. spawn 失败（如 gbrain 未装时 session-start hook 探测）直接打到本进程 stderr，每次会话开头都有噪声。
4. 遗留 marker `TRELLIS-BRAIN-OPS` 未随 jspace 命名统一改名（PR 内已核实：gbrain resolver 不解析 HTML 注释、GitHub 全网旧 marker 零外部命中）。
5. jspace-use §2 第 4 步缺「非 Claude harness 启用 cron 前先改 `cron.json` harness 字段」的提醒，否则 rehearsal 因本机无 claude 可执行文件失败。

本子任务不重写这些修复——PR #26 已实现并验证；任务是把它**合入当前集成分支** `cursor/febel-post-m6-roadmap-6abc`（FEBEL 任务树的集成分支），处理与 main 侧后续提交（PR #27 `$GBRAIN_BIN`、v1.0.15、trellis 任务跟踪）的交叉。

## Goal

PR #26 的全部五项改动出现在 `cursor/febel-post-m6-roadmap-6abc` 上，生成物与源一致、全套质量检查绿，F 维缺口（父 PRD Current State 表第一行）关闭。

## Requirements

- R1 以 `git merge origin/cursor/review-followup-optimizations-e64e` 方式合入（保留 PR 原提交历史，便于后续 PR #26 关闭时溯源），不 rebase、不 cherry-pick 重写。
- R2 冲突解决原则：`cli/assets.generated.ts` / `cli/manifest.generated.ts` / `cli/manifest.json` 是生成物，冲突不手工调和——合并后以 `bun run scripts/gen-assets.ts` 重新生成为权威（版本号取 main 侧 v1.0.15 的 `package.json`）。手写源文件两侧无重叠（已核对：PR 真实改动 14 文件，与 main 侧交集仅上述 3 个生成物），如出现意外冲突按「两侧语义都保留」处理并在 task.json notes 留痕。
- R3 合并后 `application/context/payload.ts` 的 `SKILL_LIST` 从 `skills-manifest.json` 派生（无硬编码技能名单）；`tsconfig.json` 带 `resolveJsonModule`。
- R4 合并后模板/skills 生成链一致：`templates/workbench/AGENTS.md` marker 为 `JSPACE-BRAIN-OPS`，`scripts/skill-frontmatter.ts` / `scripts/check-skills.ts` 用新 marker，doctor 残留检查（`application/diagnostics/checks/skills.ts`）同时认新旧拼写。
- R5 不推送任何内容到 PR #26 原分支 `cursor/review-followup-optimizations-e64e`；不改 main；不用 gh 做写操作（合并/关 PR 由用户侧流程处理）。
- R6 Trellis 留痕：task.py start + set-branch 指向 `cursor/febel-post-m6-roadmap-6abc`；commit 只含 F 相关代码与本子任务产物。

## Acceptance Criteria

- [x] AC1 `git log` 显示 merge commit，`origin/cursor/review-followup-optimizations-e64e` 的 5 个提交（a7606ca…7b3a147）进入当前分支祖先。
- [x] AC2 `application/context/payload.ts` 无硬编码技能名单；`bun test application/context/payload.test.ts` 绿（含「7 技能全列出」用例）。
- [x] AC3 旧 marker `TRELLIS-BRAIN-OPS` 在 `templates/` `skills/` 与功能 marker 常量（`scripts/skill-frontmatter.ts` 的 `BRAIN_BEGIN/END`、`scripts/check-skills.ts` 的正则）中零使用；允许的残留仅两处：doctor 残留检查 `checks/skills.ts`（按 R4 必须保留）与 `skill-frontmatter.ts` 顶部改名说明注释（历史名文档化，PR #26 自带）。
- [x] AC4 `bunx tsc --noEmit` 通过。
- [x] AC5 `bun test` 全绿。
- [x] AC6 `bun run scripts/gen-assets.ts` 后 `git status` 无生成物残留 diff；`check-skills` / `check-harness-consistency` / `check-manifest-integrity` 三脚本全过。
- [x] AC7 改动已 commit 并 push 到 `origin/cursor/febel-post-m6-roadmap-6abc`；PR #26 原分支与 main 未被本任务改动。

## Non-Goals

- 不在本任务里扩展 PR #26 的范围（不新增修复、不做额外重构）。
- 不 merge 到 main、不关闭/评论 PR #26（gh 只读）。
- 不做真实工作台升级演练（PR 描述里的 `jspace update` + `workspace upgrade` 步骤属用户自用机操作，非本任务验收）。
- 不动 `GOAL.md` 里程碑正文。

## Key Decisions

- **merge 而非 rebase/cherry-pick**：PR 分支基点（`1da1d3c`）早于 main 上 PR #27 与 trellis 跟踪提交，merge 保留原提交与 CI 已验证的树，也让 GitHub 侧 PR #26 在集成分支合回 main 后自动显示 merged/可关闭。
- **生成物冲突走 gen-assets 重生成**：`cli/*.generated.ts` / `cli/manifest.json` 双侧都动过（PR 侧 marker/skill 内容 hash、main 侧 v1.0.15 版本号 + gbrain.md hash），手工三方合并这些文件违反「生成物残留 diff = 失败」纪律；权威做法是合并源文件后重跑 `scripts/gen-assets.ts`。
- **落到集成分支而非直接合 main**：F 是 FEBEL 树第一个子任务，父任务约定各子任务在 `cursor/febel-post-m6-roadmap-6abc` 汇集后统一走 PR 审查回 main，避免多路并行改 main。
- **doctor 残留检查保留旧 marker 拼写**：既有工作台的 pre-block-era 模板 dump 携带 `TRELLIS-BRAIN-OPS`，改名后仍须能检出（PR #26 内已如此实现，本任务不改）。

## Notes

- PR 真实 diff（相对 merge-base `1da1d3c`）：14 文件 +89/−19；`main..PR` 直接 diff 里大量 `.trellis/` 删除是 main 侧 fef91e1 新增跟踪造成的假象，不属于 PR 改动。
- 验证基线：PR CI `verify` SUCCESS（2026-08-26），PR 描述称本地 680 pass。合入后在集成分支重跑全套（AC4–AC6）以覆盖与 PR #27 的交叉。
