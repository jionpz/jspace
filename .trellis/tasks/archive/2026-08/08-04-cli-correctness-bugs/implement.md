# Implement — CLI 正确性 bug:cron split-brain + 二进制 contentHash

> 有序执行清单。对齐 `design.md`。可直接 break,无迁移通道。每阶段有验证 + review gate。

## 执行顺序总览

**先修 Bug B(小、独立、低风险)→ 再修 Bug A(大、需 adapter 下沉)→ 补测试 → 集成验证**。Bug B 先落地隔离风险,再动 cron 大重构。

---

## Stage 0 — 基线快照(rollback point)
- [ ] `git status` 干净;记录 commit hash。
- [ ] `bunx tsc --noEmit` + `bun test` 全绿(改动前对照)。
- [ ] `git log --oneline -3` 确认 HEAD。

**Gate**:基线绿。任何阶段失败可 `git checkout -- cli/ application/ adapters/ core/` 回此点。

---

## Stage 1 — Bug B:二进制 contentHash(R2)
- [ ] `application/ingest/journal.ts` 的 `beginIngest` 改字节级哈希:
  - 新增 `sha256File(p)`(流式 readSync,65536 块),见 design §4。
  - `contentHash = sha256File(plan.source)` 替换 `sha256Of(readFileSync(plan.source,"utf-8"))`。
  - 确认 import:`createHash`/`openSync`/`readSync`/`closeSync` 从 node:fs/node:crypto。
- [ ] 测试:新增 fixture(PDF + XLSX 各一,合成字节)→ 断言 `contentHash == shasum -a 256 <file>`。
- [ ] 验证:`bunx tsc --noEmit` + `bun test`。

**Gate**:字节哈希正确(fixture 断言过);无行为回归。

---

## Stage 2 — 抽 cron adapter(R1 前置)
- [ ] 建 `adapters/scheduler/`;把 `cli/cron.ts` 的 backend 逻辑搬到三平台文件:
  - `darwin.ts`:`plistPath`/`plistExists`/`installedPlists`(带 tag 过滤)/`installDarwinCrons`/`uninstallDarwin`
  - `linux.ts`:`crontabBlock`/`replaceManagedBlock`/`installLinuxCrons`/`uninstallLinux`
  - `win32.ts`:`schtasksArgs`/`isWindowsInstallable`/`installWindowsCrons`/`uninstallWindows`
  - `index.ts`:按平台导出 `SchedulerAdapter`(inspect/apply/health)
- [ ] taskId 统一:`plistPath(id, tag)` → `com.jspace.cron.<tag>.<id>`;crontab block 注释含 taskId;schtasks 任务名含 tag。删除 `shortHash`。
- [ ] `cli/cron.ts` 删除被搬走的 backend,只留被别处引用的纯函数(`installedPlists`/`crontabBlock` 等的 re-export 或直接改引用点)。
- [ ] 验证:`bunx tsc --noEmit`;`cli/cron.test.ts` 的纯函数测试迁移到 `adapters/scheduler/*.test.ts` 并跑绿。

**Gate**:adapter 纯函数全绿;taskId 三平台统一含 tag。

---

## Stage 3 — 接新引擎,删 legacy(R1 收敛)
- [ ] `registry.ts` cron install 分支:dry-run 与真实 install **统一走 `cronInstall()`**;真实路径注入 `inspect/apply`(从 adapter 取)+ `validateSkillTargets`(同 dry-run)。
- [ ] dry-run 的 `taskId` 改为 `com.jspace.cron.${tag}.${c.id}`(与 adapter 一致)。
- [ ] 删除 `cmdCronInstall`/`cmdCronUninstall`;`cronUninstallSpec` 改为调新引擎(uninstall = 清本 tag 全任务)。
- [ ] `cmdCronStatus`/`cmdCronFailures` 若依赖 legacy 内部,改为读新结构化 runs/incident。

**Gate**:`cron install`(真实)+ `cron install --dry-run` 走同一引擎;dry-run 预览不再「全 create+全 delete」;无 legacy 引用残留(grep `cmdCronInstall` 为空)。

---

## Stage 4 — execute.ts 注入式单测(R3)
- [ ] `application/automation/execute.ts` 用 `ExecuteDeps` 补测试:
  - timeout 分支 / `todaySuccess` 跳过 / 锁 stale/占用 / suspect(exit 0 无输出)/ batch-stale
- [ ] spawn 包一层注入 stub(便于 fake harness 进程)。
- [ ] 验证:`bun test application/automation/execute.test.ts` 全绿。

**Gate**:execute 关键路径有覆盖(诊断盲区闭合)。

---

## Stage 5 — 跨工作台 + 校验门(AC1/AC2)
- [ ] 测试:两个 tag 的 `installed` 任务并存,`inspect(tag)` 只回本 tag;`planReconciliation` 不删别 tag 任务。
- [ ] 验证真实 install 走 `validateSkillTargets`(注入 spy 断言调用)。

**Gate**:跨工作台不互覆(AC1);校验门一致(AC2)。

---

## Stage 6 — 集成验证(AC5/AC6)
- [ ] `bunx tsc --noEmit` + 全量 `bun test` 全绿。
- [ ] `jspace cron install --dry-run` 在临时工作台跑通,预览与真实计划一致。
- [ ] (可做)真实 launchd 冒烟:`cron install` 装一个临时 cron → `ls ~/Library/LaunchAgents/com.jspace.cron.*` 确认 tag 化 → `cron uninstall` 清理。
- [ ] 提交(Phase 3.4,commit message 带任务 slug)。

**Gate(最终)**:AC1–AC6 逐条勾。AC1(跨工作台不互覆)与 AC2(校验门)是核心可证伪项。

---

## Rollback points
- Stage 0 是总回滚点(`git checkout -- cli/ application/ adapters/ core/`)。
- 每 Stage 独立可回退;Stage 2 发现 adapter 设计缺陷回 design 修(Phase 回滚,不硬推)。

## 验证命令速查
```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts cron install --dry-run --dir /tmp/jspace-cron-smoke
grep -rn "cmdCronInstall" cli/ application/ adapters/   # Stage 3 后应为空
```
