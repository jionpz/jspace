# P3 Implement: OpenCode plugin 驱动

## 有序检查清单（全部完成，2026-08-09）

- [x] **1. `--quiet` 排期**：`cli/commands/helpers.ts` 加 `quiet()` 辅助（抑制 lines 保留 exitCode）；`pending apply` + `cron check` 加 `--quiet` option（实机验证 silent）
- [x] **2. 模板 `templates/workbench/.opencode/plugins/jspace.ts`**：`JSpacePlugin`（session.created→session-start；session.idle→pending apply --quiet + cron check --quiet **不含 writeback**；experimental.session.compacting→context push）。纯事件分支导出 `createEventHandler`/`createCompactingHandler` 供单测；`Bun.spawn` fire-and-forget（不 await）；cwd=directory
- [x] **3. skill 投影 `.opencode/skills/`**：由 P1 SKILL_PROJECTIONS 推导生效（init 验证落地 4 技能）
- [x] **4. init materialize**：`.opencode/plugins/jspace.ts` 落地（编译二进制嵌入已验证）；gen-assets 跳过 `.test.ts`（防模板测试进二进制）
- [x] **5. `adapters/harness/opencode.ts`**：headlessArgv = `opencode run <prompt>`（positional，本机 1.18.13 实测）+ hookFilePath → `.opencode/plugins/jspace.ts`
- [x] **6. README**：`.opencode/plugins/jspace.ts` 列入结构 + seed 所有权表
- [x] **7. 测试**：`adapters/harness/opencode-plugin.test.ts`（5 case：session.created / session.idle 无 writeback / 未知事件忽略 / compacting push / compacting 空跳过）；`init.test.ts` opencode plugin 落地回归
- [x] **8. 类型 shim**：`types/opencode-plugin.d.ts` 最小 ambient 声明 + tsconfig include `types/`（仓库不依赖 @opencode-ai/plugin，OpenCode 运行时提供真实模块）
- [x] **9. 节流与预判**：idle 分支**不**做 staged 预判（pending apply 幂等 cheap no-op，文件在 filehub 需 registry 解析——薄 emit 原则，不查 registry）；30s 去重不引入（cron check --quiet 幂等轻量，实测无过重）→ 记录于 notes
- [x] **10. gen-assets 重跑**（模板 plugin + README 变更 → 已重跑，assets/manifest/capabilities freshness OK）

## 验证命令（全部通过）

```bash
bunx tsc --noEmit                                    # TSC OK
bun test                                             # 473 pass / 0 fail
bun run scripts/gen-assets.ts                        # 幂等; freshness OK
bun run cli/main.ts init /tmp/jspace-opencode        # .opencode/plugins/jspace.ts + .opencode/skills/ 落地
bun run cli/main.ts cron check --quiet --dir <wb>    # silent exit 0
bun run cli/main.ts cron run inbox-tidy --harness opencode --dry-run  # opencode run <prompt>
bun run build && ./bin/jspace init /tmp/x            # 编译二进制嵌入 plugin
bun test adapters/harness/opencode-plugin.test.ts   # 5 case
```

## 风险文件 / 回滚点

- `templates/workbench/.opencode/plugins/jspace.ts`（模板 seed）→ 删条目 + revert 即回滚
- `adapters/harness/opencode.ts`（P1 骨架，行为填充）
- `types/opencode-plugin.d.ts`（shim，只声明 plugin 用到的表面）
- plugin 事件字段带 experimental 前缀，版本漂移时静默跳过（设计已定）

## task.py start 前 follow-up

- [x] session.idle 分支**不含** memory-writeback（D3 硬约束，测试断言）
- [x] plugin 只薄 emit，无业务逻辑（父任务 OOS 4）
- [x] spawn cwd = directory，不依赖 PATH 当前目录
