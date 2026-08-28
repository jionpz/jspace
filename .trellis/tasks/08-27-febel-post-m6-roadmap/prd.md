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
| E | 写回腿工程已就位，**指标未达标**；doctor 侧缺「写回习惯可能静默」的轻量可见性（doctor 量不到精确写回率，精确数字归 retro 检查 1；不破显式写回红线） | `08-27-febel-e-writeback-flywheel` |
| B | GOAL #5 仍开放：真实触发、Linux 错过跳过、Windows 登出、沙盒 namespace | `08-27-febel-b-platform-ledger` |
| Eco | 真实第二机演练待实际使用；需可复跑协议与 GOAL 回写槽 | `08-27-febel-eco-second-machine` |
| L | retro 无头首跑 / `source:session` 两周窗口 / 使用里程条目未形式化为 M7 | `08-27-febel-l-usage-flywheel` |

## Task Map（children）

1. **F** `febel-f-pr26-land` — 合并/对齐 PR #26 前台小修（可立即工程推进）
2. **E** `febel-e-writeback-flywheel` — 会话写回飞轮可观测与习惯门禁（工程 + 口径）
3. **B** `febel-b-platform-ledger` — GOAL #5 平台调度残余闭合（真机/替代关闭）
4. **Eco** `febel-eco-second-machine` — 双机记忆与指针真实演练协议
5. **L** `febel-l-usage-flywheel` — 自省与使用里程飞轮协议（含 GOAL M7 槽位）

推荐推进顺序：**F → E →（L / B / Eco 协议挂账并行）→ 父任务集成审视**。细化见下节。

## 推进顺序与依赖（2026-08-27 综合）

### 顺序理由

