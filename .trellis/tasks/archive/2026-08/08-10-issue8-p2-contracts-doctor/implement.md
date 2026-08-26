# Implement: 契约/架构/doctor 对齐（#10 #11 #13 #14 #16 #17）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

### 先做小项（#11 → #13 → #10 → #14）
1. **#11** `application/automation/scheduler.ts`：`canonicalSchedule`（dow 7→0）+ 比较用；`application/automation/scheduler.test.ts` 加「7 vs 0 → no-op」round-trip。
2. **#13** `application/registry/domain.ts` `domainAdd`：`writeHubAtomic` try/catch → `rollbackDomainSkeleton` + rethrow；`registry.test.ts` 加写失败回滚用例。
3. **#10** `core/contracts/hub.ts` decodeResources filehub 计数；`application/registry/resource.ts` resourceAdd 拒第二个 filehub；`core/registry/effective.ts` primaryPathForResourceType 多条 fail；测试：decode 双 filehub issue + resourceAdd 拒 + effective fail。
4. **#14** `application/diagnostics/doctor.ts` `checkDomains`：改收 `reads`（hub）；按 `hub.domains[].path` 扫 + 未注册 `workspace/*` → `domain.unregistered`；doctor.test 补自定义 path + unregistered。

### #17（解环）
5. 新建 `application/workspace/ownership.ts`（`ownershipFor`/`recreateOnMissing` 移入，纯模块）；`manifest.ts` re-export；`SKILL_PROJECTIONS` → `skillProjections()` 函数，更新 manifest.ts:62 + doctor.ts 消费。
6. `scripts/gen-assets.ts` import 改 `ownership.ts` + `core/shared/hash.ts`。
7. 验证：`rm adapters/harness/capabilities.generated.ts && bun run scripts/gen-assets.ts` 成功再生；恢复后 `gen-assets` 新鲜度（diff 干净）。

### #16（大项，可隔离）
8. capabilities.yaml 每 harness 增 `mcp_config`；`types.ts` 增 `McpConfig`；gen-assets 渲染；`check-harness-consistency.ts` 期望表同步。
9. `harness wire` 统一（--harness 支持集扩到 claude/grok）；claude 分支调 `wireSkillsDir`；grok 走 `wireGrokSkillsDir`。
10. doctor `checkGBrain` 多 harness 检查（遍历 mcp.native + mcp_config）。
11. **降级门**：若一致性脚本（check-harness-consistency）红且难以收敛 → 保留数据面（yaml+types+渲染+doctor 检查），`harness wire` 统一降级为「仅 claude 别名 + 文档」，单独提交并注明。

### 验证
12. `bunx tsc --noEmit`；定向测试（scheduler/registry/doctor/manifest/gen-assets）；全量 `bun test`；check-harness-consistency / check-manifest-integrity / check-skills（含 gen-assets 新鲜度）。

## Validation Commands

```bash
bunx tsc --noEmit
bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts adapters/harness/capabilities.generated.ts   # 新鲜度
bun test   # 全量
bun run scripts/check-harness-consistency.ts && bun run scripts/check-manifest-integrity.ts && bun run scripts/check-skills.ts
```

## Review Gates

- [ ] #10/#11/#13/#14 各有回归；#17 解环验证（删 generated 后 gen-assets 再生成功）。
- [ ] #16 数据面 + doctor 检查全绿；若 harness wire 统一导致 consistency 红 → 走降级门。
- [ ] tsc 0 错；全量 `bun test` 绿；三个一致性脚本全绿（含 generated 新鲜度）。

## Rollback Points

- 小项（#10/#11/#13/#14）相互独立，可单独 revert。
- #17 若 `skillProjections()` 消费点漏改 → tsc 兜底，回退该提交。
- #16 是最大风险：若 balloon，按降级门拆「数据面 + doctor」与「harness wire 统一」两个提交，前者先行。
