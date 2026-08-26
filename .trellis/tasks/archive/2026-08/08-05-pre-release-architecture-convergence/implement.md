# 发布前架构收敛：执行计划

## 0. Start Gate

- [ ] 用户明确批准最新 planning summary。
- [ ] 运行 `task.py start`，确认 task 为 `in_progress`。
- [ ] 加载 `trellis-before-dev` 及 backend directory/quality/error/logging guidelines。
- [ ] 记录实现前 `git status`、测试基线和当前 scheduler characterization。

## 1. P0 Scheduler Convergence

- [x] 先增加 Linux 两工作台 install/update/uninstall characterization tests，证明当前全局 block 缺陷。
- [x] 将 Linux markers、replace 和 uninstall 改为 tag-scoped；覆盖 duplicate、stray、unterminated、legacy marker。
- [x] 为 SchedulerAdapter 建立 canonical identity contract，消除 CLI 与 Windows adapter 的 task name 双重拼接。
- [x] 将 desired task/content compilation 下沉到 scheduler service；Linux whole-block batching 离开 CLI handler。
- [x] 增加 Darwin/Linux/Windows create -> no-op -> update -> delete convergence tests。
- [x] 运行 scheduler 定向 tests、`bunx tsc --noEmit` 和完整 `bun test`。

> P0 done: 482b3ca (linux tag-scoped) + 842372a (identity + service) + 1f6da6f (darwin convergence). 314 pass / tsc / skills 全绿 / CLI dry-run smoke 验证 tag-scoped identity。

Rollback point：P0 应能独立提交和回退，不依赖 machine-state 或 CLI 文件拆分。

## 2. P1 Machine-State Contracts

- [x] 搜索现有 decoder、diagnostic、atomic-write 实现，选定唯一复用模式。
- [x] 新增 RunRecordV1、IncidentV1、MaterializedJournalV1、UpgradeJournalV1 contracts 与 fixtures。
- [x] 替换 ad hoc casts；区分 missing、invalid、unsupported version。
- [x] 调整 run/incident collection API，使损坏记录 diagnostics 可达 status/doctor 或调用方。
- [x] 将 materialized/upgrade journal 写入切换为 atomic helper。
- [x] 增加 truncated JSON、unknown field、unsupported version、write/rename failure tests。
- [x] 运行相关 tests、typecheck 和完整测试。

> P1-state done: 1c2cd08。readJsonRecords → {records, issues};materialized/upgrade fail-loud;写 path 切 writeBytesAtomic。

Rollback point：decoder 与 reader 改动成组提交，禁止只提交 schema 而保留旧读取路径。

## 3. P1 Dependency Boundary

- [x] 用 `rg` 生成 core/application/adapters/cli production import baseline。
- [x] 确认 `application/errors.ts`、`application/fs.ts`、schedule parser 的真实消费者后移动到最小 shared boundary。
- [x] 更新引用和 spec 中的准确依赖图。
- [x] 增加 import-boundary script/test，纳入现有 verify gate。
- [x] 运行 typecheck、完整测试和 skill/generated freshness。

> P1-boundary done: ab453a8。shared 落点定 `core/shared/{errors,fs,schedule}`;import-boundary.test.ts 随 bun test 执行;spec 依赖图更新。

Rollback point：每次只移动一类 shared primitive，避免一次性目录重排。

## 4. P2 Maintainability

- [x] 按 command family 拆分 `cli/commands/registry.ts`，保持命令注册顺序与 help 输出。(7fea986)
- [x] 删除经 production-reference 搜索确认无消费者的 facade。(cli/registry.ts 零消费者,已删)
- [x] executor 使用 exclusive lock + ownership token + `try/finally`；优化 chunk accounting。(acquireLock + win32SpawnTarget)
- [x] 增加 Windows `.cmd/.bat` argv builder 与 runner 测试。
- [x] 调查 Project archived 状态的真实调用；有明确产品需求才新增命令，否则记录 deferred decision。
- [x] 统一 Windows x64 build target，并同步 CI、build script 和平台文档。