1. **F（下一个 start）**：唯一有在途 PR 的工程子任务（[#26](https://github.com/jionpz/jspace/pull/26)，OPEN / MERGEABLE），拖越久与 main 漂移成本越高；「技能列表硬编码 4 个」是用户当前可感知的错误陈述。F 与 E 都碰 jspace-use / skill 投影面，先合 F 避免生成资产冲突。**F 的 prd.md 仍为 TBD 模板（待 F 代理补全）**，工程内容由 PR #26 diff 承载。
2. **E（F 后 start）**：工程增量小而闭合（doctor info 码 + 口径交叉引用），`design.md` 已锁死码名 `memory.writeback_habit_unverified`、阈值与红线；合入后 L 协议的引用面即稳定。
3. **L / B / Eco（协议类，规划已基本完备）**：交付主体是协议 + 台账/回写槽，PRD 即接近终态；真正关闭依赖真实使用/真机窗口，由用户触发，不占工程序列。B 的 E 型交付（runbook、`/it` 合同单测、linux adapter 审计）可在 E 之后作为独立小工程轮执行。
4. **父任务（最后）**：全部子任务终态后做集成审视（见 `implement.md`）+ 确认 L 的 M7 草案写入 GOAL + 归档。

### 依赖边（显式，不靠树位置暗示）

| 边 | 性质 |
|---|---|
| F → E | 软依赖：两者都改 skills / 文档面，顺序执行避免 gen-assets 冲突；非语义依赖 |
| E → L | 软依赖：L 取证协议引用 doctor 新码名；E 未合入 L 已可执行，仅取证更省事。E 承诺码名合入后稳定（改名需过父任务） |
| L → 父 | 硬依赖：M7 草案由 L 持有，父确认后写入 GOAL；L 未定稿则父不能归档 |
| B / Eco → 父 | 硬依赖（终态即可）：台账行 / 回写槽须达「真机已验证 或 替代关闭（含效力边界）或 显式挂账」终态；开放项诚实挂账进 GOAL/M7 即可收口 |
| E ↔ L 写回率分界 | E = 提醒面可见性工程（doctor 量不到率）；L = 真实两周窗口数字与 M7。共享「禁伪造 `source:session`」红线，双方 PRD 已互认边界，无冲突 |

横切约束（沿用）：E / L 的「指标达标」依赖真实使用，工程侧只交付可观测与协议，**禁止伪造 `source:session` 数据**；B / Eco 的关闭允许「替代关闭条件」写进 GOAL/PLATFORMS，但必须显式标注效力边界。

## 子任务状态表（2026-08-28 终态核对，5/5 已归档）

| 子任务 | status | 交付物 | 交叉验收结论 |
|---|---|---|---|
| F `08-27-febel-f-pr26-land` | ✅ completed / archived | PR #26 已合 main（merge `18c551d`，6 平台 + test 全绿） | 通过：技能列表单源（manifest 驱动）已验收，合入后 gen-assets / 三 check 全绿 |
| E `08-27-febel-e-writeback-flywheel` | ✅ completed / archived | `memory.writeback_habit_unverified`（doctor info，离线读 briefing，commit `8845d06`） | 通过：零 gbrain 写侧路径、未改 nudge 频率；与 L 的「doctor 量不到写回率」分界双向写清 |
| B `08-27-febel-b-platform-ledger` | ✅ completed / archived | `docs/PLATFORMS.md` 台账四条残余终态 + `/it` / crontab 合同单测 + GOAL #5 改写（commits `b89850c` / `d602d19`） | 通过：四条均落 `工程已闭合·真机待使用` 或 `替代关闭 + 效力边界句`；无 CRUD/`cron run`/`schtasks /Run` 冒充触发 |
| Eco `08-27-febel-eco-second-machine` | ✅ completed / archived（真机执行挂账） | `skills/memory-recall/references/real-second-machine-protocol.md`（P0–P7 + R4 降级 + `eco.*` 台账）+ GOAL #1 / M5 回写槽（commit `8795d0b`） | 通过：物理第二机三条判据成文，同机/容器/CI 关闭路径显式排除；`eco.verdict` 留空未填 |
| L `08-27-febel-l-usage-flywheel` | ✅ completed / archived（两周窗口挂账） | `skills/jspace-use/references/usage-mileage.md`（R1–R3 + 证据台账）+ GOAL **M7（使用里程）**（commit `7f8d805`） | 通过：M7 已入 GOAL 且未填数字；`cron run` 双 claim 与 B 分开表述 |

**父任务收口形态**：工程层（F / E / B 的 E 型）已闭环且检查全绿；使用层（L 两周窗口、B ① 真实触发、Eco 真机 P0–P7）按 `design.md` 的设计内路径以「协议就位 + 诚实挂账进 GOAL/M7」收口，等真实使用与真机窗口，不由代理关闭。

## Cross-child Acceptance（2026-08-28 终态核对）

- [x] 五个子任务均有可测试的 Acceptance；usage-only 项以「协议 + GOAL 回写槽」而非假绿关闭——E/B/Eco/L 早前已核验，**F PRD 已补全**（AC1–AC7 全勾，含技能列表单源与三 check 全绿）
- [x] 任一子任务合入后不破坏：显式写回红线、不引入常驻运行时、不封装 gbrain——E 的 doctor 码离线且零 gbrain 写侧路径；L / Eco 均为 md 协议交付；Eco 协议红线 2 明写「全部动作走既有 gbrain CLI，不新增一键换机命令」
- [x] 父任务归档前：`GOAL.md` 增加 **M7（使用里程）** 条目（L 已入 GOAL，2026-08-27）——草案已由 L 起草（见其 PRD「GOAL M7 草案」节），父任务确认后写入；M7 允许带「待真实使用验证」开放子项入 GOAL，**不等数字达标**
- [x] B / Eco 的台账与 GOAL 回写用词服从 B 的 Closing Taxonomy：`真机已验证 / 替代关闭（含效力边界句）/ 挂账开放`；禁止 CRUD、`jspace cron run`、`schtasks /Run` 冒充真实触发——B 台账四条落 `工程已闭合·真机待使用` / `替代关闭 + 边界句`；Eco 协议末节直接复用同一组用词纪律，GOAL #1 写「协议已发行，待真机（`eco.verdict` 待填）」并显式排除同机/容器/CI 关闭路径
- [x] 术语防混用：`jspace cron run` 在 L（retro 无头首跑 rehearsal，可作最低关闭条）与 B（真实触发，禁止用它关闭）承载不同 claim——GOAL/台账回写时点名区分。L 的 `usage-mileage.md` R1 有「术语防混用」段，B 的 PLATFORMS 真实触发节有三条排除项，两处互不重叠
- [x] `bunx tsc --noEmit`、`bun test`、三 check 脚本在工程类子任务（F / E / B 的 E 型交付）合入后仍绿——Eco 发行轮复跑：tsc 通过、`bun test` 690 pass / 0 fail、check-skills / check-harness-consistency / check-manifest-integrity 全过、`init` 冒烟确认新协议随工作台物化并投影到各 harness

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

- 父任务 status 保持 planning / 仅在最终集成审视时 start；**5/5 子任务已归档（2026-08-28）**，下一步即父任务集成审视（见 `implement.md`）后归档
- 开放 issue/PR：#26 已合入集成分支（merge `18c551d`）；当前集成 PR [#28](https://github.com/jionpz/jspace/pull/28)
- 综合核对备忘（2026-08-27，仅记录、不改子 PRD）：
  - F `prd.md` 仍是 TBD 模板，**待 F 代理**补全；父侧验收先按 PR #26 diff + 上表约束预置。
  - L PRD Notes 有条件句「兄弟 E …PRD 仍 TBD 时以本边界为准」——E PRD 现已完整且边界与 L 一致，该条件句自然失效，无需改动。
  - 本 PRD Current State 原把 E 缺口写作「写回率长期为 0 的可见性」；E Key Decision 1 校准为「习惯可能静默的可见性」（doctor 离线、量不到写回率，精确数字归 retro 检查 1）。以 E PRD 口径为准，上表已同步。
  - `jspace cron run` 双角色澄清：L 用它关闭「retro 无头首跑」（claim = skill 无头执行并产出合格 retro 页），B 禁止用它关闭「真实触发」（claim = 系统调度器钟点拉起）。两 claim 不同、互不冲突，但 GOAL 回写时必须分开表述。
  - 协同机会：若 L 步 4（自然触发）在 Linux/Windows 真机发生，其 runs/logs 证据可同时充当 B ①（真实触发）的 H 证据——允许一次演练喂两个台账，双向留痕即可。
