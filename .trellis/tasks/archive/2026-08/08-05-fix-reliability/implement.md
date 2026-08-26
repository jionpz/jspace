# 执行：数据一致性修补（fix-reliability）

## 前置

- [x] prd.md（R1–R6）
- [x] design.md
- [ ] **G0：用户审阅通过 → `task.py start`** ← 门禁

## Checklist（每步 tsc + bun test 验证）

### R1 failIngest 标记碰撞
- [ ] `journal.ts` failIngest：`failedStep = j.status as IngestStep`（注释更新为「最后完成的步」）
- [ ] `use-cases.ts:108` 提示条件 `"gbrain"` → `"staged"`
- [ ] 更新 journal.test.ts:141（"staged"）/ :155（"gbrain"）
- [ ] 改写 journal.test.ts:344-361：fail-at-index → 非 cleanup-pending、`--complete` 拒绝、源未删、重新 begin 恢复
- [ ] tsc + bun test 绿

### R2 run/incident 原子写
- [ ] runs.ts `writeRun` → `writeBytesAtomic`
- [ ] incidents.ts `writeIncident` → `writeBytesAtomic`
- [ ] tsc + bun test 绿

### R3 applyPending 空页
- [ ] apply.ts 空内容判定 `!== ""`
- [ ] TOCTOU 注释
- [ ] 新增 apply.test.ts 空页用例
- [ ] tsc + bun test 绿

### R4 日志文件名
- [ ] execute.ts runId 提前 + 文件名含 runId 前 8 位
- [ ] tsc + bun test 绿

### R5 dry-run hub 迁移
- [ ] workspace.ts dry-run：migrated 才加 [migrate]；no-migration 标 [manual]
- [ ] 新增 workspace.test.ts dry-run no-migration 用例
- [ ] tsc + bun test 绿

### R6 init --force 防护
- [ ] init.ts force 时枚举碰撞文件 + 备份 `<rel>.jspace-bak` + 报告行
- [ ] tsc + bun test 绿（含 init.test.ts 回归）

### 收尾
- [ ] `git status` / `git diff` review；`bun run scripts/gen-assets.ts` + `git diff --exit-code cli/*.generated.ts` 门禁
- [ ] 提交；写 notes；`task.py finish`

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun run scripts/gen-assets.ts >/dev/null && git diff --exit-code cli/*.generated.ts
```

## 门禁

- **G0**：design 审阅通过才 start。
- **G1**：R1 完成后单独 tsc+test 绿（涉及行为语义 + 测试改写，最先做）。
- **G2**：全部完成，tsc + test 全绿，diff 仅限预期文件。

## 风险

- R1 改语义 + 改 3 处测试断言 + 改写 1 个固化 bug 的测试：若误判某个 cleanup-pending 消费方会 tsc/test 立即暴露；建议 G1 单独验证。
- R6 备份文件 `.jspace-bak` 会在目标目录残留 → 属预期的用户数据保全（review 建议），不隐式删除。
