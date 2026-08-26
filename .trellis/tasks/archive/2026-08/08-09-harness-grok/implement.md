# P2 Implement: Grok Build 桥接

## 有序检查清单（全部完成，2026-08-09）

- [x] **1. `cli/commands/context.ts`**：新增 `pre-compact` / `session-end` 子命令（CmdResult 出口，不 console.exit；sessionReminderSpec 工厂）
- [x] **2. `application/context/payload.ts`**：新增 `renderPreCompact` / `renderSessionEnd`（被动提醒 + 状态 + next-action，**不写 gbrain**）；`envelope.ts` 加 `preCompactEnvelope` / `sessionEndEnvelope`（hookEventName PreCompact/SessionEnd）
- [x] **3. 模板 `templates/workbench/.grok/hooks/jspace.json`**：四事件 hook（SessionStart matcher `startup|clear|compact|resume` / UserPromptSubmit / PreCompact timeout 30 / SessionEnd），命令带 `2>/dev/null || true`
- [x] **4. skill 投影 `.grok/skills/`**：由 P1 的 SKILL_PROJECTIONS 推导自动生效（init 已验证落地 4 技能）
- [x] **5. `jspace harness wire --harness grok`**：新 `cli/commands/harness.ts` 命令族 + `application/gbrain/grok-wiring.ts`（TOML 最小行编辑，Bun.TOML 只 parse 不 stringify 的应对；只改 `[mcp_servers.gbrain]` env 表，保留其余字节；无 gbrain server → error 不创建）
- [x] **6. `adapters/harness/grok.ts`**：hookFilePath 已返回 `.grok/hooks/jspace.json`；capabilities.grok.sessions 四事件
- [x] **7. `templates/workbench/README.md`**：`.grok/hooks/` + `.grok/skills/` + `.opencode/skills/` 列入结构 + seed 所有权表
- [x] **8. 测试**：`payload.test.ts` pre-compact/session-end 断言（被动不自动写）；`grok-wiring.test.ts` 9 case（merge/idempotent/missing/never-create/dry-run）；`grok.test.ts` 3 case（hook JSON 结构 + argv + 路径）；`init.test.ts` grok 五件套落地回归；`execute.test.ts` harnessOverride 路由
- [x] **9. gen-assets 重跑**（模板 README + hook 变更 → 已重跑，assets/manifest/capabilities freshness OK）
- [x] **10. 素材产出**：Grok 真实会话验证清单 + hook 格式实测经验 → 写入本任务 notes（P5 harness-grok.md 内容源）
- [x] **11. wire grok TOML**：`jspace harness` 命令族 + `~/.grok/config.toml` 读-改-写（保留其他表 + 备份；实机 temp config 验证合并正确）

## 验证命令（全部通过）

```bash
bunx tsc --noEmit                                    # TSC OK
bun test                                             # 467 pass / 0 fail
bun run scripts/gen-assets.ts                        # 幂等; freshness OK
bun run cli/main.ts init /tmp/jspace-grok            # .grok/hooks/jspace.json + .grok/skills/ 落地
bun run cli/main.ts context pre-compact --plain --dir <wb>   # 被动提醒,不写 gbrain
bun run cli/main.ts context session-end --plain --dir <wb>   # 结算提醒
bun run cli/main.ts harness wire --harness grok --dir <wb>   # 无 config -> error; 有 config -> 合并
bun run cli/main.ts cron run inbox-tidy --harness grok --dry-run  # grok argv 组装
bun test application/automation/execute.test.ts     # harnessOverride 路由 seam
```

## 风险文件 / 回滚点

- `templates/workbench/.grok/`（模板增量，init 新出）→ 删模板条目 + revert 即回滚
- `cli/commands/context.ts` + `application/context/{collect,payload,envelope}.ts`（纯新增子命令，不动 session-start/turn）
- `application/gbrain/grok-wiring.ts` + `cli/commands/harness.ts`（新增；TOML 最小行编辑，只改 gbrain env 表）
- 注意：hook 只写 `.grok/hooks/jspace.json` 一处，不复制到 `.claude/settings.json`（R8 双写权衡已接受，去重靠 session-start 幂等）

## task.py start 前 follow-up

- [ ] pre-compact 语义 = 被动注入（D2/方案 a），无自动写 gbrain 路径
- [ ] 模板 skill 投影源仍是 `.jspace/skills/`（harness-agnostic），`.grok/skills/` 是目标投影
- [ ] managed-files 清单措辞与现有 `.claude/settings.json` 条目一致
