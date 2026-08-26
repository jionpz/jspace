# 文件中心选址与存量迁移 — 实施计划(简版,纯文档)

## 有序清单

1. **决策**（已定 2026-08-03）：根=本地盘 `/Users/jionpz/filehub`；同步策略=网盘/Obsidian Sync（重资产不进 git），根可由网盘同步或暂不同步；存量=增量按需收编；本轮不实际迁移。
2. `skills/asset-ingest/references/migration.md` — 存量收编 runbook（已写）。
3. `SKILL.md` 参考列表 + migration.md 条目（已写）。
4. `GOAL.md` 开放问题 #2（#4 一并）→ 闭合（已写）。
5. 资产再生成：`bun run scripts/gen-assets.ts` + `bun run build`（改 skills/ 后必做）。
6. 回归：`bun test`（21 用例不破）+ `tsc` 干净。
7. 任务 notes.md 记录。

## 验证命令

```bash
bun run scripts/gen-assets.ts   # 确认 assets.generated.ts 含 migration.md、无 pyc
bun run build
bun test
bunx tsc --noEmit
```

## 评审门 / 回滚点

- 文档改动可整体 revert + 重跑 gen-assets/build。
- 本轮无真实迁移（机器上无零散存量素材），验收以「runbook 可照做 + 决策已记录」为准。
