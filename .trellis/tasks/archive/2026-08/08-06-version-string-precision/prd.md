# 版本串精度：--version 显示领先提交

## Goal

`jspace --version` 目前只能显示 tag 版本号（`1.0.9`），无法区分「恰好等于 tag」与「领先 tag 若干提交」的构建。同一版本号可能对应不同代码行为，dev 场景下「我用的 jspace 是不是最新」没有答案。本任务让非发布构建的版本串携带 commit 信息，发布构建保持干净。

## Requirements

- `scripts/gen-version.ts` 用 `git describe --tags`（去掉 `--abbrev=0`）生成版本串：非 tag HEAD 得到 `1.0.9-2-g7cef2bc`，恰好 tag 时得到 `1.0.9`。
- 保留 `JSPACE_BUILD_VERSION` 覆盖优先（CI tag 发布路径已设，build.yml:47）：发布构建版本串保持干净 tag，不受 `git describe` 后缀影响。
- 保留 `git describe` 失败时的 `0.0.0-dev` fallback（`isDevVersion` 据此跳过自更新，语义不变）。
- `cli/update.ts` 的 `compareVersions` 对带后缀版本串必须继续正确：`1.0.9-2-g7cef2bc` 与 `1.0.9` 判等（已装同 tag 的领先构建 = up-to-date，不被 update 覆盖/降级）；对更高发布 tag 判可更新。
- 不改变现有构建入口（package.json:14-17 已全部在编译前跑 gen-version.ts）。

## Acceptance Criteria

- [ ] `bun run scripts/gen-version.ts` 后 `cli/version.generated.ts` 的 `VERSION` 含 `-N-gHASH` 后缀（当前 HEAD 领先 v1.0.9 两个提交，应得 `1.0.9-2-g7cef2bc`）。
- [ ] `git checkout v1.0.9` 时（或模拟 tag HEAD）`VERSION` 为干净 `1.0.9`。
- [ ] `JSPACE_BUILD_VERSION=1.0.9 bun run scripts/gen-version.ts` 产物为 `1.0.9`（覆盖生效）。
- [ ] `compareVersions("1.0.9-2-g7cef2bc", "1.0.9") === 0`；`compareVersions("1.0.9-2-g7cef2bc", "1.1.0") < 0`（update 逻辑不受破坏）。
- [ ] `bun test cli/update.test.ts` 全绿。
- [ ] 文档中版本说明（README / GOAL.md 若提及版本格式）与新行为一致。

## Notes

- 与二进制漂移解耦：漂移根治（构建前跑 gen-version.ts）已在 1.0.9 完成，本任务只改版本串编码精度。
- `git describe --tags` 在无 tag 仓库会失败 → 现有 catch 已 fallback `0.0.0-dev`，无需新增逻辑。
- 仓库 PUBLIC：不引入真实路径/数据。
