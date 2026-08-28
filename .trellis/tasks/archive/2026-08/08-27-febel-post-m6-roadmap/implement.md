# FEBEL 父任务 implement — 集成审视 checklist

父任务不写业务代码。本 checklist 在全部子任务终态后执行（2026-08-28 完成）。

## 前置门

- [x] F / E / B / Eco / L 五个子任务均为 completed / archived（B/Eco/L 使用层带诚实挂账）
- [x] F `prd.md` 已非 TBD，AC 与 PR #26 合入 diff 一致（archive `08-27-febel-f-pr26-land`）

## 1. 红线横扫

- [x] 无新增 doctor/context/hook → gbrain 写侧；GOAL「写回显式、永不自动」未削弱（`writeback.ts` 仅读 briefing）
- [x] 未引入常驻运行时 / 事件网关 / 自主代理
- [x] 无伪造 `source:session`、假第二机、假触发证据（测试夹具仅 briefing.json）
- [x] gbrain 未封装（`$GBRAIN_BIN` 契约不变）

## 2. 工程绿线

- [x] `bunx tsc --noEmit`、`bun test` 690 pass / 0 fail
- [x] gen-assets 无残留 diff；三 check 脚本全过
- [x] `jspace init /tmp/jspace-febel-smoke` + doctor 0 error；全新工作台无 `writeback_habit_unverified`（无 briefing → 静默）

## 3. 口径一致性

- [x] `memory.writeback_habit_unverified` info only；jspace-use §6 + retro 检查 1 交叉引用
- [x] PLATFORMS 台账四条终态 ∈ {工程已闭合·真机待使用, 替代关闭+边界}；无 CRUD/cron run 冒充触发
- [x] GOAL #5 与台账一致；#1 / M5 Eco 槽位开放、`eco.verdict` 未填
- [x] L 与 B 对 `cron run` 双 claim 分开表述（M7 vs #5 / usage-mileage vs PLATFORMS）

## 4. GOAL 回写

- [x] M7 已入 GOAL（L，2026-08-27）；开放子项保留
- [x] M7 增补 FEBEL 工程落点指针（E/B/Eco/L，2026-08-28 父审视）
- [x] B/Eco 无真机 verdict，M7 与 #5/#1 无矛盾

## 5. 收尾

- [x] 父 `prd.md` Cross-child Acceptance 全勾
- [x] 子任务全部归档；父任务 archive（本提交）
- [x] 父级提交仅审视文档 + GOAL 一行增补
