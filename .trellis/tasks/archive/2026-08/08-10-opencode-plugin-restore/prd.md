# OpenCode plugin 源文件丢失修复 (issue #6)

## Goal

修复 release-blocking:release 后 OpenCode 用户将无法 init 出 jspace plugin。

## Confirmed Facts（已实测验证）

- `templates/workbench/.opencode/plugins/jspace.ts` **不在 git 树**（`git ls-files` 空、`git log --all` 空），但磁盘存在、`cli/assets.generated.ts` / `manifest.generated.ts` 含完整 entry、init 能 materialize（init 从 ASSETS map 读）
- **根因**：`.gitignore:38` 的 `.opencode/` 规则误吞模板；对照 `.claude/` 有专门例外（`.gitignore:43-44` `!templates/workbench/.claude/` + settings.json），**`.opencode/` 漏补例外**
- **fresh clone 复现**：移走磁盘文件 → 跑 `gen-assets` → `manifest.generated.ts` 的 plugin entry 被 **silent 移除**（0 条）→ 一旦 commit，OpenCode 用户永远 init 不出 plugin
- 当前全绿（test 473→478 含 opencode-plugin.test.ts / check-harness-consistency / tsc），因磁盘文件在；问题只在无源环境（fresh clone / CI）暴露

## Requirements

- **R1** 恢复源文件：确保 `templates/workbench/.opencode/plugins/jspace.ts` 进 git（当前磁盘已在，补 gitignore 例外后 `git add`）
- **R2** `.gitignore` 加例外：`!templates/workbench/.opencode/`（与 `.claude` 例外对齐，注释说明模板 plugin 是真实资产须 commit）
- **R3** gen-assets 源完整性 assert：写 `cli/manifest.generated.ts` 前，对比「旧 manifest 声明的路径 ⊆ 当前 walk 产物」；缺失 → `console.error` + `process.exit(1)`（防 silent decay——源文件被删但 generated 还含 stale）
- **R4** CI verify.yml：gen-assets freshness step 后加「manifest 声明的 path 在磁盘存在」检查（`jq -r '.files[].path'` 遍历 + `[ -f ]` 缺失即 error）
- **R5** 补测试：覆盖「gen-assets 遇到缺失源文件会 exit 1」的回归（可用临时缺失场景或脚本级断言）

## Acceptance Criteria

- [ ] AC1 `templates/workbench/.opencode/plugins/jspace.ts` 出现在 `git ls-files`
- [ ] AC2 `git status` 干净；`git add -A` 后 plugin 被跟踪（不再是 ignored）
- [ ] AC3 gen-assets 对「缺失源文件但旧 manifest 声明」场景 exit 1（模拟删除源 → 跑 gen-assets → 报错不静默）
- [ ] AC4 verify.yml 含 manifest path-exists 检查
- [ ] AC5 `bun run scripts/check-harness-consistency.ts` 全绿
- [ ] AC6 `bunx tsc --noEmit` + `bun test` 全绿
- [ ] AC7 编译二进制 init 出 plugin（回归，`./bin/jspace init /tmp/x` 后 `.opencode/plugins/jspace.ts` 存在）

## Out of Scope

- issue #6 附加项 1（opencode-plugin.test.ts spawn mock 的 4 处 implicit any）：P3 时已通过 types/opencode-plugin.d.ts 的 shim 解决（tsc 绿），不重复处理
- 真实 OpenCode 会话验证 binding（harness-opencode.md 的 best_effort 待办，独立事项）
- generated 文件 git rm --cached 重构（issue #6 Step 5 的选项 B，更大工程，另议）
