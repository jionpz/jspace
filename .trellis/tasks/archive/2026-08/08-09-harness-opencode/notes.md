# P3 素材：OpenCode 接线实测 + 设计偏差记录

> 素材用途：P5 创建 `harness-opencode.md` 时的内容来源。**本任务不建 harness-opencode.md**（归 P5）。

## 已实现（可断言，P3 交付）

| 项 | 状态 | 证据 |
|---|---|---|
| `.opencode/plugins/jspace.ts` 落地 | ✅ init + 编译二进制嵌入 | init.test.ts「init materializes the OpenCode plugin」|
| `.opencode/skills/` 投影 | ✅ init 落地 | SKILL_PROJECTIONS 从 capabilities 推导（P1）|
| `--quiet`（pending apply / cron check）| ✅ 静默 | 实机 `cron check --quiet` silent exit 0 |
| session.idle 不含 writeback | ✅ 测试锁定 | opencode-plugin.test.ts「no writeback」|
| headless argv | ✅ `opencode run <prompt>` | 本机 opencode 1.18.13 实测 positional |

## 与设计的偏差（P5 harness-opencode.md 注明）

1. **idle 分支不做 staged 预判**（设计原写「仅当存在 staged envelope 才 spawn」）：pending envelopes 在 `<filehub>/.jspace-logs/`（`application/pending/envelope.ts:18` `PENDING_LOG_DIR`），解析需 registry → 违反「plugin 只薄 emit」原则。改为**无条件 spawn `pending apply --quiet`**（幂等；无 staged 时 cheap no-op，envelope repo 内部解析 filehub）。**取消 30s 去重**（cron check --quiet 幂等轻量，实测无过重）。
2. **类型 shim**：仓库不依赖 `@opencode-ai/plugin`，`types/opencode-plugin.d.ts` 只声明 plugin 用到的表面（Plugin/PluginInput/Hooks.event/compacting）。OpenCode 运行时提供真实模块。tsconfig include 加 `types/**/*.d.ts`。
3. **gen-assets 跳过 `.test.ts`**：模板插件测试不能进编译二进制，`scripts/gen-assets.ts` walk 加 `name.endsWith(".test.ts")` skip。
4. **测试放 `adapters/harness/opencode-plugin.test.ts`**（非模板内）：bun 默认 test 扫描忽略 dot-dir（`.opencode`），放模板内不被 CI 的 `bun test` 覆盖；纯处理器 `createEventHandler`/`createCompactingHandler` 从模板导入。

## 待真实 OpenCode 会话验证（P5 标 best_effort）

1. **plugin 是否被 OpenCode 加载**：`.opencode/plugins/jspace.ts` 需在 OpenCode 配置里引用（`opencode.json` 或全局 plugin 注册）——本任务只 materialize 文件，**未验证 OpenCode 自动发现**。真实会话 `session.created`/`session.idle` 是否 fire 需实测。
2. **`experimental.session.compacting` 触发**：experimental 前缀事件，真实 compaction 时是否调用、`output.context` 是否注入——未实测。
3. **headless cron 可靠性**：`opencode run <prompt>` 在 unattended cron 下是否会挂起等模型、exit code 语义——未在 CI 验证（CI 无 opencode）。

## 最小真机验证命令（有 opencode 时执行）

```bash
jspace init /tmp/jspace-opencode-verify
# 在 opencode 配置引用插件后启动会话,观察:
#   session.created → jspace context session-start 注入
#   每个 turn 结束 → pending apply --quiet / cron check --quiet(无输出)
#   compaction 前 → session-start --plain 进 compaction context
opencode run "print session-start context" --cwd /tmp/jspace-opencode-verify
```

## 已知权衡（harness-opencode.md 注明）

- **D3 纪律**：`session.idle` 每 turn fire，只做 pending apply（flush 用户显式 stage 的队列，意图来自用户）+ cron check；**不**自动 memory-writeback（自动写会写废）。
- **薄 emit**：plugin 零业务逻辑，核心在 jspace CLI use case（父任务 OOS 4）。
