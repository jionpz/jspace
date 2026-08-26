# Implement: CLI 参数 dest + 退出码语义（#2 + #9）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

### #2（`--tag` dest）
1. `cli/commands/domain.ts:20` `--tag` 加 `dest: "tags"`。
2. `cli/commands/resource.ts:23` `--tag` 加 `dest: "tags"`。
3. `cli/handler-wiring.test.ts` 加测试：
   - `domain add work --tag alpha --tag beta` → hub domains[work].tags === ["alpha","beta"]。
   - `--tag work --tag work` → ["work"]。
   - `resource add proj --domain work --path <abs> --tag x` → hub resources[proj].tags === ["x"]。

### #9（退出码 + errors）
4. `cli/commands/skills.ts`：抽出 `export function installHandler(ctx, args, deps = installDeps(ctx.dryRun))`；catch 改 `errors + exitCode: 1`；`installSpec.handler = installHandler`。
5. `cli/commands/harness.ts`：抽出 `export function grokWireHandler(ctx, deps = grokWireDeps(ctx.dryRun))`；catch 改 `errors + exitCode: 1`；`!result.ok` 分支 `jspace: error:` 迁 `errors`；`--harness` 加 `validate`（非 grok → 解析层 exit 2）；删除 handler 内 `harness === ""` / unsupported 分支。
6. `cli/commands/gbrain.ts`：抽出 `export function wireHandler(ctx, deps = wireDeps(ctx.dryRun))`；catch 改 `errors + exitCode: 1`；status error case 的 `jspace: error:` 迁 `errors`。
7. 测试（新建 `cli/commands/error-semantics.test.ts` 或并入现有文件）：
   - 三个 handler 注入 `writeFile` 抛错 deps → `exitCode === 1` + `errors` 非空 + `warnings` 空。
   - 成功/dry-run 路径 → `errors`/`warnings` 空、exitCode undefined。
   - `parse(["harness","wire","--harness","claude"], ROOT)` → ArgError（exit 2）。

### 验证
8. `bunx tsc --noEmit`
9. `bun test cli/handler-wiring.test.ts` + #9 测试文件
10. 全量 `bun test`

## Validation Commands

```bash
bunx tsc --noEmit
bun test cli/handler-wiring.test.ts
bun test   # 全量
```

## Review Gates

- [ ] #2 断言在改动前红（无 dest 时 `args.tags` undefined → tags 空），改动后绿。
- [ ] #9 三个 handler 的失败路径 `exitCode === 1` + errors；success 路径无 errors/warnings。
- [ ] `harness wire --harness claude` → ArgError exit 2。
- [ ] 全量 `bun test` 绿；tsc 0 错误。

## Rollback Points

- 纯 CLI 层改动（spec + handler），无状态迁移；出问题 revert 本批提交即可。
- `--harness` validate 行为变化（exit 1→2）已记录在 design 风险节；若需回退只改该行。
