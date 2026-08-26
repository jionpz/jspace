# Implement: 安全路径（#3 + #4 + #12 + #15）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

### #4（ingest 源文件边界）
1. `core/contracts/ingest.ts` decoder：`source`/`target` 绝对路径 + 三字段拒 `..`/`.` 段（新增 issue codes）。
2. `application/ingest/use-cases.ts`：
   - `ingestBegin`：`sourceAbs = resolve(args.file)`，`isWithin(sourceAbs, join(fh, "_inbox"))` 否则 fail；journal 存 `sourceAbs`。
   - 新增 `filehubOps(root)`（unlink 加 filehub 边界守卫）；`ingestAdvance`/`ingestFail`/`ingestRollback` 改用它。
3. 测试（use-cases.test.ts + ingest 契约测试）：
   - begin 源在 `_inbox` 外 → toThrow；`_inbox` 内 → staged + source 绝对。
   - 手改 journal source 指向 filehub 外 → complete 拒绝 unlink。
   - decoder 对 `..` 出 issue。

### #3（Windows cmd 注入）
4. `adapters/process/spawn.ts`：加 `cmdEscapeArg`（含 `[\s&|<>^%!"]` → 整体加引号 + 内嵌 `"` 双写）；`.cmd` 分支改用。
5. 测试（spawn.test.ts）：`hello&whoami`、`" & whoami`、`>` 参数转义；无元字符参数不变。

### #12（crontab 特殊字符）
6. `adapters/scheduler/linux.ts`：
   - `crontabLine` 顶部 `rejectControlChars(root, path, home, jspaceBin, c.id, log)`（拒 `\n\r\0`）。
   - 重写 `parseManagedLine`：schedule 前 5 字段 + `cron run` 段 `--dir`/`--id` 用 `quotedTokenLen`+`unshq`（`'\''`→`'`、`\%`→`%`）+ taskId 尾部匹配 + tag 过滤。
7. 测试（scheduler.test.ts）：含 `\n` → toThrow；root 含 `'`/`%`/空格 round-trip 收敛；现有用例不回归。

### #15（rollback 路径约束）
8. `application/workspace/workspace.ts`：`rollbackUpgrade` 读 journal 后调 `validateRollbackTarget`（id 限 UUID + plan rel 过 portabilityIssues + isWithin）。
9. 测试（workspace.test.ts）：非 UUID id → fail；`..` rel → fail；现有 rollback 用例不回归。

### 验证
10. `bunx tsc --noEmit`
11. `bun test application/ingest/use-cases.test.ts adapters/process/spawn.test.ts adapters/scheduler/scheduler.test.ts application/workspace/workspace.test.ts`
12. 全量 `bun test`

## Validation Commands

```bash
bunx tsc --noEmit
bun test application/ingest/use-cases.test.ts adapters/process/spawn.test.ts adapters/scheduler/scheduler.test.ts application/workspace/workspace.test.ts
bun test   # 全量
```

## Review Gates

- [ ] #4 begin 外部源被拒；unlink guard 拒绝逃逸；decoder 拒 `..`。
- [ ] #3 `hello&whoami` / `" & whoami` 被转义（RCE 路径闭合）。
- [ ] #12 换行注入拒绝 + `'`/`%`/空格 round-trip 收敛。
- [ ] #15 非 UUID id / `..` rel 被拒。
- [ ] 既有 ingest / spawn / scheduler / workspace 用例不回归；tsc 0 错；全量 `bun test` 绿。

## Rollback Points

- 四处为局部改动 + 测试，无状态迁移；出问题 revert 本批提交即可。
- #12 parse 重写风险最大（monolithic 正则 → 扫描器），若回归过多可回退到「仅换行拒绝」的最小修复并单列 round-trip 后续批。
