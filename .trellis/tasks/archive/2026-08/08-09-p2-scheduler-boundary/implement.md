# P2-1 scheduler applyOps linux 穿透下沉 —— implement

## Checklist(按序)

- [ ] 1. `adapters/scheduler/types.ts`:`SchedulerAdapter` 接口加 `applyBatch(ops, enabled, tag, root, env): string[]`(见 design 端口形态),JSDoc 说明默认语义与 linux 覆盖。
- [ ] 2. `adapters/scheduler/linux.ts`:
  - 拆出 `crontabLine(c, tag, root, jspaceBin, path, home)`(现 `crontabBlock` 的 map 体),`crontabBlock` 改为 `lines.map(crontabLine)`;
  - `buildContent` 返回 `crontabLine(c, tag, root, env.jspaceBinary, env.path, env.home)`,删除「placeholder」注释;
  - 实现 `applyBatch`:`crontabBlock(enabled, ...)` 重建整块(0 enabled → 空块),带 backup `replaceManagedBlock` + `writeCrontab`,返回报告行。保留/复用现 `apply` 里的 create/update 写盘逻辑。
- [ ] 3. `adapters/scheduler/darwin.ts` / `win32.ts`:实现 `applyBatch = ops.flatMap(apply)`(逐 op)。
- [ ] 4. `application/automation/scheduler-service.ts`:删除 `crontabBlock` import 与整个 `applyOps`(含 linux 分支),`cronInstall` 改调 `deps.adapter.applyBatch(ops, enabled, deps.tag, root, deps.env)`。
- [ ] 5. 回归:`bun test`(重点 use-cases.test.ts / scheduler.test.ts / execute 相关)、`tsc --noEmit`。
- [ ] 6. 若 use-cases.test.ts 有 mock adapter,补 `applyBatch`(或加默认实现避免破坏);确认 cronInstall 各 distribution 分支断言仍成立。
- [ ] 7. 确认无残留 `crontabBlock` 引用在 application 层(grep `scheduler-service` / `application/automation`)。

## 验证命令

```bash
bun test 2>&1 | tail -5          # 期望全绿
bunx tsc --noEmit                # 期望无错误
grep -rn "crontabBlock" application/  # 期望空
```

## Review gate

- 提交前 diff review:确认 application 层不再 import adapter 内部 helper、无 `adapter.platform === "linux"` 特判。
- 行为等价:darwin/win32 逐 op 不变;linux 整块重建覆盖 create/update/delete。

## 回滚

- 单 commit 整体 revert 即可(端口 additive,无持久化格式变更)。
- 若中途发现 planReconciliation 与整块语义冲突,回退到「applyOps 保留但把 crontabBlock 移进 adapter」的中间形态(design 方案对比的降级)。
