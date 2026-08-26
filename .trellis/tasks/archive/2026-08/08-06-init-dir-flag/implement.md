# init 支持 --dir：执行清单

## 改动

1. `cli/commands/registry.ts`：`initSpec` 加 `features: { dir: true }`；handler 改为优先 `ctx.root`（`--dir` ?? cwd），位置参数 `target` 保留兼容。
2. handler 内冲突检测：`ctx.dir`（原始 --dir 值）与 `args.target` 同时非空 → 抛 `CliError`（exit 2，ambiguous 措辞对齐框架）。
3. 帮助文本自动带 `--dir`（features 注入）；无需手改。
4. 测试：`cli/init.test.ts` / `cli/handler-wiring.test.ts` 新增 `--dir` 成功、位置参数兼容、`--dir X target` 冲突 exit 2 用例。
5. 文档（README / GOAL.md / skills 中 init 用法）优先推荐 `--dir`，位置参数标兼容。

## 验证命令

```bash
bun run cli/main.ts init --dir "$(mktemp -d)"     # 成功
bun run cli/main.ts init "$(mktemp -d)"            # 位置参数仍可用
bun run cli/main.ts init --dir A B                 # ambiguous, exit 2
bun run cli/main.ts init --help                    # 展示 --dir DIR
bun test cli/init.test.ts cli/handler-wiring.test.ts
bunx tsc --noEmit
```

## Review Gate

- `--dir` 与位置参数均可 init；冲突 exit 2；帮助文本正确；错误路径（非空目录/already-init）经 --dir 同样生效。
