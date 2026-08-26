# 版本串精度：执行清单

## 改动

1. `scripts/gen-version.ts`：`git describe --tags --abbrev=0` → `git describe --tags`（去掉 `--abbrev=0`），保留 `JSPACE_BUILD_VERSION` 覆盖与 `0.0.0-dev` fallback 不变。
2. 文档同步：README / GOAL.md 若提到版本格式，标注 dev 构建带 `-N-gHASH`。

## 验证命令

```bash
bun run scripts/gen-version.ts        # 期望 VERSION=1.0.9-2-g7cef2bc
git describe --tags --abbrev=0        # 对照：1.0.9（发布路径仍干净）
JSPACE_BUILD_VERSION=1.0.9 bun run scripts/gen-version.ts   # 期望 1.0.9（覆盖生效）
bun test cli/update.test.ts           # compareVersions 兼容性回归
bunx tsc --noEmit                     # 类型门禁
```

## Review Gate

- 产物版本串含 `-N-gHASH`，tag/覆盖路径干净。
- update 比较逻辑无回归（`1.0.9-2-g7cef2bc` vs `1.0.9` 判等，vs `1.1.0` 判旧）。
