# Round8 review 后续 — isWindowsInstallable 上移 core + 存量 slug 止血

## Goal

处理 Round 8 review 的两项遗留：①P2 架构债——`isWindowsInstallable` 从 `adapters/scheduler/win32.ts` 上移到 `core/shared/schedule.ts`，消除 application→adapters 运行时反向依赖；②本机存量工作台止血——`~/jspace-work/.jspace/cron.json` 的 workbench-retro 输入 `memory/retro` 改 `records/retro`，防周日无头 retro 写脏 slug。

## Requirements

1. **代码（架构债）**：`isWindowsInstallable` 是纯 schedule 逻辑（只依赖 `parseSchedule`），应放 `core/shared/schedule.ts`（与 `parseSchedule` 同级，该文件头注释已声明 shared kernel 就是为了避免 application↔adapters 环）。
   - `win32.ts` 删除本地定义，`schtasksArgs` 改用 core import。
   - `use-cases.ts`（#9-05 引入的反向依赖）改 import core。
   - `scheduler.test.ts` 的 import 改 core。
2. **本机（存量止血）**：`~/jspace-work/.jspace/cron.json` workbench-retro 条目 input 内 `memory/retro/<YYYY-MM-DD>` → `records/retro/<YYYY-MM-DD>`（cron.json 是 user 数据，upgrade 不覆盖，须手动改）。

## Acceptance Criteria

- [ ] 全仓无 `adapters/scheduler/win32.ts` 对 `isWindowsInstallable` 的定义/导出；`use-cases.ts` 无 application→adapters 运行时 import。
- [ ] `bunx tsc --noEmit` 绿；`bun test` 全绿（isWindowsInstallable 相关用例仍通过）。
- [ ] 本机 `~/jspace-work/.jspace/cron.json` 无 `memory/retro` 残留，`jq` 抽查 workbench-retro input 为 `records/retro`。

## Notes

- 本机 cron.json 改动在仓库外，不入 git；作为一次性工作台操作直接执行。
- 不改调度器 timeout（#9-04 已闭环）；不做 doctor 检查（避免范围蔓延，可下轮）。
