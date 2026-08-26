# cron failures 命令 — 任务记录

## 交付物
- `cli/cron.ts`：`cmdCronFailures(json, root?)` + helpers（`readCronFailed` / `lastStatusFor` / `filehubRoot` / `findPendingApplies`），均导出供单测。
- `cli/args.ts`：`failures` + `check`（别名）子命令接线 + help。
- `cli/cmds.ts`：doctor cron 摘要追加 pending APPLY 提示。
- `cli/cron.test.ts`：9 个新用例（helpers + cmdCronFailures JSON/退出码/人类输出/suspect/never-run 不计需关注）。

## 验证（2026-08-03）
- `bun test` 30/30（原 21 + 新 9）；`tsc` 干净。
- 真实工作台（`~/jspace-work`）：
  - `cron failures` → failures(0) + pending(1) = `memory-consolidate-2026-08-03.APPLY.md`（真实暂存写）+ 全 cron ok → **needs_attention 1, exit 1**。
  - `cron check --json` → 合法 JSON（crons/pending_applies/summary 齐全）。
  - `doctor` → warning「1 pending staged gbrain write(s) (*.APPLY.md in .jspace-logs)」。

## 关键发现 / 修正
- **暂存写路径是 `<filehub>/.jspace-logs/`（连字符），不是 `.jspace/logs`**：首次实现扫错目录 → 真实 pending 没浮现；修正后正确。教训：以真实环境的既有约定为准（SKILL batch.md 写日志到 `.jspace-logs`），不能凭印象猜路径。
- **测试隔离**：初版测试共用 `/tmp/jspace-fh` → APPLY 文件跨测试累积 → 断言失败。改为每 workbench 独立 filehub。
- **cron.ts 缺 `loadRegistry` 导入**：filehubRoot 调用未导入函数 → ReferenceError 被 catch → 静默返回 null。已补导入。

## 备注
- 退出码契约：needs_attention>0 → 1；`never run` 不计需关注（新装 cron 不误报）。
- 纯只读、不碰 gbrain 锁（serve 持锁时照常可跑）。
