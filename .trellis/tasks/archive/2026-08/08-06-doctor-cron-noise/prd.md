# doctor 噪音：新工作台 init 后 0 warning

## Goal

新工作台 init 完第一次 `jspace doctor` 就有 4 条 warning（3 cron 未安装 + filehub 未注册）。这些是「可选能力未配置」而非健康问题。方案（用户 2026-08-06 决策，双管齐下）：模板预设 cron 默认 `enabled: false`，doctor 对「enabled 但未安装」保持 warning（显式启用却未装 = 问题）；`filehub.unregistered` 降为 info。目标：全新 init 的工作台 doctor 输出 0 warning。

## Requirements

- 模板 `templates/workbench/.jspace/cron.json` 三个预设 cron（inbox-tidy / weekly-report / memory-consolidate）`enabled` 从 `true` 改为 `false`。用户显式启用后 doctor 才可能报未安装。
- `core/contracts/diagnostics.ts` 的 `Severity` 类型扩展为 `"error" | "warning" | "info"`。
- `application/workspace/doctor.ts` 中 `filehub.unregistered`（未注册 filehub 资源）从 `warning` 降为 `info`。其余 filehub 诊断（inbox_missing / inbox_unfiled / pending_applies）保持 warning 不变。
- doctor 汇总与过滤：info 不计入 warning 数、不触发 exit 1；汇总行 `X error(s), Y warning(s)` 可加 info 数；`--json` 输出的 diagnostics 保留 info 条目（含 severity）。
- `cli/main.ts` 的 error/warning 打印逻辑兼容 info（不把 info 当 error/warning 打，或按需单独呈现）。
- doctor 对「enabled 但未安装」的 `cron.not_installed` **保持 warning**（用户决策：模板关掉后，只有用户显式启用的 cron 才会触发，属于意图未兑现）。
- 更新 `application/workspace/doctor.test.ts` 受影响的断言；新增/调整测试覆盖：默认模板（cron disabled）不报 not_installed、filehub.unregistered severity=info。

## Acceptance Criteria

- [ ] `templates/workbench/.jspace/cron.json` 三个 cron 均为 `enabled: false`。
- [ ] `Severity` 类型含 `"info"`；`tsc` 通过。
- [ ] `jspace init <fresh-dir>` 后 `jspace doctor --dir <fresh-dir>` 汇总为 `0 error(s), 0 warning(s)`。
- [ ] `jspace doctor --dir <fresh-dir> --json` 的 diagnostics 含 `filehub.unregistered` 且 `severity: "info"`，不含 `cron.not_installed`。
- [ ] 构造 enabled 但未安装的 cron 时，doctor 仍报 `cron.not_installed` warning（保持现有语义，doctor.test.ts:65 用例仍通过）。
- [ ] info 诊断不改变 doctor 的 exit code（无 error 时仍 exit 0）。
- [ ] `bun test application/workspace/doctor.test.ts application/workspace/manifest.test.ts application/workspace/workspace.test.ts` 全绿（模板变更波及的测试同步更新）。
- [ ] 重新 `bun run scripts/gen-assets.ts` 同步编译产物嵌入式资产（模板改后必须，memory: jspace-cli-assets-regeneration）。

## Notes

- 子任务标题「未安装 cron 降级为 info」是探索初稿，最终决策为「模板 enabled:false + 保持 warning」双管齐下，语义更严谨：未安装且未启用 = 正常；未安装但显式启用 = 问题。filehub 才是降 info 的那个。
- `jspace cron check`（hook 路径）与 doctor 独立，本任务不改 cron check 的报法。
- 仓库 PUBLIC：示例/文档中性占位。
