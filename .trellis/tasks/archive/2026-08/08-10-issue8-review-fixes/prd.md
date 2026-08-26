# Issue #8: main 分支五专家 Review 修复（Round 7）

## Goal

处理 GitHub issue #8（五专家 Review，review commit `4ed76d0`，2026-08-10）的全部 finding：P0×1（#1）、P1×9（#2–#10）、P2×8（#11–#18）、P3×12（#19–#30）。按报告「修复顺序建议」分批，每批独立可验证。

**对齐**：AGENTS.md（开发模式 + 分层 `core → application → adapters → scripts`）+ GOAL.md（四大支柱：路由/记忆/资产/定时）。本批主要落在「定时」（scheduler）、安全红线（进程/文件边界）、SSOT（能力单一事实源）。

## Source Requirements（issue #8 全量）

### P0（必须立即修复）
- **#1** Win32 cron 任务名错位：`buildContent`（`adapters/scheduler/win32.ts:120-125`）用 POSIX 点形式 `taskIdFor` 作 schtasks `/tn`，而 `identity()`/`inspect()`/`uninstallAll()` 约定 `JSpaceCron_<tag>_<id>`。测试手搓参数绕过 `buildContent`。→ 每次 install 永远 create、uninstall 删不掉、孤儿任务继续跑。

### P1（高优先级）
- **#2** `domain/resource add --tag` 无 `dest` 被静默吞掉（`cli/commands/domain.ts:20,28`、`cli/commands/resource.ts:23,42`），exit 0 且 tags 永远空。
- **#3** Windows `.cmd` 无头执行不转义 cmd 元字符（`adapters/process/spawn.ts:37-45`），prompt 注入 `& | > < ^ %` → RCE。
- **#4** `ingest complete` 可删除任意源文件（`application/ingest/use-cases.ts:40-55`、`journal.ts:258-261`），不限制 inbox 边界，相对路径按当时 cwd unlink。
- **#5** spawn 超时只 SIGTERM，忽略信号则永久挂起 + 锁被偷双跑（`adapters/process/spawn.ts:75-91`）；`timedOut` 是墙钟比较（`spawn.ts:90`）。
- **#6** inbox-tidy 批次守卫默认方向写反：`isFile(batchLog)` 为假时 `batchChanged` 保持 `true` 假成功（`application/automation/execute.ts:232-241`）。
- **#7** `acquireLock` 把写锁失败当 EEXIST，留 0 字节毒锁全员 skip 1h（`application/automation/lock.ts:40-65`）。
- **#8** `pending apply` 的 `realGbrain` 裸 `spawnSync` 无超时无上限（`application/pending/apply.ts:80-93`），OpenCode idle hook 可永久卡住。
- **#9** skills/harness 命令吞异常且 exit 0（`cli/commands/skills.ts:49-57`、`harness.ts:58-61`），业务失败进 stdout 而非 errors。
- **#10** `type: filehub` 单例不变量只在 `filehub init`，`resource add --type filehub` 可登记第二个（`core/contracts/hub.ts`、`application/registry/resource.ts` 等），primary/inspect/ingest/pending 静默取第一个。

### P2（中优先级）
- **#11** Win32 周日 `dow=7` 与 inspect 回读 `0` 不收敛（`adapters/scheduler/win32.ts:58-79`）。
- **#12** Linux crontab 特殊字符 round-trip 不收敛 + `\n` 换行注入（`adapters/scheduler/linux.ts:25-49,139-149`）。
- **#13** `domain add` 写 hub 失败不回滚骨架目录（`application/registry/domain.ts:130-138`）。
- **#14** doctor 休眠域扫描绕过 hub 的自定义 `d.path`（`application/diagnostics/doctor.ts:421-443`）。
- **#15** `--rollback` 的 `id`/`rel` 无路径约束可逃逸（`application/workspace/workspace.ts:115-158`、`core/contracts/upgrade.ts:60-67`）。
- **#16** gbrain 接线 Claude 特例，记忆支柱对多 harness 未闭合（`application/gbrain/wiring.ts`、`cli/commands/harness.ts:83-111`）。
- **#17** `gen-assets` 引导环：生成器 import 自己产出的 generated（`scripts/gen-assets.ts:8,162-177` → `application/workspace/manifest.ts` → `adapters/harness/registry.ts`）。
- **#18** 文档三角漂移 18a–18h（harnesses.md 非生成 / binding 迁移 / registry.md 未来式 / 未上线文案 / harness-config 4 家 / README 漏 .cursor hooks / pending 路径 / harness wire 通用性）。

### P3（低优先级 / 打磨）
- **#19** 原子写无 fsync + tmp 孤儿（`adapters/fs/workbench-state.ts`）。
- **#20** crontab `%` 转义（并入 #12）。
- **#21** `failIngest` 先删 staged 再写 journal（`ingest/journal.ts:302-313`）。
- **#22** doctor 人话模式 info 只计数不打印 + bin_missing 误报（`doctor.ts:543-551`）。
- **#23** 空列表 stdout 全空（`domain/resource/project list`）。
- **#24** 错误前缀双层 + decode code 漏人话。
- **#25** Windows 默认 PATH 烘焙 POSIX + launchd 文案误导 + crontab marker 与实现不一致。
- **#26** `HubV4` 命名 vs `schema_version: 1` 漂移。
- **#27** `__DEV_ROOT__` 死代码。
- **#28** import-boundary 测网窄。
- **#29** SSOT 停在「对照表」而非「生成式」。
- **#30** `domain.json` 与 hub.domain 双份 tags 分叉。

