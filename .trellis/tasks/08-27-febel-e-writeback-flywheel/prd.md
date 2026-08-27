# E: 会话写回飞轮可观测与习惯门禁

## Background

GOAL.md 记忆协议红线：**写回是显式动作，永不自动**——hook / 每会话一次轻提示只提醒，从不代写 gbrain。「写回率」量的是真的写了几次（`source:session`），不是被提醒了几次。

M6 写回腿工程侧已就位（B4，2026-08-26）：

| 已就位 | 落点 |
|---|---|
| session-end 接线（claude/cursor best_effort；opencode/pi/codex 保持 manual） | seed + `docs/session-end-hooks.md` |
| 每会话一次收工轻提示（可执行三件套） | `jspace context turn` + `.jspace/state/briefing.json` |
| 来源 tag `source:session` / `source:cron` | 写侧 skill + `jspace-use/references/gbrain.md` |
| 写回率取证（检查 1） | `workbench-retro/references/checks.md` |
| 定时层静默默认可见 | `cron.all_disabled`（doctor info） |

父任务（`08-27-febel-post-m6-roadmap`）对本子任务的缺口表述：写回腿工程已就位，**指标未达标**；doctor 侧缺「写回率长期为 0」的轻量可见性（不破显式写回红线）。

真实窗口计数 > 0 属 **L**（`08-27-febel-l-usage-flywheel`），不在本任务关闭。

## Goal

在不破「写回显式、永不自动」红线的前提下，补齐写回飞轮的**轻量工程门禁**：doctor 对「提醒面已在转、会话写回腿可能静默」给出与 `cron.all_disabled` 同级的 info 可见性；口径与 retro 检查 1 / jspace-use 自查对齐；**不**把指标达标或伪造 `source:session` 当作本任务交付。

## Scope

1. **doctor（工程）**：基于**离线**机器状态（`.jspace/state/briefing.json`）新增一条 info 诊断，类比 `cron.all_disabled`——提醒「会话在跑且收工轻提示已发出，请用 gbrain 取证命令 / retro 检查 1 核对写回腿」；文案点名触发词「收工」+ `memory-writeback` + `source:session`。
2. **口径对齐（轻量 skill/文档）**：jspace-use §6（及必要时 §7）登记新诊断码；retro 检查 1 增加与 doctor 信号的交叉引用（提醒面 vs 写回面已分判，不改计数公式）。
3. **设计锁死红线**：任何实现路径不得自动写 gbrain、不得提高 nudge 频率、不得把 doctor 失败与写回率挂钩。

## Out of scope

- 重复建造 B4：session-end 接线、每会话一次轻提示、来源 tag、retro 检查 1 公式、可执行收工文案、`cron.all_disabled`。
- **伪造或注入** `source:session` 页 / CI 假数据「刷绿」写回率。
- **doctor / context 调用 gbrain 运行时**统计真实写回率（与既有裁决冲突：doctor 是离线结构化诊断，见 Key Decisions）。
- 提高 `context turn` 收工提示频率、在 session-end/turn 代写 gbrain、把 closing 提示改成强制写回。
- 真实两周窗口 `source:session` 计数 > 0、retro 无头首跑、GOAL M7 使用里程条目 → **L**。
- 新建 domain/resource、常驻运行时、封装 gbrain。

## Requirements

### R1 — doctor 离线习惯门禁（info）

- 新增诊断码（建议名见 `design.md`）：当 briefing 显示**会话已有一定里程且收工轻提示已发出过**时，报 **info**（非 warning / 非 error）。
- 文案必须：
  - 说明这是「提醒面在转 → 请核对写回腿」，**不宣称** doctor 已量到写回率 = 0（doctor 看不见 gbrain）；
  - 给出可执行自查：`gbrain list --type note --tag source:session -n 20`（及/或指向 workbench-retro 检查 1）；
  - 重申「说一句「收工」→ `memory-writeback` → `tags: source:session`」；明确本诊断**不写** gbrain。
- 默认 `jspace doctor` 行为与其它 info 一致（摘要计数；`--verbose` / `--json` 可见细节）。
- 无 briefing / 会话里程不足 / 轻提示从未发出 → **静默**（避免新工作台误报）。

### R2 — 不破红线（硬约束）

- hook、turn nudge、doctor 文案、任何新检查：**零路径**调用 `gbrain put` / `pending stage` / 等价写侧。
- 不把写回率 / 本 info 码升级为 warning 或影响 doctor exit code。
- 不引入「长期为 0 则自动收工」或提高每会话 nudge 次数。

### R3 — retro / jspace-use 口径（仅补强，不大改）