> **Deferred decision (Project archived)**: `Project.status` 契约值 `archived`(hub.ts)无任何生产消费者 —— `project add` 恒为 `active`,无命令设置,无逻辑读取.不新增 `project archive` 命令(无产品需求),保留契约枚举值作为前向兼容;若未来需要归档生命周期,单独开任务。

> **Windows x64 target 权威选择**: 非 baseline `bun-windows-x64`(CI 上 baseline runtime 下载被阻断,release 产物即此 target)。build-all.ts / package.json build:win / CI 矩阵 / PLATFORMS.md 已统一。

Rollback point：CLI 拆分、executor、build target 分开提交和验证。

## 5. Final Verification

- [x] `bunx tsc --noEmit`
- [x] `bun test`
- [x] `bun run scripts/check-skills.ts`
- [x] 运行 generated asset freshness gate，确认无未生成漂移。
- [x] 在唯一临时目录执行 init -> doctor -> domain/resource registry -> filehub -> project -> cron dry-run/check -> workspace diff/upgrade -> doctor 全链 smoke。
- [x] 在 CI 平台矩阵验证 Windows scheduler argv/identity 与 Windows x64 build target。(test job 已入 CI 矩阵;Windows 真机 schtasks/cmd.exe round-trip 触发时验证)
- [x] review `git diff`，确认无密钥、用户 home 状态、真实 scheduler 修改或无关格式化。
- [x] 对照 PRD AC1-AC11 逐项记录证据。

### AC1-AC11 证据

| AC | 证据 |
|----|------|
| AC1 Linux 双工作台 block 共存/更新/卸载隔离 | `scheduler.test.ts` two-workbench installs coexist / B uninstall preserves A / linux full convergence(482b3ca) |
| AC2 Windows create→no-op→update→delete 无 create+delete | `scheduler.test.ts` win32 reconciliation converges(842372a) |
| AC3 三平台 desired/inspect/apply identity 契约 | identity single source + darwin/win32 convergence + parseManagedLine/plistPath/schtasksArgs(842372a,1f6da6f) |
| AC4 四类 machine truth versioned decoder | `core/contracts/state.test.ts` valid/invalid/unknown/version + truncated(1c2cd08) |
| AC5 fail-loud + diagnostics + atomic | `journal.test.ts`(materialized/upgrade fail-loud + atomic round-trip)、`state.test.ts`(damaged→issues)、`status.test.ts`(damaged_state 展示)(1c2cd08) |
| AC6 自动边界 gate | `import-boundary.test.ts` 随 bun test 执行,adapters!→application 等全部覆盖且通过(ab453a8) |
| AC7 cron handler 不再编译平台内容 + 命令拆分无回归 | scheduler-service 拥有 buildDesired(842372a);help smoke 逐条一致(7fea986) |
| AC8 executor lock/清理/输出上限/Windows argv | `lock.test.ts` 5 例 + `execute.test.ts` 失败后 lock 释放 + `win32-spawn.test.ts` 4 例(bc0d42a) |
| AC9 Windows x64 target 单一权威 | package.json build:win / build-all.ts / CI 矩阵 / PLATFORMS.md 全为 `bun-windows-x64`(bc0d42a) |
| AC10 全门 + 全链 smoke | tsc/339 test/check-skills/gen-assets fresh + 临时工作台全链 smoke 通过 |
| AC11 GOAL.md 非目标 | 未引入 daemon/事件网关/自研执行器/同步/插件框架;全部改动在既有分层内 |

R5 CI 测试:test job(31cec64)在 CI 跑 tsc + bun test(含双工作台收敛 + win32 identity 收敛 + 契约 decoder + boundary gate)+ check-skills。

## 6. Finish Gate

- [x] 运行 `trellis-check` 做 spec、边界、测试和跨层数据流审查。(类型重复收敛 87261c5 + spec 同步)
- [x] 使用 `trellis-update-spec` 写回新形成的 scheduler identity、machine truth 和 dependency boundary 约定。(directory-structure/error-handling/quality-guidelines)
- [x] 提交前再次 review diff 并运行最终质量门。(339 pass / tsc / skills / gen-assets fresh)
- [ ] 按 Trellis Phase 3 完成 commit、session journal 和归档。