### 已验收不改（安全专家结论，摘录）
Linux crontab POSIX 引用、Darwin plist xmlEscape、POSIX/Win `.exe` spawn argv 数组、hook 种子固定命令无 eval、域/项目相对路径 portabilityIssues、office-extract 只读不落盘、凭据不进仓库。

## Task Map（父 → 子）

| 子任务 | 覆盖 finding | 主题 |
|---|---|---|
| `08-10-issue8-p0-win32-cron` | #1 | P0: Win32 cron 任务名错位 |
| `08-10-issue8-p1-cli-args` | #2, #9 | P1: CLI 参数 dest + 退出码语义 |
| `08-10-issue8-p1-scheduler-reliability` | #5, #6, #7 | P1: 调度可靠性三件套（双跑/假成功/毒锁） |
| `08-10-issue8-p1-security-paths` | #3, #4, #12, #15 | P1: 安全路径（cmd 注入/ingest 越界/crontab 注入/rollback 逃逸） |
| `08-10-issue8-p1-pending-gbrain` | #8 | P1: pending realGbrain 下沉 adapter |
| `08-10-issue8-p2-contracts-doctor` | #10, #11, #13, #14, #16, #17 | P2: 契约/架构/doctor 对齐 |
| `08-10-issue8-p3-docs-polish` | #18, #19–#30 | P3: 文档漂移 + 打磨 |

顺序依赖（写入各子任务 prd.md / implement.md）：
- p0-win32-cron 先行（P0，其它批不依赖它，但按报告修复顺序 #1 第一）。
- p1-scheduler-reliability 与 p1-security-paths 独立，可并行规划。
- p1-pending-gbrain 若引入 `adapters/gbrain/` 新端口，先确认不被其它批改动影响。
- p2-contracts-doctor 涉及 hub 契约（decodeHub），若改动 `core/contracts/hub.ts` 需同步 p3-docs-polish 的文档 (#18b registry.md/binding)。
- p3-docs-polish 放最后，吸收前面所有批的文档同步。

## Cross-Child Acceptance Criteria

- [x] `bunx tsc --noEmit` 0 错误、`bun test` 535/535 全绿（每批收尾时）。
- [x] 每批对报告「测试盲区清单」的对应不变量补回归测（#1 buildContent /tn、#6 batch-stale、#5 SIGKILL、#7 非 EEXIST、#12 round-trip、#3 cmd 元字符、#4 inbox 边界、#15 rollback 逃逸、#2 parse→hub、#9 退出码、#11 dow round-trip、#13 回滚）。
- [x] 安全 finding（#3/#4/#12/#15）测试含恶意输入用例（`hello&calc`、`../../../`、换行、`'`/`%` 路径）。
- [x] `scripts/check-harness-consistency.ts` + `scripts/check-manifest-integrity.ts` + `scripts/check-skills.ts` 全绿（含 gen-assets 新鲜度、`bun run build` 成功）。
- [x] 改 `templates/workbench/` 或 `skills/` 后重跑 `scripts/gen-assets.ts` + `bun run build`（资产嵌入同步）。
- [x] 每批提交信息标注 issue #8 对应 finding。
- [x] 集成复核完成：tsc 0 错、bun test 535/535、三一致性脚本全绿、gen-assets fresh。

## Completion Summary（2026-08-10，7 批 20 commits）

| 批次 | finding | commits |
|---|---|---|
| p0-win32-cron | #1 | 8992ec3 + 1d730e2 |
| p1-cli-args | #2 #9 | 9018d79 + 510bf1c |
| p1-scheduler-reliability | #5 #6 #7 | 45bb442 + 723dad1 |
| p1-security-paths | #3 #4 #12 #15 | 5c39ed4 + d6adff0 |
| p1-pending-gbrain | #8 | c9f683f + 399023c |
| p2-contracts-doctor | #10 #11 #13 #14 #16 #17 | 19ce623 + e16b34d + b9eb378 |
| p3-docs-polish | #18 #19 #22 #23 #24 #26 #27（#20 随 #12 闭合；#21 #25 #28 #29 #30 延后） | ccb8ad5 + 46db157 + 6f2262e |

**延后项**（Notes 已记录）：#16 harness wire 代码统一、#21 failIngest 顺序、#25 Windows PATH/launchd/marker、#28 import-boundary、#29 SSOT 生成式、#30 domain.json tags。

## Key Decisions

1. **分批粒度**按报告「修复顺序建议」7 步 + 吸收未列项（#9 并入 cli-args、#11 并入 contracts、#12/#15 并入 security-paths、#13/#17 并入 contracts）。
2. **测试跑在 ubuntu-latest**：win32/linux scheduler 回归一律纯单元测试（不真调 schtasks/crontab）；「install → inspect → uninstall」Windows 真机冒烟留待本地 Windows 环境，不进 CI。
3. **不改 capabilities.yaml 结构**除非 #16/#29 批明确需要；`mcp_config` 扩展按 #16 单独决策。
4. 每批 `task.py start` 前先补齐该子任务的 prd/design/implement（复杂任务），轻量子任务可 PRD-only。
