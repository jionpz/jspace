# cron 子系统收敛（P1×2 + P2×4）

## Goal

终结 legacy `cli/cron.ts`（无 tag 身份）与 tag-scoped `adapters/scheduler/*` 并存的过渡态（M5 遗留），恢复三平台 cron 的 idempotent no-op 契约与 doctor 健康检查正确性。

## Requirements

1. **Win32 `cron install` 修复（P1-CONFIRMED）**：消除 `args.join(" ")` → `op.content.split(" ")` 有损往返。`op.content` 携带结构化 argv（数组/JSON），`win32.apply` 直接消费；`/tr` 作为单参数正确传给 schtasks。回归：含空格路径下的 argv 往返不变形。
2. **doctor / 安装提示身份统一（P1-CONFIRMED）**：`doctor.ts` 与 cron add/remove 的 `isInstalled` 提示统一走 tag-scoped `adapter.inspect(workbenchTag(marker.workbench_id))`；删除 `cli/cron.ts` 中 legacy 无 tag 身份读取（`installedCronIds`/`plistExists`/`installedPlists`）。
3. **legacy plist 迁移（P1 连带）**：macOS 升级路径检测遗留无 tag plist（`com.jspace.cron.<id>.plist`），提示/自动迁移到 tag-scoped，避免双套 agent 双触发；`cron uninstall` 能清除 legacy 条目。
4. **linux inspect tag 下标修复（P2✅）**：`taskId.split(".")[2]` → 正确解析 tag（取 `[3]` 或剥前缀），恢复 tag 隔离与跨工作台互不覆盖。
5. **linux/win32 no-op 恢复（P2）**：inspect 返回真实 schedule/argv（linux 从 managed-block 解析；win32 若无法廉价解析则改 hash 比较），使 `cron install` 无变更时报告 up to date、不重写 crontab/不写备份。
6. **delete-only 地雷（P2）**：linux apply 从完整 desired set 重建块而非仅非 delete ops；全禁用时走 uninstall 语义而非 early-return 留旧任务。
7. **cron.json 原子写（P2✅）**：`saveCrons` 改用 `writeBytesAtomic`（对齐其余状态文件）。
8. **darwin env.home（P3）**：adapter 用注入 env.home 而非 `process.env.HOME`。
9. **'unknown' tag 防护（P3）**：marker 缺失时不再静默共享 `unknown` tag（fail 或 per-install 随机 tag）。
10. **层环修复（P1-CONFIRMED）**：`adapters/scheduler/*` 反向 import `application/automation/definitions.ts`（`parseSchedule`/`ScheduleDict`）→ 下沉到 `adapters/scheduler/schedule.ts`（纯解析，含 fail 是 adapters 既有反向边）；`definitions.ts` 改从 adapters 导入并 re-export（cli/cron.ts、registry.ts、cli/cron.test.ts 不破）。消除 application↔adapters 双向依赖。

## Acceptance Criteria

- [ ] Win32：新增含空格路径的 schtasksArgs 往返测试；`cron install` 的 argv 经 apply 后 `/tr` 完整（纯函数级 + dry-run）。
- [ ] macOS/Linux：doctor 对已安装 cron 无误报（`not_installed`/`stale_task` 判定走 tag-scoped inspect）；legacy plist 迁移测试。
- [ ] 三平台 `cron install` 连续两次幂等（第二次无 ops / 报告 up to date）；linux 双工作台互不覆盖（tag 隔离测试）。
- [ ] delete-only 场景：禁用全部 cron → 清空已装任务而非残留/误删启用项。
- [ ] `saveCrons` 原子写测试（注入失败不产生截断文件）。
- [ ] 全量 `bun test` + `tsc --noEmit` 绿；涉及模板改动则 gen-assets gate 绿。
- [ ] 不破坏 ownership 三态：upgrade 不复活已删 cron、不覆盖 user 态 cron.json。
- [ ] 无 `adapters/scheduler → application` 反向 import（grep 核验）；`application/automation/scheduler.ts` 的 workbenchTag re-export 保留（app→adapters 为允许方向）。

## Notes

- 此任务为复杂任务：需 `design.md` + `implement.md` 后再 start。
- 与 fix-test-coverage 有边界：本任务聚焦代码修复；补测可在本任务内顺带（针对性回归），大面补测归 fix-test-coverage。
