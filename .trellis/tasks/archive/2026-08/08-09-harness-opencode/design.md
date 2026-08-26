# P3 Design: OpenCode plugin 驱动

## 架构边界

```
OpenCode 事件 ──► .opencode/plugins/jspace.ts ──► jspace CLI
   session.created         (Plugin: async ({directory}) => …)   context session-start
   session.idle             └─ 薄 emit,无业务逻辑               pending apply --quiet
   experimental.session.compacting                              cron check --quiet
                                                                 context session-start --plain → context.push
```

- **D3**：`session.idle` 只做 `pending apply` + `cron check`（轻量幂等、失败可忽略）；**不**触发 memory-writeback（idle 每 turn fire，自动写会写废）
- **薄 emit 原则**：plugin 不写长逻辑（父任务 OOS 4）；核心在 jspace CLI use case

## 关键设计决策

1. **plugin 形态**：`export const JSpacePlugin: Plugin = async ({ directory }) => ({ event: ..., "experimental.session.compacting": ... })`。`directory` = workbench 根，作 `cwd` 传给 jspace CLI（避免依赖用户 PATH 当前目录）
2. **进程调用**：用 `Bun.spawn(["jspace", ...], { cwd: wbRoot })` **fire-and-forget（不 await）**，避免阻塞每 turn 事件循环（审查：`await .exited` 是阻塞等待，每 turn +2 次进程启动延迟）；失败静默（`.exited` 忽略 + try/catch）
3. **`experimental.session.compacting` 注入**：`jspace context session-start --plain` 输出 push 进 compaction 上下文——比 Claude PreCompact 更强（可注入 compaction prompt），等价 Grok memory_flush 时机；但**只注入 context，不写 gbrain**（D2/D3 纪律一致）
4. **`.opencode/skills/` 投影**：与 `.claude/skills/` / `.grok/skills/` 并列，复用同一投影机制
5. **init materialize**：`templates/workbench/.opencode/plugins/jspace.ts` 作为 seed，init 时落地；README 列入 managed-files
6. **headless argv**（P1 接口实现）：定形 `["opencode","run",prompt]`——本机 opencode 1.18.13 `run --help` 确认 message 为 positional array，无 `--prompt`

## 数据流

OpenCode 会话创建 → `session.created` → session-start 注入；每个 AI turn 结束 → `session.idle` → pending apply（**flush 用户显式 stage 的队列**，意图来自用户，非自动 write-back）+ cron check；compaction 前 → `experimental.session.compacting` → 工作台状态注入 compaction 上下文。写回仍走显式收工。

## 兼容性 / 迁移

- `.opencode/` 全新增，不碰既有 harness 接线
- plugin 用 `@opencode-ai/plugin` 类型（import type only，运行时不依赖——plugin 由 OpenCode 运行时加载）
- 回滚：删模板 `.opencode/` 条目 + revert 投影/测试改动即回滚

## 风险 / 权衡

- **OpenCode 事件字段名可能随版本漂移**（`experimental.session.compacting` 带 experimental 前缀）→ plugin 对未知事件静默跳过；P5 的 check-harness-consistency 只断言「存在」，不锁死事件 schema
- **`session.idle` 高频触发** → `pending apply` 是真实 gbrain 写路径（apply staged envelope 会 `spawnSync gbrain get`+`put`，`application/pending/apply.ts:84-93`），cron check 读多份 JSON（`application/automation/status.ts:50-119`）。缓解：idle 分支**仅当存在 staged envelope 才 spawn pending apply**（读目录比 spawn 便宜）+ 30s 去重 cron check；`--quiet` 抑制输出（P3 排期添加）
