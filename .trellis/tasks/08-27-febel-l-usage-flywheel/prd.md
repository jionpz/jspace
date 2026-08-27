# L: 自省与使用里程飞轮协议

## Goal

把 GOAL.md **M6「待真实使用验证」** 两段（retro 无头首跑 + `source:session` 两周窗口）形式化为可复跑的**使用里程协议**，并起草 **M7（使用里程）** 槽位文案（本 PRD 持有草案；父任务 `08-27-febel-post-m6-roadmap` 确认后再写入 `GOAL.md`）。本任务只交付协议与里程碑槽，**不改 CLI/skill 业务代码、不伪造使用数据、不 `task.py start`**。

## Background（M6 待验证现状）

来源：`GOAL.md` M6 条（2026-08-10 闭合建造；其后 B4 / 纪律面补强只把工程侧就位）。

| 待验证项 | GOAL 原文要点 | 当前状态（规划时） |
|---|---|---|
| retro 无头首跑 | 首次无头 `workbench-retro` cron（原目标窗口曾写 2026-08-16 周日 23:00） | 机制已建（skill + 模板 cron `0 23 * * 0`、`kind: skill`、`enabled: false` 出厂）；**真实无头首跑取证与 GOAL 回写未形式化** |
| 写回腿习惯 | 连续两周 `gbrain list --type note --tag source:session` 落窗口计数 > 0 | B4 接线 + 来源 tag 已就位；当前为 0 **属预期**（新约定前页无 tag）；**禁止伪造**；到期用真实数字回写 |
| 三飞轮转速 | 第五条自省：记忆 / 资产 / 工作流进化需同时转 | first-use 4.5 已念代价；缺一份跨飞轮的**使用里程检查清单**与 M7 关闭条件 |

对照物：

- Skill：`skills/workbench-retro/`（六条取证、无头「只产报告不改」、产出 `records/retro/<YYYY-MM-DD>` + `source:cron`）
- 模板：`templates/workbench/.jspace/cron.json` → `workbench-retro`
- 引导：`skills/jspace-use` §2 first-use 4.5（三飞轮停转代价表 + enable → rehearsal → install）

## Scope

### In

1. **workbench-retro 无头 cron 首跑验证协议**（手跑 rehearsal + 可选自然触发；证据落点与合格判定）
2. **连续两周 `source:session` > 0** 的取证窗口、计数口径、GOAL / retro 回写模板（不伪造）
3. **三飞轮使用里程检查清单**（记忆 / 资产 / 自省）——人跑 checklist，关闭条件可勾选
4. **GOAL M7 草案**（完整条目文案，放本 PRD；不直接改 `GOAL.md`）

### Out（边界）

| 归谁 | 不在本任务 |
|---|---|
| **E** `08-27-febel-e-writeback-flywheel` | doctor / context / retro 的**工程可观测**与习惯门禁实现（告警、文案、指标面） |
| **B** / **Eco** | 平台调度真机残余、第二机演练 |
| 任意子任务 | 伪造 `source:session` / 用 CI 假绿关闭 usage 项 / 自动 session-end 写 gbrain |

**L vs E 一句话**：L = **协议 + 里程碑槽 + 取证怎么采、怎么回写 GOAL**；E = **工程侧让写回率可见、门禁可触达（仍不破显式写回红线）**。指标达标依赖真实使用，两边都不许造数。

## Requirements

### R1 — workbench-retro 无头首跑验证协议

前置（真实工作台，非 `/tmp` smoke）：

1. first-use 已完成或等价：gbrain 可用、`jspace doctor` 无 error、filehub 已注册（否则检查 2/3/5 会大面积「无法判定」——仍可跑，但报告须标明）。
2. 用户已显式开启：`jspace cron enable workbench-retro --dir <wb>`（模板出厂 `enabled: false`，不开则协议不适用）。
3. harness / 配额已接线（与 jspace-use 4.5 一致：未接线先别装调度）。

步骤（有序）：

| 步 | 动作 | 合格信号 |
|---|---|---|
| 1 | `jspace cron run workbench-retro --dir <wb>`（rehearsal，可先于 `install`） | exit 0；`.jspace/logs/cron/workbench-retro/<ts>.md` 有本次输出 |
| 2 | `gbrain get records/retro/<YYYY-MM-DD>`（当日/当周日期 slug） | 页存在；`tags` 含 `retro` + **`source:cron`**（无头）；含「写回率」一节；结论均有证据行 |
| 3 | 对比跑前后 `jspace doctor --dir <wb>` | 无因 retro 引入的新 error；无头模式未改 hub/规则/skill 文件 |
| 4（可选加强） | `jspace cron install` 后等到周日 23:00 **自然触发**一次 | `.jspace/state/runs` / logs 时间戳与调度一致；`jspace cron check` 无未处理失败 |

失败处置：

