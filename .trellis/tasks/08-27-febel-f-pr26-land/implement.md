# Implement: 合并 PR#26 前台小修落地

> 前置：阅读 `prd.md`（需求/验收）。本文件是执行清单。
> 分支模型：所有操作在集成分支 `cursor/febel-post-m6-roadmap-6abc` 上；不碰 main、不 push PR #26 原分支。

## 阶段 0：基线确认

- [ ] 0.1 `git branch --show-current` 为 `cursor/febel-post-m6-roadmap-6abc`；工作区干净（trellis 规划产物已提交）。
- [ ] 0.2 `git fetch origin cursor/review-followup-optimizations-e64e main`；确认 PR 分支顶点 `7b3a147`、merge-base `1da1d3c`。
- [ ] 0.3 环境就绪：`bun --version`、`bun install`（缺 bun 先装）。

## 阶段 1：Trellis 挂账

- [ ] 1.1 `export TRELLIS_CONTEXT_ID=cursor-cloud-febel`
- [ ] 1.2 `python3 ./.trellis/scripts/task.py start 08-27-febel-f-pr26-land`（session 失败不阻塞——继续实施并在 task.json notes 注明）。
- [ ] 1.3 `python3 ./.trellis/scripts/task.py set-branch 08-27-febel-f-pr26-land cursor/febel-post-m6-roadmap-6abc`

## 阶段 2：合入

- [ ] 2.1 `git merge --no-ff origin/cursor/review-followup-optimizations-e64e`（merge 语义见 prd Key Decisions；`--no-ff` 保证留 merge commit 便于溯源）。
- [ ] 2.2 若冲突且冲突面 ⊆ {`cli/assets.generated.ts`, `cli/manifest.generated.ts`, `cli/manifest.json`}：先随便取一侧（`git checkout --theirs -- <files>` 均可）让 merge 可继续，**不手工调和内容**——阶段 3 用 gen-assets 重生成覆盖。
- [ ] 2.3 若冲突出现在手写源文件（预核对不应发生）：按「两侧语义都保留」解决，并把冲突文件与决策写进 task.json notes。
- [ ] 2.4 完成 merge commit（保留 git 默认 merge message 或 `merge: land PR #26 …`）。

## 阶段 3：生成物对齐

- [ ] 3.1 `bun run scripts/gen-assets.ts`（templates/skills 双侧都动过，必跑）。
- [ ] 3.2 `git status`：若生成物有 diff，纳入一个 `chore(gen):` 修正提交（或 amend 进 merge 前的解决过程——遵守「不 amend 已 push 提交」，本地未 push 时可直接并入）。目标：AC6 无残留 diff。

## 阶段 4：全量验证

- [ ] 4.1 `bunx tsc --noEmit`
- [ ] 4.2 `bun test`（全量，可接受时间较长）
- [ ] 4.3 `bun run scripts/check-skills.ts`
- [ ] 4.4 `bun run scripts/check-harness-consistency.ts`
- [ ] 4.5 `bun run scripts/check-manifest-integrity.ts`
- [ ] 4.6 语义抽查（对应 AC2/AC3）：
  - `bun run cli/main.ts init /tmp/jspace-smoke && bun run cli/main.ts doctor --dir /tmp/jspace-smoke`
  - smoke 工作台 `AGENTS.md` 含 `JSPACE-BRAIN-OPS` marker、7 技能 resolver 行。
  - `rg "TRELLIS-BRAIN-OPS" templates/ skills/ scripts/skill-frontmatter.ts scripts/check-skills.ts` 零命中。

## 阶段 5：留痕 + 提交 + 推送

- [ ] 5.1 task.json：`set-meta` 或直接编辑补 `commit`（merge commit hash）；status 由 hooks/手工置 in-progress→ 待父任务验收。
- [ ] 5.2 提交拆分：
  - merge commit（阶段 2，含 PR #26 全部代码改动）
  - `docs(trellis): …`（本子任务 prd/implement/task.json 留痕；也可先于 merge 提交）
  - 如有：`chore(gen): …`（阶段 3 生成物修正）
  - 只 commit F 相关代码 + 本子任务 trellis 产物，不夹带其他子任务改动。
- [ ] 5.3 `git push -u origin cursor/febel-post-m6-roadmap-6abc`；网络失败按 4s/8s/16s/32s 指数退避重试最多 4 次。

## 验证命令汇总

```bash
export PATH="$HOME/.bun/bin:$PATH"
bunx tsc --noEmit
bun test
bun run scripts/gen-assets.ts && git status --short   # 期望无生成物 diff
bun run scripts/check-skills.ts
bun run scripts/check-harness-consistency.ts
bun run scripts/check-manifest-integrity.ts
```

## Rollback 点

- merge 前分支顶点 `15ada6b`（docs(trellis) 规划提交）；merge 失败或验证不过：`git merge --abort` / `git reset --hard 15ada6b`（仅本地未 push 时）。
- 不涉及机器配置写入，无需备份。
