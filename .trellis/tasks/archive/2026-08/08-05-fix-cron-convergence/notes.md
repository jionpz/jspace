# Notes · cron 子系统收敛

## 完成（2026-08-05，提交 `b131638`，10 改 + 3 新）

**层环（P1）**：`parseSchedule`/`ScheduleDict` 下沉 `adapters/scheduler/schedule.ts`；adapters/scheduler 不再反向 import application（grep 核验仅剩 `fail` 文档化边）。`definitions.ts` 从 adapters 导入 + re-export，cli/cron.ts、registry.ts、cli/cron.test.ts 均不破。

**win32 argv（P1）**：content 改 `JSON.stringify(args)`，`win32.apply` 用 `parseOpContent`（JSON.parse）——消除 `join(' ')`/`split(' ')` 对 `/tr` 的构造性损坏。

**doctor/提示（P1）**：新建 `cli/scheduler.ts`（schedulerEnv/workbenchTagFor/installedCronIdsForRoot/cronIsInstalledForRoot）；doctor 的 cronDeps 与 cron add/remove 提示改走 tag-scoped adapter.inspect；删 cli/cron.ts legacy 无 tag 身份读取（installedCronIds/plistExists/installedPlists/shortHash/plistPath）；marker 缺失时 install fail（不再共享 'unknown' tag）、doctor 返回 [] 不崩；doctor stale 消息去 `com.jspace.cron.` 硬编码。

**linux（P2）**：修 `taskId.split(".")[2]` 恒取 "cron" 的 tag 解析 bug（`parseManagedLine` 正确取 tag）；从 crontab 行解析真实 schedule/argv 恢复 no-op；apply 从完整 desired 重建（delete-only 不再误清启用 cron）；`cronInstall` 删全禁用 early-return → 全禁用卸载已装任务（**行为变化**）。

**win32（P2）**：`parseSchtasksXml` 解析真实 schedule/argv（DAILY/WEEKLY + 含空格 root）；纯函数 fixture 测过，**真实 schtasks 集成需 Windows 真机回归**。

**darwin（P3）**：`plistPath`/`listPlists`/`plistSchedule`/`plistArgv` 改穿注入 `env.home`。

**cron.json 原子写（P2）**：`saveCrons` → `writeBytesAtomic`。

**补测**：8 个新测试（win32 JSON 往返 / parseSchtasksXml / linux parseManagedLine / darwin plistPath·parsePlistName / cronInstall reconcile 全禁用·create·up-to-date·dry-run）。

## 验证

- `bunx tsc --noEmit` 绿；`bun test` 275 pass（+8）。
- gen-assets 确定性 gate 绿；git 工作树干净。
- darwin 冒烟：`cron install --dry-run` tag 正确派生（1ku4td5）+ 产出 create op + 不崩。

## 遗留（转交/标注）

- **win32 真机回归**：schtasks `/query /xml` 集成需在真实 Windows 验证（CI 仅 ubuntu；解析器已 fixture 测）。
- legacy 无 tag plist 迁移：不做自动删除（避免误删）；doctor 已不误报 + uninstall 只清 tag-scoped。若本机存在旧 `com.jspace.cron.<id>.plist`，用户可手动清理。
- `linuxCronHealth` 与 `linuxAdapter.health()` 重复（P3 清理）归后续。
- 全禁用卸载行为变化已入 commit message。
