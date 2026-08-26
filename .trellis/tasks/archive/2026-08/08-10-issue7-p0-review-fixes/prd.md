# Issue #7 P0: OpenCode 桥接语义修复 + CI 发布门禁

## Goal

修复专家 review（issue #7）的 4 项 P0，消除 OpenCode 桥接的语义断裂与 CI 发布门禁绕过：

1. **OpenCode `session.created` 上下文注入**（调研确认 SDK 支持，可实现真注入，非降级）
2. **OpenCode headless argv 补 `run` subcommand**（当前生成 `opencode <prompt>`，可能进 TUI）
3. **Compaction 路径超时 / 退出码防护**（当前 await 无 timeout，jspace hung 会永久阻塞）
4. **CI tag 发布门禁**（`release` 依赖 `build` 但不依赖 `test`，tag 构建绕过完整 verify）

## Requirements

### R1 — session.created 真注入

- **R1.1** `templates/workbench/.opencode/plugins/jspace.ts`：`session.created` 事件触发时，用 OpenCode SDK `client.session.prompt({ path, body })` 注入 session-start 文本，`body.parts = [{ type: "text", text }]`，`body.noReply = true`（注入 UserMessage 作为上下文，不触发 AI 响应——SDK 明确支持，文档标注 "useful for plugins"）。
- **R1.2** `path` = 事件 payload 的 `sessionID`（`session.created` payload = `{ sessionID, info }`，event handler 收 `{ event: { id, type, properties } }`）。
- **R1.3** 注入文本 = `jspace context session-start --plain` 输出；用 8s 超时 + `stdin: "ignore"` + 退出码检查获取，失败返回 `""`（静默，不阻塞 session）。
- **R1.4** 保持纯函数可测性：event handler 接受注入的 `inject` 函数与 runner（mock 测试，不真连 client / 不真 spawn）。
- **R1.5** 更新 `capabilities.yaml` 中 opencode `sessions` 的注释（从「声称注入」改为真实注入通道）。

### R2 — headless argv 统一消费 capabilities 前缀

- **R2.1** 所有 harness adapter 的 `headlessArgv` 统一消费 `capability.headless.slice(1)` 作为前缀（claude / grok / pi / codex / opencode），消除 yaml 声明与代码 hardcode 的分叉。
- **R2.2** opencode 由 `[bin, prompt]` 修正为 `[bin, "run", prompt]`（capabilities 前缀 `["opencode", "run"]`）。
- **R2.3** `adapters/harness/argv.test.ts` 断言更新为 `["/bin/opencode", "run", "do it"]`；其余 harness 断言保持通过（slice(1) 与现有 hardcode 逐字一致，无行为变化）。

### R3 — Compaction 路径防护

- **R3.1** `createCompactingHandler` 的真实 runner 加 8s 超时 + `stdin: "ignore"` + 退出码检查；超时 / 非零退出 / spawn 失败均返回 `""`，compaction 永不阻塞。
- **R3.2** 测试覆盖超时与非零退出路径（mock runner）。

### R4 — CI 发布门禁

- **R4.1** `.github/workflows/build.yml`：`release.needs: [build, test]`（tag 发布必经完整 test 门禁：tsc + bun test + check-skills）。

## Acceptance Criteria

- [ ] AC1 单测：mock client，`session.created` → `prompt` 被调用，body 含 session-start 文本且 `noReply: true`；文本为空时不调用
- [ ] AC2 单测：compacting runner 超时 / 非零退出 → 返回 `""`（不抛异常）
- [ ] AC3 `bun test adapters/harness/argv.test.ts`：opencode 断言 `["/bin/opencode", "run", "do it"]`
- [ ] AC4 `bunx tsc --noEmit` 通过
- [ ] AC5 `bun test` 全过
- [ ] AC6 `bun run scripts/gen-assets.ts` 重跑后 git diff 无未同步残留（模板改动已嵌入 bundle）
- [ ] AC7 `bun run scripts/check-skills.ts` 通过
- [ ] AC8 `build.yml` 中 `release.needs` 含 `test`
- [ ] AC9 `scripts/check-harness-consistency.ts` 不回归（headless 前缀 ↔ adapter 一致）

## Out of Scope

- issue #7 的 P1 批次（4-9）：CI verify.yml 重排、git 跟踪检查、idle 语义、测试网扩展、session_end 降级
- P2 批次（10-15）与 P3（16-19）
- 其他 harness 的注入 / 超时改造（grok / claude 已有各自的 SessionStart 通道）
