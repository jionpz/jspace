# cron failures 命令 — 实施计划

## 有序清单

1. **cron.ts 实现**
   - `readCronFailed(root): string[]` — 读 `<root>/.jspace/logs/cron-failed.md`（不存在/空 → []）。
   - `lastStatusFor(root, id): string|null` — 读该 cron 日志目录最后一个 `.md` 的 `status:`（无日志 → null → `never run`）。
   - `findPendingApplies(root): {paths: string[], root: string|null}` — 读 root/hub.json 找 `type: filehub` primary path；存在则 glob `<filehub>/.jspace/logs/*.APPLY.md`。
   - `cmdCronFailures(json: boolean, root?: string): void` — 聚合 + 输出 + 退出码（需关注 → exit 1）。
   - 输出格式按 design.md（人类可读 / --json 单行）。
2. **args.ts 接线**：CRON_CHOICES 加 `failures`/`check`；P_CRON_FAILURES/CHECK help；CRON_HELP 补两行；import `cmdCronFailures`；分发 case（`failures` 与 `check` 同 handler）。
3. **doctor 增强**（cmds.ts）：cron 摘要区追加 pending APPLY 提示（读 hub.json 定位 filehub，glob `*.APPLY.md` 计数）。
4. **单测**（cli/cron.test.ts 追加）：构造临时 workbench（temp 目录 + hub.json 指向 temp filehub + 假 cron-failed.md + 假 cron 日志 + 假 APPLY.md）→ 断言：人类输出字段、--json 结构、退出码（有/无需关注两场景）、never run 不计需关注、filehub 未注册跳过。
5. **验证命令**：`bun test`（新用例 + 既有 21 不破）；`bunx tsc --noEmit`；真实工作台手跑 `jspace cron failures` 与 `--json`。
6. **真实验证**：在 `~/jspace-work` 跑 `jspace cron failures`，核对列出真实 pending APPLY（memory-consolidate-2026-08-03.APPLY.md 等）+ 各 cron 状态。

## 验证命令

```bash
bun test                      # cron.test.ts 新用例 + 既有
bunx tsc --noEmit
bun run cli/main.ts cron failures           # 真实工作台(在 ~/jspace-work 下)
bun run cli/main.ts cron failures --json
bun run cli/main.ts cron check
```

## 评审门

- [门 1] design 评审 → `task.py start`。
- [门 2] 实现完成、单测全绿、真实工作台核对后，提交前自查 diff。

## 回滚点

- 单 commit；回滚 = 移除 args.ts 分发 + cron.ts/cmds.ts 改动。
- 不改既有 cron 命令，无迁移风险。
