# FEBEL 父任务 implement — 集成审视 checklist

父任务不写业务代码。本 checklist 只在全部子任务达到终态后执行一次（届时才 `task.py start` 父任务）；执行者逐条勾选，任一红线项失败即阻塞归档。

## 前置门

- [ ] F / E / B / Eco / L 五个子任务均为 completed，或（B / Eco / L 使用层）带诚实挂账的终态结论
- [ ] F `prd.md` 已非 TBD，且其 AC 与 PR #26 实际合入 diff 一致

## 1. 红线横扫（任一失败 = 阻塞归档）

- [ ] 全仓检索无新增「doctor / context / hook → gbrain 写侧（put / pending stage）」路径；GOAL「写回是显式动作，永不自动」原文未被削弱
- [ ] 未引入常驻运行时 / 事件网关 / 自主代理
- [ ] 无 CI、测试夹具或提交伪造 `source:session` 页、假第二机路径、假触发证据
- [ ] gbrain 未被封装（仍是外部 CLI + `$GBRAIN_BIN` 契约）

## 2. 工程绿线

- [ ] `bunx tsc --noEmit`、`bun test` 全绿
- [ ] `bun run scripts/gen-assets.ts` 后无残留 diff；`check-skills` / `check-harness-consistency` / `check-manifest-integrity` 全过
- [ ] `jspace init /tmp/jspace-smoke` + `jspace doctor --dir /tmp/jspace-smoke` 冒烟正常；E 新 info 码在全新工作台**不**误报（无 briefing → 静默）

## 3. 口径一致性

- [ ] doctor 新码 `memory.writeback_habit_unverified`：severity 恒为 info、不影响 exit code；jspace-use §6 已登记；retro 检查 1 有交叉引用且计数公式未改
- [ ] `docs/PLATFORMS.md` 台账四条残余（① 真实触发 ② Linux 错过跳过 ③ Windows 登出 ④ 沙盒 namespace）终态 ∈ {真机已验证, 替代关闭 + 效力边界句, 显式挂账}；无 CRUD / `jspace cron run` / `schtasks /Run` 冒充触发的表述
- [ ] `GOAL.md` #5 与台账逐条一致；#1 / M5 的 Eco 回写槽如未执行则维持开放原文，如已执行则字段（R5）无空必填项
- [ ] L 与 B 对 `jspace cron run` 的两种 claim（retro 无头首跑 vs 真实触发）在 GOAL / 台账文字中未被混写

## 4. GOAL 回写（父任务唯一直接改动面）

- [ ] 从 L PRD「GOAL M7 草案」节粘贴 M7 条目入 `GOAL.md` 里程碑（M6/H1 之后），保留「待真实使用验证」开放子项；已有真实数字则填入
- [ ] M7 内指认各子任务结论落点：E 门禁码、B 台账行、Eco 协议与回写槽、L 协议与证据台账
- [ ] 若 B / Eco 已有真机结果回写，核对 M7 与 #5 / #1 无重复或矛盾表述

## 5. 收尾

- [ ] 父 `prd.md` Cross-child Acceptance 全勾；Notes 补记各挂账项与其到期/触发条件
- [ ] 子任务全部归档；父任务 finish + archive
- [ ] 归档提交只含规划 / 文档 / GOAL 改动（业务代码已随各子任务合入，父级不夹带）
