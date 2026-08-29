# implement.md — M7 协议修正 + profile 接线

前置：prd.md + design.md 已作为规划评审稿。`task.py start` 之后按本清单执行。

## Ordered Checklist

1. **Collector**（`application/context/project-states.ts`）
   - 导出 `MAX_ACTIVE_PROFILES = 4`、`ProfileState`、`collectActiveProfiles(gbrain)`。
   - list `--tag profile` → slug `/^profile\/[^/]+$/` → 串行 get → 跳过 archived/weekly（不占名额）→ 满 4 停止。
   - `get` 失败仍收录空 summary；list 失败返回 `[]`。
   - 摘要：frontmatter 后首条非标题行，80 字截断。
2. **State + session-start**
   - `WorkbenchState.profiles: ProfileState[]`；`collectWorkbenchState` 初始 `[]`。
   - `cli/commands/context.ts` session-start：`Promise.all([collectActiveProjects, collectActiveProfiles])`，共用 `realGbrain(..., PROJECT_COLLECT_TIMEOUT_MS)`。
3. **Payload**
   - `stateLines`：`profiles.length > 0` 时在项目行后写 `偏好: theme（summary） / …`（无 summary 则只 theme）。
   - `renderTurn` 不出现「偏好:」。
4. **测试**
   - `project-states.test.ts`：过滤嵌套 slug、archived/weekly 回填、上限 4、list 失败空、get 失败仍收录。
   - `payload.test.ts`：有 profiles → 含「偏好:」；空 → 无该行；oversized 仍 ≤4KiB。
   - `collect.test.ts` 空 state 含 `profiles: []`（若断言整对象）。
5. **文档 R1/R2/R3**
   - `usage-mileage.md:155` 改为逐 id 循环；`:118` 与 kickoff 第 4 步收敛到 `.jspace/usage-mileage-ledger.md`。
   - `example-first-use.md:129` 拆开复制 vs 跳过 M7。
   - `gbrain.md:173/:228/:234/:235` 写明独立预算、上限 4、`collectActiveProfiles`、与项目并行。
   - grep 确认无第二处多 positional `cron enable`。
6. **生成物**
   - `bun run scripts/gen-assets.ts`；提交 `cli/*.generated.ts`（若有 diff）。

## Validation Commands

```bash
bunx tsc --noEmit
bun test application/context/project-states.test.ts application/context/payload.test.ts application/context/collect.test.ts
bun test
bun run scripts/check-skills.ts
bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts
```

可选冒烟（不碰真实 gbrain 库）：

```bash
bun run cli/main.ts context session-start --plain --dir /tmp/jspace-smoke
# 无 gbrain / 无 profile 页 → 无「偏好:」行，exit 0
```

## Review Gates

- [ ] 项目 max-8 单测未改语义；session-start 并行后任一路失败不影响另一路。
- [ ] 「偏好:」有事才说；turn 无该行。
- [ ] 文档 kickoff enable 可照抄；台账路径与 doctor 一致。
- [ ] 生成物新鲜；全量测试绿。

## Rollback

无状态迁移。revert 本批即可。若只文档或只接线出问题，可按 commit 拆 revert（实现时文档与代码允许同一 PR，但 collector 与 md 分文件，回滚粒度足够）。