- rehearsal 失败 → 记 incident + `jspace cron check`；修前置后再跑；**不**把失败标成 M7 部分关闭。
- 页写成旧 slug `memory/retro/...` → 视为不合格（canonical 为 `records/retro/`）；存量 cron.json 若仍写旧路径，按用户数据手工改（upgrade 不覆盖 cron.json）。
- 无头却改了文件 → 红线违规，协议失败，须修 skill/运行配置后再验。

**本协议关闭条件**：至少完成步 1–3 一次，并把日期、slug、log 路径、doctor 前后摘要写入下方「证据台账」与 GOAL M7 回写槽（父任务确认后）。自然触发（步 4）为加强项，可标注「部分 / 全部」关闭。

### R2 — 连续两周 `source:session` 取证与 GOAL 回写

**计数口径**（与 `workbench-retro` 检查 1 / `jspace-use` Provenance tag 对齐）：

```bash
gbrain list --type note --tag source:session -n 50
```

- 只数 `updated_at` **落在该周窗口**（默认自然周或近 7 天，与当周 retro 报告窗口一致）的页 → `session_writes`。
- **不得**把无来源 tag 的历史页折算进 session 腿；新写却漏 tag → 记纪律缺口，不算达标凑数。
- tag 查询不可用 → 记「无法判定」，**不得**用 proxy 冒充精确数来关闭本条。
- **禁止**：手工 `gbrain put` 灌假 session 页、改历史页补 tag、用测试页冒充日常收工。

**两周窗口协议**：

1. 选定起点周 `W0`（建议：来源 tag 约定已在真实工作台生效、且至少有一次真实会话活动之后；不必对齐日历任意日）。
2. 每周日（或与 retro 同窗）记录一行：

   | 周次 | 窗口起止 | `session_writes` | `cron_writes` | 取证命令粘贴摘要 | retro 页 slug |
   |---|---|---|---|---|---|
   | W1 | … | N | M | … | `records/retro/<date>` |
   | W2 | … | N | M | … | `records/retro/<date>` |

3. **达标**：W1 与 W2 **连续两周**均满足 `session_writes > 0`。
4. **回写**（达标或明确未达标到期时均须诚实写）：
   - GOAL.md M6 待验证段 / M7 条目：真实数字 + 日期 + 指向对应 retro 页；
   - 不达标则保持开放，写清「当前仍为 0 / 仅一周 >0」等，**不**用工程交付假装关闭。

提醒面与真写回的区分（写进协议防误读）：`jspace context session-end` / `turn` 轻提示 **≠** `source:session` 计数；只有显式跑 `memory-writeback`（等）才产生分子。

### R3 — 三飞轮使用里程检查清单

人跑、每周或 M7 关闭前勾选。每条须能指向**命令输出或路径**，感想不算。

#### 记忆飞轮

- [ ] 本周至少一次显式收工写回（`memory-writeback`），且 `gbrain list --type note --tag source:session` 能列到新页
- [ ] 周日 `memory-consolidate` 有成功痕迹（cron log 或 `records/consolidate/<date>`），或用户显式 deferred 且 doctor 可见
- [ ] （跨周）连续两周 `session_writes > 0`（接 R2）——**M7 记忆腿关闭条件**

#### 资产飞轮

- [ ] filehub 已注册；`_inbox/` 有清晰处置路径（会话整理或 `inbox-tidy` cron）
- [ ] 近两周至少一次入库闭环：本体进 `projects|areas/...` + gbrain asset 指针页（`tags` 含 `asset` + 来源 tag）
- [ ] retro 检查 3 抽样无未解释断指针；或已记「立即可做」并跟踪

#### 自省飞轮

- [ ] `workbench-retro` 已 enable（或 first-use 记录 deferred + 代价已知）
- [ ] 完成 R1 无头首跑（或等价：会话模式跑通六条检查且产出合格 retro 页——**无头首跑仍为 M6/M7 加强项**）
- [ ] 连续 ≥2 周存在 `records/retro/<date>`，且含写回率一节；「观察中」项按周复现升级规则执行

#### 总控（非飞轮但挡转速）

- [ ] `jspace doctor --dir .` 无 error；`cron.all_disabled` 若存在则用户已知晓
- [ ] 未破坏红线：提醒不代写；retro 只提议不改

## Acceptance Criteria

- [ ] 本 PRD 含完整 R1/R2/R3 协议（步骤、口径、禁止项、关闭条件），可交给真实工作台操作者无需再发明流程
- [ ] **M7 草案**完整条目见下节，可直接粘贴进 `GOAL.md`（经父任务确认）；本任务执行期间**不**直接改 `GOAL.md`，除非用户明确只要落地草案
- [ ] 证据台账模板可用；任何关闭勾选都要求真实路径/数字，不允许「机制已建」替代「使用已发生」
- [ ] 与 E 边界写清：L 不实现 doctor/context 工程；E 不拥有 M7 文案与两周窗口协议所有权
- [ ] 无业务代码变更、无伪造 gbrain 数据、任务保持 `planning`（本轮不 `task.py start`）

