# P4 Implement: Pi 插件通道 + 诚实边界

## 有序检查清单（全部完成，2026-08-09）

- [x] **1. `adapters/harness/capabilities.yaml` pi 条目核验**：P1 已按 D4 终值定义，确认一致——`mcp: via: pi_mcp_adapter`、`sessions` source:extension、`user_install: [~/.agents/skills]`、`hook_format: none`、`native_memory: none`；无临时占位
- [x] **2. `skills/jspace-use/references/harness-pi.md`**：支持面表（capsules）+ **安装提示**（`pi install npm:pi-mcp-adapter` + 6 级配置优先级 + gbrain MCP stdio 示例 + **供应链核对**红线）+ 会话注入两路 + 诚实边界 + 验证命令
- [x] **3. `application/diagnostics/doctor.ts` checkHarness Pi 分支**：活跃 pi harness + pi CLI 在 PATH → info `harness.pi_mcp_adapter`（提示装扩展 + **行内供应链警告**「npm executes package code — verify source first」）；CLI 缺失 → warning `harness.bin_missing`；不修改既有配置
- [x] **4. `adapters/harness/pi.ts`**：headlessArgv `pi -p <prompt>`（P1 已实现，本任务验证 + 测试锁定）；hook 文件无（hook_format none）
- [x] **5. 测试**：`registry.test.ts` 补 pi 边界断言（mcp via / sessions extension / user_install / hook_format none）+ pi argv；`doctor.test.ts` 补 3 case（wired→info hint / missing→bin_missing / 非活跃不探）
- [x] **6. gen-assets 重跑**（harness-pi.md 落 skills/ 嵌入范围 → 已重跑，assets/manifest/capabilities freshness OK；harness-pi.md 确认 embedded）
- [x] **7. references 索引归 P5**：harness-*.md 索引 + SKILL.md 引用区更新由 P5 统一做，本任务只创建 harness-pi.md

## 验证命令（全部通过）

```bash
bunx tsc --noEmit                                    # TSC OK
bun test                                             # 478 pass / 0 fail
bun run scripts/gen-assets.ts                        # 幂等; harness-pi.md embedded
bun run cli/main.ts cron run inbox-tidy --harness pi --dry-run   # pi -p <prompt>
bun run cli/main.ts doctor --json --dir <wb>          # harness.pi_mcp_adapter info + 供应链警告
grep -n "via_pi_mcp_adapter\|pi-mcp-adapter" adapters/harness/capabilities.yaml skills/jspace-use/references/harness-pi.md
```

## 风险文件 / 回滚点

- `adapters/harness/capabilities.yaml`（pi 字段声明，纯数据）→ revert 即回滚
- `skills/jspace-use/references/harness-pi.md`（新增文档）
- `application/diagnostics/doctor.ts`（Pi 分支增量）
- 红线：**不自动执行 `pi install`**，只提示（npm 即执行代码）——doctor 行内供应链警告已落实

## task.py start 前 follow-up

- [x] 供应链核对提醒出现在安装提示旁（红线级）——harness-pi.md + doctor 双处
- [x] `mcp: via: pi_mcp_adapter` 与 claude 的 `native: true` 语义可区分（联合类型）
- [x] sessions 标注 source:extension，不冒充原生 hook
