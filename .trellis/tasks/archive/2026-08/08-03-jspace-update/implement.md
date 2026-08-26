# jspace update 自更新 — 执行计划

## 实施清单（按序）

- [x] 1. `scripts/gen-version.ts`：写 `cli/version.generated.ts`，值 = `JSPACE_BUILD_VERSION || git describe --tags --abbrev=0 || "0.0.0-dev"`。
- [x] 2. `cli/version.generated.ts` 提交占位 `"0.0.0-dev"`；`cli/args.ts` + `cli/init.ts` 删硬编码 VERSION，import 单源。
- [x] 3. package.json：build/build:all/build:win/build:linux 前置 `bun run scripts/gen-version.ts`。
- [x] 4. `.github/workflows/build.yml`：tag 触发时 `JSPACE_BUILD_VERSION: ${{ github.ref_name }}`（build 作业 env）。
- [x] 5. `cli/update.ts`：纯函数 `compareVersions`、`assetFor(platform, arch)`、`sha256(file)`、`parseChecksums`；命令实现 update/--check/--version/开发版跳过/自替换(Unix mv + Windows rename→.old→写新→下次清理)。
- [x] 6. `cli/args.ts` 注册 `update`（TOP_CHOICES + UPDATE 解析 + help）；`cli/main.ts` 分发。
- [x] 7. 单测：`cli/update.test.ts` 覆盖 `compareVersions`（v 前缀/缺位/prerelease）、`assetFor`、`parseChecksums`（双空格/`*` 前缀/大写 hex）。
- [x] 8. 本地 mock e2e：`JSPACE_BUILD_VERSION=1.0.0` 构建旧二进制 → 本地 HTTP 供 v2.0.0 资产+checksums → `update` 替换成功 `--version` 变 2.0.0；篡改 checksums → 拒绝 exit≠0 无残留；`--check` 只报告。
- [x] 9. 发 v1.0.2（含本改动）→ 用 **v1.0.1 二进制真跑 `jspace update`** → 升级到 1.0.2（真实闭环，macOS）。
- [x] 10. 回归：`bunx tsc --noEmit`、`bun run build`、CI verify-install 三平台全绿。

## 验证命令

```bash
# 语法/类型/单测
bunx tsc --noEmit
bun test cli/update.test.ts

# 本地 mock e2e（两版本二进制）
JSPACE_BUILD_VERSION=1.0.0 bun run build    # → bin/jspace 报告 jspace 1.0.0
JSPACE_BUILD_VERSION=2.0.0 bun run build    # → 存为 mock 资产，本地 HTTP 服务
JSPACE_BASE_URL=http://127.0.0.1:PORT JSPACE_VERSION=v2.0.0 bin/jspace update --check
JSPACE_BASE_URL=http://127.0.0.1:PORT JSPACE_VERSION=v2.0.0 bin/jspace update
bin/jspace --version    # 期望 jspace 2.0.0

# 开发版跳过
JSPACE_BUILD_VERSION=0.0.0-dev bun run build && bin/jspace update   # 期望跳过提示

# 真实闭环（发 v1.0.2 后）
curl -fsSL .../install.sh | bash   # 或复用现有 v1.0.1 安装
jspace update --check              # 期望报 v1.0.2 可更新
jspace update                      # 期望升级到 v1.0.2
jspace --version                   # jspace 1.0.2
```

## 风险文件 / 回滚点

- `cli/version.generated.ts`：提交占位 + 构建时生成；gitignore 不适用（需 tsc 可过），构建脚本覆盖。
- `cli/args.ts`/`cli/main.ts`/`cli/init.ts`：版本单源改动 + 命令注册，可 revert。
- `scripts/gen-version.ts` + package.json + build.yml：构建管线，可 revert。
- v1.0.2 发布：外部动作，执行前 owner 确认；出错可删 release 重建。

## task.py start 前复查

- [ ] prd 收敛（无 TBD/重复事实/过期版本号事实）
- [ ] design.md / implement.md 齐备
- [ ] 版本注入方案（generated file）与自替换方案（Unix mv / Windows rename）经 owner 批准

## 发布记录（wrap-up 追加）

- [x] 11. 提交 `635fa43`、推 main、发 **v1.0.2**（经 owner 确认）：
  - CI 6 平台全绿 + release Latest + verify-install 三平台全绿。
  - **真实升级闭环**：本地 bin/jspace(1.0.1) → `update --check` 报 1.0.2 → `update` 真实下载+校验+自替换 → `--version` 报告 `jspace 1.0.2`。
  - v1.0.2 起二进制报告真实版本（CI 注入 JSPACE_BUILD_VERSION=github.ref_name）；版本单源化修复此前 VERSION=1.0.0 过期问题。