- retro 检查 1 的来源比公式、`session_writes == 0` 判读、提醒面 `briefing.json` 根因分流**保持不变**。
- 允许的工程补强：检查 1「提醒面」段交叉引用 doctor 新 info 码（接线 OK 时用户也可在 doctor `--verbose` 看到习惯门禁）。
- jspace-use：§6 诊断列表补新码；§3「收工」/ §4 写回率自查已够用则不扩写流程。

### R4 — context 面

- **默认不改** `application/context/*` 的 nudge 语义（每会话一次、最低优先级、可执行三件套已就位）。
- 若实现期发现文案与 doctor 新码措辞不一致，只允许**同义对齐**，不得改变触发次数或写入行为。

### R5 — 与 L 的边界

- 本任务验收 = 门禁与口径就位；**不**要求真实工作台 `source:session` > 0。
- GOAL.md「待真实使用验证」条目的数字回写由 L 负责；本任务最多在 Notes/设计中链到 L。

## Acceptance Criteria

- [ ] AC1：存在 doctor **info** 诊断（码名以 `design.md` 为准），触发条件仅依赖离线 `briefing.json`（及明确阈值），单测覆盖阳性 / 阴性 / 无 briefing。
- [ ] AC2：该诊断在 `jspace doctor` 默认模式下不导致失败（exit 仍仅由 error 决定）；`--verbose` 或 `--json` 可看到码与文案。
- [ ] AC3：文案含「收工」+ `memory-writeback` + `source:session` 自查命令，且含「不写 gbrain / 仅提醒核对」语义。
- [ ] AC4：全仓检索确认无新增「doctor/context → gbrain list/put」路径用于本门禁。
- [ ] AC5：`skills/jspace-use`（§6 或等价）提及新诊断码；retro 检查 1 有交叉引用或明确「无需改公式」的决策留痕（本 PRD Key Decisions）。
- [ ] AC6：`bunx tsc --noEmit`、相关 `bun test`（doctor / briefing）、改 skill 则 `bun run scripts/gen-assets.ts` + check-skills / harness / manifest 全过。
- [ ] AC7：无任何提交或测试夹具写入带 `source:session` 的「假装用户收工」数据作为验收依据。

## Non-goals

- 指标达标（两周窗口 session 写入 > 0）。
- 自动写回、强制收工、提高 nudge 频率。
- doctor 运行时查询 gbrain 以打印真实写回率。
- 替代或重写 workbench-retro 检查 1。
- 关闭 GOAL 开放「写回腿习惯养成」验证项（属 L + 真实使用）。

## Key Decisions

1. **真实写回率的唯一取证面仍是 gbrain 来源 tag + retro 检查 1**；doctor 只做「提醒面已转 → 去取证」的轻量门禁，**不得**在 doctor 文案里写死「写回率 = 0%」（它量不到）。父任务「写回率长期为 0 的可见性」落地为：**习惯可能静默的可见性**，精确百分比留给 weekly retro。
2. **doctor 不碰 gbrain 运行时**——沿用 `08-10-doctor-drift-checks`（R4）与 longterm-content O2：离线结构化诊断；引入 gbrain 有锁/挂起/可用性风险。写回率精确计数继续由 retro 承担。
3. **触发信号用 briefing**：`session_count` + `writeback_nudge_for_session`（B4 已有）。阈值与码名见 `design.md`。类比 `cron.all_disabled`：info、合法选择（可以全手动）、但不可无声。
4. **context 不再加门禁**：B4 可执行轻提示已是会话内唯一提醒面；再加「长期为 0」升级文案易滑向催促自动化，且仍量不到真实率。E 的工程增量集中在 doctor + 口径交叉引用。
5. **retro / jspace-use 以口径补强为主，非重建**：检查 1 与 Provenance tag 段已完整；缺口是 doctor 侧静默，不是 skill 不会数。
6. **禁止伪造 `source:session`**：工程验收用 briefing 夹具；使用里程验收属 L。
7. **与 L 分工**：E = 可观测与习惯门禁（工程）；L = 真实窗口数字 + GOAL M7 回写槽。

## Dependencies

- 上游已合入：B4 写回腿接线、`cron.all_disabled`、可执行收工文案。
- 下游：L 使用里程验证依赖本任务门禁文案稳定（诊断码名勿在 L 开始后无故重命名）。
- 父任务：`08-27-febel-post-m6-roadmap`。

## Notes

- 技术细节（检查码、阈值、伪代码、测试矩阵）→ `design.md`。
- 实现前 `task.py start`；本规划轮次不 start、不改业务代码、不 commit。
