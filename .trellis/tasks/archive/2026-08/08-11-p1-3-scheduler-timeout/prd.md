# #9-04 [P1-3] 调度器外部命令统一 timeout

## Goal

调度器三平台外部命令统一经 timeout 保护（gbrain 同款红线），不允许裸阻塞 spawnSync。

## Requirements

- 文件：`adapters/scheduler/linux.ts`（crontab/sh）、`win32.ts`（schtasks）、`darwin.ts`（plutil/launchctl）。
- 复用 `adapters/process/spawn.ts` 或 spawnSync timeout 选项；不引入第三套进程封装。

## Acceptance Criteria

- [ ] scheduler.test.ts / 各平台测试断言 timeout 值透传。
- [ ] 不引入真实调度器调用（仍为 stub/注入）。
- [ ] 全部外部命令调用点均有 timeout。
