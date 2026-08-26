# Implement: pending realGbrain 下沉 adapter（#8）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

1. **`adapters/process/spawn.ts`**：`SpawnOpts.input?`（stdin）+ `SpawnResult.stdout/stderr`（分开收集，output 保持合并）。
2. **`adapters/gbrain/gbrain.ts`**（新）：`GbrainDeps`（async 端口）、`GbrainRun`、`realGbrain(run, timeoutMs)`。
3. **`application/pending/apply.ts`**：删本地 `GbrainDeps`/`realGbrain`（+ `spawnSync` import）；`applyPending` → async + `await get/put`；引 `GbrainDeps` type from adapters/gbrain。
4. **`application/pending/use-cases.ts`**：`pendingApply` → async + await；默认 `realGbrain()` from adapters/gbrain。
5. **`cli/commands/pending.ts`**：`pending apply` handler → async + await。
6. **测试**：
   - `adapters/gbrain/gbrain.test.ts`（新）：fake run 接线断言（get/put/ok/fail/timedOut/input/timeout）。
   - `adapters/process/spawn.test.ts`：stdin round-trip + stdout/stderr 分离。
   - `application/pending/apply.test.ts`：stub 改 Promise + await；语义不变。
7. **验证**：`bunx tsc --noEmit`；`bun test adapters/gbrain/gbrain.test.ts adapters/process/spawn.test.ts application/pending/apply.test.ts`；全量 `bun test`；import-boundary；CLI 冒烟（temp filehub + 无 gbrain → pending apply 不挂死）。

## Validation Commands

```bash
bunx tsc --noEmit
bun test adapters/gbrain/gbrain.test.ts adapters/process/spawn.test.ts application/pending/apply.test.ts
bun test   # 全量
# 冒烟
rm -rf /tmp/jspace-pend-smoke && bun run cli/main.ts init /tmp/jspace-pend-smoke
# filehub init + 一个 staged envelope 后 pending apply（无 gbrain 二进制 → 应 exit 1 且快速返回）
```

## Review Gates

- [ ] `spawnProcess` stdout/stderr 分离正确；stdin 喂入正确。
- [ ] `realGbrain` get 用 stdout、put 用 stdin、均 timeout+cap；timedOut → `{ok:false}`。
- [ ] `applyPending`/`pendingApply` async 化后 CLI `pending apply` 可用、不挂死。
- [ ] 既有 pending 语义用例（幂等/去重/重试/terminal）不回归；全量绿；tsc 0 错。

## Rollback Points

- refactor 纯代码移动 + async 化，无状态迁移；revert 本批提交即可。
- 若 `spawnProcess` 增字段有意外回归，先单独 revert spawn.ts 扩展。
