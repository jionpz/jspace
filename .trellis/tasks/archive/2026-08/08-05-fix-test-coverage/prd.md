# 零覆盖补测（doctor/cron 用例/filehub/darwin/handler）

## Goal

补齐评审（维度 4）发现的零覆盖用户可见面，使最重缺陷（win32 argv、身份漂移）回归不再裸奔。

## Requirements

1. **doctorWorkbench 测试**：`application/workspace/doctor.ts` 全分支 —— 注入 `CronHealthDeps` 桩（loadCrons/parseSchedule/installedCronIds/linuxCronHealth）+ 临时 workbench + 桩 filehub；断言诊断 code 与严重度（`filehub.inbox_unfiled` / `cron.not_installed` / `cron.stale_task` / `cron.open_incidents`）。
2. **cron 管理用例测试**：`application/automation/use-cases.ts` 的 `cronAdd/cronList/cronRemove/cronSetEnabled/cronAck/cronInstall` —— 临时 workbench cron.json + 桩 `CronInstallDeps`；断言持久化与安装结果行、dry-run 不 apply。
3. **filehubInit 测试**：`application/registry/filehub.ts:101` —— skeleton 幂等、README 仅缺失时写、--dry-run 不写、register 补偿（注入失败 writeHubAndLocal → 断言 domain skeleton 回滚）。
4. **darwin adapter 测试**：`adapters/scheduler/darwin.ts` —— parsePlistName 往返/异常、plistPath 组合、inspect/uninstallAll 的 tag 过滤（纯函数化提取后测试）。
5. **handler 端到端接线测试**：`cli/commands/registry.ts` 高危命令家族走 `parse(argv).spec.handler` 路径（cron add/install、ingest advance、pending apply、upgrade），仿 `project.test.ts` 模式。

## Acceptance Criteria

- [ ] 5 块各有新测试文件/测试块，覆盖上述关键分支。
- [ ] 新测试全部通过，且不改被测源码行为（仅当被测代码有可测性阻碍时允许最小重构，如提取纯函数）。
- [ ] 全量 `bun test` + `tsc --noEmit` 绿。
- [ ] 至少一条新测试能捕获既有缺陷（如 win32 往返或 doctor 误报）——若在 cron 收敛任务之后执行，则对应测试随修复写入。

## Notes

- 轻量到中型任务：PRD 可为唯一产物；若测试需要为可测性重构（提取纯函数），则补 design 说明重构边界。
- 与 fix-cron-convergence 依赖顺序：若先做收敛，本任务补测即为该修复提供回归护栏；若并行，注意 cli/cron.ts 身份读取可能被收敛删除。
