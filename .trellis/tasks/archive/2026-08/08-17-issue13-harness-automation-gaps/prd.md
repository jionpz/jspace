# Issue #13: harness 接线 / 首启引导 / session-start briefing 自动化缺口

## Background

来源：GitHub issue #13（draft，合并稿）。共同根因是“纪律与接线约定只写到文档层”，缺少 capabilities 声明 + 按 harness 的自动化物化；doctor 只校验文件级一致性，不校验“纪律是否真正落进 harness 行为”。

原始 issue 含 4 个子问题：
1. init/wire 缺按 harness 的接线命令
2. session-start briefing 没有 hook 化，导致 cron 失败长时间无人知
3. 首启 §2 缺 cron install 引导
4. doctor 在沙盒/PID namespace 环境误报 cron

## Current State（已核对 main HEAD）

已由 issue #12 / #10 等落地，本次不需要重复实现：
- capabilities.yaml + capabilities.generated.ts 已有，作为单一事实源
- `jspace harness wire --harness claude|grok|opencode|cursor|pi` 已统一，支持 `--dry-run`
- `jspace harness init` 已按端核对 skill 投影
- Cursor MCP + `~/.cursor/skills/` 薄链已实现
- doctor 已实现 PID namespace 隔离检测；沙盒下 cron daemon/crontab 不可验证降级为 info
- first-use §2 第 4 步已指向统一 wire 命令

剩余缺口：
- Pi session-start hook 未物化（pi-hooks 配置未写；`harness wire --harness pi` 只写 MCP）
- doctor 行为级检查缺失：当前 harness 是否挂 session-start hook、briefing 时间追踪、已 wire 端 MCP/skill 缺口
- 首启 §2 缺 cron install 引导（可选 4.5 步 + final smoke 增加 cron 验证）
- `jspace context` 存在 open incidents 时没有前置 banner；没有工作台根 CRON-ALERT.md 物化机制

## Goal

补齐 issue #13 中尚未被 main 覆盖的自动化缺口，使 harness 接线、session-start briefing、首启 cron 引导和 cron 失败可见性不再依赖纯文档纪律。

## Requirements

- R1：Pi harness 的 session-start hook 可通过 `jspace harness wire --harness pi` 物化；无 hook 能力时在输出中明确说明不可用。
- R2：doctor 能检查“当前选定/已 wire harness 是否已挂载 session-start hook”，未物化时给出可操作的 warning。
- R3：state 能记录最近 briefing 时间；长期未跑 briefing 时 doctor/context 给出 warning。
- R4：`jspace context` 输出在存在 open cron incidents 时前置 banner，让不主动跑 cron check 的会话也能撞见。
- R5：首启 §2 增加可选 Scheduled tasks 引导（列出任务、提示 `jspace cron install`、建议先 `cron run` 演练），final smoke 增加 cron 验证（启用者验 crontab 条目；跳过者标 deferred 不报错）。
- R6：保持现有“不把 Cursor 做成 cron harness、不自动 session-end writeback、不引入 Trellis 任务管理/agents 目录复制、不强制 Engram 写 Cursor mcp.json”的非目标。

## Acceptance Criteria

- [ ] `jspace harness wire --harness pi --dir . --dry-run` 输出包含 Pi session-start hook 写入计划；实际执行后 pi-hooks 配置可被 doctor 识别。
- [ ] doctor 能检测 Pi（及支持 hook 的各端）未物化 session-start hook，并给出 warning；已物化时无该 warning。
- [ ] 存在 open incident 时，`jspace context session-start --plain` / `cron check` 输出头部出现 banner。
- [ ] first-use §2 文档包含可选 cron install 引导，final smoke 包含 cron 验证描述。
- [ ] 既有测试全绿：`bunx tsc --noEmit`、`bun test`、`bun run scripts/check-skills.ts`、`bun run scripts/check-harness-consistency.ts`、`bun run scripts/check-manifest-integrity.ts`。
- [ ] 修改 `templates/workbench/` / `skills/` / `adapters/harness/capabilities.yaml` 后重跑 `bun run scripts/gen-assets.ts` 并提交生成物。

## Non-Goals

- 不实现 Cursor headless/cron 支持。
- 不自动 session-end writeback。
- 不引入 Trellis 任务管理/agents 目录复制。
- 不把 Engram 写进 Cursor IDE `mcp.json`。
- 不排查 3 个 cron 失败的实际业务根因（issue #13 明确另案处理）。

## Notes

- issue #13 中“wire 只认 grok”的证据已过时，实施前可顺手更新 issue 或在本 PRD 中标注。
- 复杂任务：进入实现前需要补 design.md / implement.md。
