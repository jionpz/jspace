# #9-05 [P1-4] Windows cron add 前置校验

## Goal

Windows 上 `cron add` 与 `install` 一样显式拒绝不可安装调度，消除 PLATFORMS.md 超卖。

## Requirements

- 文件：`application/automation/use-cases.ts`（cronAdd）。
- 加 isWindowsInstallable 前置校验（与 install 同款）；保留既有 id/重复/prompt 等校验顺序。

## Acceptance Criteria

- [ ] use-cases.test.ts 增补 Windows-only 用例（stub 下模拟）：拒绝 + 错误信息含 isWindowsInstallable 提示。
- [ ] 非 Windows 行为不变。
