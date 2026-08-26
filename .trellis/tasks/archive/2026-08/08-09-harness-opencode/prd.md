# P3: OpenCode 支持（T2.5 plugin 驱动）

## Goal

OpenCode 接入用 plugin（JS/TS 模块）+ 细粒度事件重建「Claude 等价」接线：`.opencode/plugins/jspace.ts`（session.created → session-start；session.idle → pending apply + cron check；experimental.session.compacting → context 注入）+ `.opencode/skills/` 投影。OpenCode 用户获得会话级 context 注入，写回仍走显式「收工」（父任务 D3）。

父任务：`08-09-multi-harness-support`。依赖：P1（capabilities.yaml + opencode adapter 骨架）。

## Confirmed Facts（已核实）

- OpenCode headless = `opencode run`（prompt 作 positional 或 `--prompt`，P1 时验证）；MCP 支持；skills 支持 `.opencode/skills/` 与 `.agents/skills/`
- 事件：`session.created` / `session.idle` / `session.compacted` / `experimental.session.compacting`（可注入 compaction prompt，等价 Grok memory_flush 时机）
- `session.idle` 每 turn 都 fire（非仅会话结束）→ 不能直接映射「收工」
- 决策：D3=session.idle 只做 pending apply + cron check（轻量幂等），不自动 memory-writeback

## Requirements

- **R1** 新增模板 `templates/workbench/.opencode/plugins/jspace.ts`：`export const JSpacePlugin: Plugin = ...`，含
  - `session.created` → `jspace context session-start`
  - `session.idle` → `jspace pending apply --quiet` + `jspace cron check --quiet`（**P3 排期为 `pending apply` / `cron check` 加 `--quiet` 静默选项**；幂等、失败可忽略；**仅当存在 staged envelope 才 spawn pending apply**）
  - `experimental.session.compacting` → `jspace context session-start --plain` 输出 push 进 compaction context
- **R2** 模板技能投影新增 `.opencode/skills/` 目标（jspace-use / asset-ingest / memory-recall / memory-writeback）
- **R3** init 时 materialize `.opencode/plugins/jspace.ts` + `.opencode/skills/`
- **R4** `templates/workbench/` README 把 `.opencode/` 列入 managed-files 清单
- **R5** `adapters/harness/opencode.ts`（P1 落骨架）实现 headlessArgv = `["opencode","run",prompt]`（本机 opencode 1.18.13 已确认 message 为 positional array）+ plugin 引用说明
- **R6** plugin 只做薄 emit，不写长逻辑（父任务 OOS 4）；核心都在 jspace CLI use case

## Acceptance Criteria

- [ ] AC1 `bun run cli/main.ts init /tmp/jspace-opencode` 后 `.opencode/plugins/jspace.ts` 与 `.opencode/skills/{jspace-use,asset-ingest,memory-recall,memory-writeback}/` 落地
- [ ] AC2 plugin 事件分支单测（spawn 换成 mock）：session.created → session-start；session.idle → pending apply `--quiet` + cron check `--quiet` 且**不含** writeback、**无 staged 时不 spawn**；compacting → context push
- [ ] AC3 `bunx tsc --noEmit` + `bun test` 全过（模板回归 + plugin 单测）
- [ ] AC4 OpenCode 无头 import plugin 不炸（人工/CI 可行时验证）
- [ ] AC5 `jspace cron run <cron> --harness opencode --dry-run` 可组装 argv

## Out of Scope

- `session.idle` 触发 memory-writeback（D3 明确不自动写，每 turn 写会写废）
- 在 plugin 内实现业务逻辑（只薄 emit）