## GOAL M7 草案（粘贴用；勿在本任务直接改 GOAL.md）

> 下列为父任务归档前拟写入 `GOAL.md`「里程碑」列表、插在 M6/H1 之后的草案。日期与数字在真实取证后填入；关闭前保持「待验证」子段。

```markdown
- **M7（使用里程）** — 建造→使用拐点的验收槽（起草于 FEBEL-L；父任务确认后入 GOAL）：
  在机制已齐（M6 + B4 写回接线 + 来源 tag）的前提下，用**真实使用**证明三个飞轮在转，而不是再用工程厚度代替转速。
  - **自省腿**：真实工作台完成无头 `workbench-retro` 首跑协议（rehearsal：`jspace cron run workbench-retro` → `records/retro/<YYYY-MM-DD>` 含写回率与证据行、tags 含 `source:cron`、doctor 未因 retro 变坏）。可选加强：周日 23:00 自然触发一次并记账。
  - **记忆腿（写回习惯）**：连续两周 `gbrain list --type note --tag source:session` 落窗口计数 > 0（口径同 workbench-retro 检查 1）。**禁止伪造**；当前为 0 且属预期时保持开放。到期把真实 `session_writes` / 窗口日期 / 对应 retro 页回写本条。
  - **资产腿**：近两周至少一次「inbox/会话入库 → 本体归位 → gbrain asset 指针」闭环可指认；或显式 deferred 并在 retro/doctor 可见。
  - **检查清单**：三飞轮使用里程清单见 `.trellis/tasks/08-27-febel-l-usage-flywheel/prd.md` R3（本地-only；发行说明可摘录到 jspace-use 附录若需分发）。
  - **非目标**：不自动 session-end 写 gbrain；不用 CI 假数据关闭本里程碑；工程可观测（doctor 写回率长期为 0 等）归 FEBEL-E，不替代本条数字。
  - 待真实使用验证：① retro 无头首跑证据；② 两周 `source:session`；③ 资产闭环或诚实 deferred。填数前本条保持开放。
```

### M7 草案要点（摘要）

1. **定位**：使用验证里程碑，不是又一轮建造。
2. **三腿关闭**：自省（retro 无头）/ 记忆（两周 session>0）/ 资产（入库闭环或 deferred）。
3. **取证纪律**：与 retro 检查 1 同源；禁伪造；无法判定不关闭。
4. **与 E 分工**：E 做可见性与门禁；M7 只认真实计数与协议跑通。
5. **回写**：数字 + 日期 + retro slug 写回 GOAL；未达标保持开放。

## 证据台账（操作者填写；本规划轮留空）

| 项 | 日期 | 证据（命令/路径/数字） | 结论 |
|---|---|---|---|
| R1 rehearsal | | | |
| R1 自然触发（可选） | | | |
| R2 W1 `session_writes` | | | |
| R2 W2 `session_writes` | | | |
| R3 资产闭环 | | | |
| GOAL 回写（父任务） | | | |

## Key Decisions

- **D1** M7 文案由 L 起草、父任务确认后入 GOAL；规划轮不改 `GOAL.md`。
- **D2** usage 项关闭标准 = 协议跑通 + 真实数字，≠ skill/cron 存在。
- **D3** 两周窗口与 retro 周窗对齐，避免两套日历。
- **D4** L/E 拆分：协议/槽位 vs 工程可观测；共享「禁伪造」红线。
- **D5** 无头首跑以 rehearsal（`cron run`）为最低关闭条；自然触发为加强，避免调度日阻塞规划。

## Dependencies

- 依赖已交付：M6 workbench-retro、B4 来源 tag、first-use 4.5 cron 引导、模板 `records/retro` slug。
- 并行：E（可观测）可与 L 协议并行规划；L 的记忆腿数字不依赖 E 合入，但 E 合入后取证更省事。
- 上游确认：父任务 Cross-child Acceptance「GOAL 增加 M7」。

## Non-Goals

- 不改 `skills/` / `templates/` / `cli/` 业务实现（若协议暴露文档缺口，另开任务或交 E）
- 不 start / 不实现 / 不 commit（本子代理轮次）
- 不关闭 B/Eco 真机项

## Notes

- 父：`08-27-febel-post-m6-roadmap`
- 兄弟 E：`08-27-febel-e-writeback-flywheel`（工程可观测；PRD 仍 TBD 时以本边界为准）
- 研究锚点：`GOAL.md` M6 待验证；`skills/workbench-retro/**`；`templates/workbench/.jspace/cron.json`；`skills/jspace-use` §2 first-use 4.5
