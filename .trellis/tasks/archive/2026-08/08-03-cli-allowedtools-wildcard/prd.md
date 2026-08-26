# 修 CLI cron allowedTools 通配符

## Goal

修复 `jspace cron run` 生成的 `--allowedTools` 中 `gbrain:*` 不被 claude 支持的问题：claude 的 allow-rule 只允许 `mcp__<server>__<tool>` 前缀后使用 glob（工具名位置），`gbrain:*` 不匹配 → 被忽略。修正为 `mcp__gbrain__*`，使无头 cron 会话的 gbrain MCP 工具被显式放行（配合 Bash 兜底）。来源：`cron-rehearsal-install` 发现的待修项。

## Requirements

- R1：`cli/cron.ts` 中 claude harness 的 `--allowedTools` 由 `Bash,Read,Write,Edit,gbrain:*` 改为 `Bash,Read,Write,Edit,mcp__gbrain__*`。
- R2：注释同步更新（保持准确）；不改 codex / pi 分支（它们无此参数）。
- R3：重新构建 `bin/jspace`（`bun run build`），`bunx tsc --noEmit` 通过。

## Acceptance Criteria

- [ ] `cli/cron.ts` allowedTools 为 `mcp__gbrain__*`（注释准确）。
- [ ] `bunx tsc --noEmit` 通过。
- [ ] `bun run build` 后，`jspace cron run <id> --dry-run` 显示 `--allowedTools Bash,Read,Write,Edit,mcp__gbrain__*`（无 `gbrain:*`）。
- [ ] 无回归：`bun test`（若有 cron 相关单测）通过。

## Notes

- 轻量单行修复；不引入新机制。真实 cron 行为不受影响（launchd 调度跑时锁空闲，MCP 放行后更顺；锁冲突时仍走 Bash + 暂存）。
