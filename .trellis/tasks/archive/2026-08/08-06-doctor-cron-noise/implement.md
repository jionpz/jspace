# doctor 噪音：执行清单

## 改动

1. `templates/workbench/.jspace/cron.json`：三个预设 cron 的 `enabled: true` → `false`。
2. `core/contracts/diagnostics.ts`：`Severity = "error" | "warning" | "info"`。
3. `application/workspace/doctor.ts`：
   - `filehub.unregistered`（约 L66-71）severity 改 `"info"`。
   - 汇总逻辑（约 L172-182）把 info 从 warnings 中分离：`errors`/`warnings` 过滤不含 info；汇总行可加 info 计数；`data.diagnostics` 保留 info 条目。
4. `cli/main.ts`：info 打印策略（不混入 error/warning 行；如需展示用独立行，或不打印仅进 --json）。
5. 测试 `application/workspace/doctor.test.ts`：更新受影响断言；新增默认模板 0 warning + filehub severity=info 用例。
6. `bun run scripts/gen-assets.ts`：模板改动后同步编译产物嵌入式资产（memory: jspace-cli-assets-regeneration）。

## 验证命令

```bash
bun run scripts/gen-assets.ts
TMP=$(mktemp -d); bun run cli/main.ts init "$TMP"
bun run cli/main.ts doctor --dir "$TMP"        # 期望 0 error(s), 0 warning(s)
bun run cli/main.ts doctor --dir "$TMP" --json # filehub.unregistered severity=info
bun test application/workspace/doctor.test.ts application/workspace/manifest.test.ts application/workspace/workspace.test.ts
bunx tsc --noEmit
```

## Review Gate

- 全新 init → doctor 0 warning；filehub 诊断 severity=info 且 exit 0。
- 显式启用 cron 未安装仍报 `cron.not_installed` warning（doctor.test.ts:65 语义保留）。
- 模板改动同步进嵌入式资产（assets.generated.ts 含 enabled:false）。
