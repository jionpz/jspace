# P5 Implement: 跨 harness 一致性 + CI 锁定

## 有序检查清单（全部完成，2026-08-09）

- [x] **1. `scripts/check-harness-consistency.ts`**：6 条断言（1 harness-*.md 文档集 = documented keys；2 cron.ts HARNESSES 双向 == capabilities enum + cron.json 值 ⊆ keys；3 adapter 文件名 ⊆ keys；4 字段值级：pi mcp literal 双处 + grok 四 hook 事件 + opencode 三 plugin 事件；5 SKILL.md 参考区覆盖（含 brace-group 简写）；6 手写列表 = 全支持集，jspace 域限定、显式排除 harness-config/）
- [x] **2. 负向验证**：4 类漂移均验证红（漏 Grok / cron.ts enum 不同步 / extra harness doc / missing harness doc），还原后全绿
- [x] **3. harnesses.md machine-render**：全景表（auto-generated from capabilities.yaml 标注，含 lifecycle 列 + 4 分级语义）+ 逐 harness 接线链接；`docs/PLATFORMS.md` 引用标外部稳定依赖
- [x] **4. 创建 harness-claude/grok/opencode/cursor.md**：逐 harness 真实能力（claude 参考实现 / grok T1 桥接含待验证清单 / opencode T2.5 plugin / cursor D6 保留无 headless）；harness-pi.md 已由 P4 创建
- [x] **5. 支持集文档同步（D6）**：`templates/workbench/AGENTS.md` harness 声明（6 harness）、`docs/PLATFORMS.md` cron argv 表（+grok/opencode，cursor 无 headless 注明 + 支持集句）、root `AGENTS.md` + `GOAL.md` 愿景列表更新
- [x] **6. `skills/jspace-use/SKILL.md` 引用区**：更新为覆盖全部 harness-*.md（含 brace-group 简写）
- [x] **7. `docs/PLATFORMS.md`**：Cron Harness 表更新为 capabilities 驱动（argv 单测证据注），支持集句
- [x] **8. `verify.yml`**：加 harness-consistency 检查（tsc/test 之后，P3-1 drift guard 之后）
- [x] **9. 测试**：`lifecycle-and-safety.test.ts` 更新（分级语义 + auto-generated 标注 + harness-<name>.md 链接，替代旧「Lifecycle 能力矩阵」节名）；`assets-reachability.test.ts` 的 docs/ 引用加外部标记
- [x] **10. gen-assets 重跑**（skills/ + templates/ 内容变更 → 已重跑，编译二进制 init 验证 5 份 harness-*.md 落地 + AGENTS 列表正确）

## 验证命令（全部通过）

```bash
bun run scripts/check-harness-consistency.ts          # all assertions pass
# 负向:临时制造漂移(漏 Grok / cron.ts enum 不同步 / 删 harness doc)→ 重跑 → 红
bunx tsc --noEmit                                      # TSC OK
bun test                                               # 478 pass / 0 fail
bun run scripts/gen-assets.ts                          # 幂等
bun run build && ./bin/jspace init /tmp/x              # 编译二进制嵌入 5 份 harness-*.md
```

## 风险文件 / 回滚点

- `scripts/check-harness-consistency.ts`（新增，独立脚本）→ revert 即回滚
- `skills/jspace-use/references/harnesses.md`（手写→render，值来源 P1 lifecycle）
- `templates/workbench/AGENTS.md`（D6 支持集声明更新）
- `.github/workflows/verify.yml`（CI 加步骤，纯增量）
- 哲学：**宁可过度红不可静默漂移**——4 类负向漂移已验证脚本红

## task.py start 前 follow-up

- [x] P1 的 lifecycle 字段已含（render 数据源）
- [x] P2/P3 notes 素材已产出（harness-grok/opencode.md 内容来源）
- [x] codex documented:false 豁免语义已定（断言 1 只看 documented keys）
- [x] harness-config/ 排除范围已确认（断言 6 只扫 templates/AGENTS + PLATFORMS + harnesses.md）
