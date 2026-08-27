# FEBEL 终局推进任务地图（post-M6/H1）

## Background

M0–M6 与 H1 已闭合：控制平面 / 记忆 / 资产 / 定时 / 自省 / 安全韧性的**建造**基本就位。GOAL.md 自审结论是「建造质量远超使用里程」——三个飞轮（记忆、资产、工作流自省）机制在，转速仍近零。

本父任务用 **FEBEL** 五维把终局缺口拆成可独立验收的子任务，对齐 `GOAL.md` North Star，避免再堆无使用对象的厚度。

## FEBEL 定义（本仓库口径）

| 维 | 含义 | 终局对应 |
|---|---|---|
| **F**ront | 用户入口面：工作台根入口、AGENTS 受管块、harness 会话入口与技能投影 | 「从一个总控文件夹启动任何 harness」 |
| **E**xperience | 会话飞轮体验：注入 → 干活 → 召回 → 收工写回（显式） | 「带着准确记忆开展任何工作」 |
| **B**ackend | CLI / cron / doctor / adapters / 调度与失败可见性 | 无常驻、系统调度 + 无头 harness |
| **E**cosystem | gbrain（不封装）/ filehub / Obsidian 视图 / 多 harness 共享 | 「记忆存指针、资产存本体」 |
| **L**ifecycle | upgrade / 分发 / retro 自省 / 跨机 / **真实使用验证** | 「换机继续；越用越强」 |

## Goal

产出并维护 post-M6/H1 的 FEBEL 任务地图：每个子任务可独立规划、实现、验收、归档；父任务只做跨子任务验收与 GOAL 回写，不直接写代码。

## Current State（2026-08-27 核对 main）

已就位（不在本树重复建造）：

- 路由 / filehub / cron MVP / 记忆精度 / 分发 / workbench-retro / session-end 接线（B4）/ cron.all_disabled / 可执行收工文案 / `$GBRAIN_BIN` 契约（PR #27，任务已归档）
- issue #13 主体（Pi session-start、briefing.stale、incident banner、first-use cron 引导）已在 main

仍开放 / 待落地：

| 维 | 缺口 | 子任务 |
|---|---|---|
| F | PR #26 未合 main：技能列表仍硬编码 4 个；投影列举 / spawn 噪声 / JSPACE-BRAIN-OPS / cron harness 提醒 | `08-27-febel-f-pr26-land` |
| E | 写回腿工程已就位，**指标未达标**；doctor 侧缺「写回率长期为 0」的轻量可见性（不破显式写回红线） | `08-27-febel-e-writeback-flywheel` |
| B | GOAL #5 仍开放：真实触发、Linux 错过跳过、Windows 登出、沙盒 namespace | `08-27-febel-b-platform-ledger` |
| Eco | 真实第二机演练待实际使用；需可复跑协议与 GOAL 回写槽 | `08-27-febel-eco-second-machine` |
| L | retro 无头首跑 / `source:session` 两周窗口 / 使用里程条目未形式化为 M7 | `08-27-febel-l-usage-flywheel` |

## Task Map（children）

1. **F** `febel-f-pr26-land` — 合并/对齐 PR #26 前台小修（可立即工程推进）
2. **E** `febel-e-writeback-flywheel` — 会话写回飞轮可观测与习惯门禁（工程 + 口径）
3. **B** `febel-b-platform-ledger` — GOAL #5 平台调度残余闭合（真机/替代关闭）
4. **Eco** `febel-eco-second-machine` — 双机记忆与指针真实演练协议
5. **L** `febel-l-usage-flywheel` — 自省与使用里程飞轮协议（含 GOAL M7 槽位）

推荐推进顺序：**F → E → L（协议）→ B / Eco（真机依赖可并行）**。

依赖说明（写在子任务，不靠树位置暗示）：

- E / L 的「指标达标」依赖真实使用，工程侧只交付可观测与协议，**禁止伪造 `source:session` 数据**
- B / Eco 的关闭允许「替代关闭条件」写进 GOAL/PLATFORMS，但必须显式标注效力边界

## Cross-child Acceptance

- [ ] 五个子任务均有可测试的 Acceptance；usage-only 项以「协议 + GOAL 回写槽」而非假绿关闭
- [ ] 任一子任务合入后不破坏：显式写回红线、不引入常驻运行时、不封装 gbrain
- [ ] 父任务归档前：`GOAL.md` 增加 **M7（使用里程）** 条目（由 L 子任务起草，父任务确认），并链接各子任务结论
- [ ] `bunx tsc --noEmit`、`bun test`、三 check 脚本在工程类子任务合入后仍绿

## Non-Goals

- 不新开常驻运行时 / 事件网关 / 自主代理
- 不自动 session-end 写 gbrain
- 不把「真实使用验证」用 CI 假数据关闭
- 父任务自身不实现功能代码

## Key Decisions

- FEBEL 五维是规划透镜，不是新架构层；实现仍落 CLI / templates / skills / docs
- 「建造 → 使用」拐点：优先 F（已开 PR）与 E/L（飞轮转速），B/Eco 真机项诚实挂账
- 已完成的 `gbrain-bin-adapter-contract`（PR #27）归档，不纳入本树

## Notes

- 父任务 status 保持 planning / 仅在最终集成审视时 start；日常 `task.py start` 对准下一个子任务
- 开放 issue/PR：[#26](https://github.com/jionpz/jspace/pull/26)（F 子任务）
