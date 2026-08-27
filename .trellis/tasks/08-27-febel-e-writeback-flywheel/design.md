# E: 写回飞轮习惯门禁 — 设计要点

配套 `prd.md`。实现前以此锁定检查码、触发条件与红线；不替代 PRD 的 Acceptance。

## 1. 架构裁决（先于代码）

| 候选 | 裁决 | 理由 |
|---|---|---|
| doctor `gbrain list --tag source:session` 算真实写回率 | **不做** | doctor = 离线结构化诊断（`08-10-doctor-drift-checks` R4）；gbrain 锁/挂起风险；与「不封装 gbrain」一致 |
| context 在「长期 0」时升级 nudge / 自动写 | **不做** | 破「永不自动」红线；且 context 同样量不到真实率 |
| 本地并行计数器（skill 写 `.jspace/state/writeback.json`） | **不做（本轮）** | 与 `source:session` 双真相；漂移后 doctor 假绿/假红 |
| doctor 读 `briefing.json` 发 info | **做** | 与 `cron.all_disabled` / `briefing.stale` 同族；只描述「提醒面」，引导去 retro/gbrain 取证 |
| retro 检查 1 改公式 | **不做** | 已就位；只加交叉引用 |

## 2. 检查码与语义

| 字段 | 值 |
|---|---|
| **code** | `memory.writeback_habit_unverified` |
| **severity** | `info`（永不 warning/error；不影响 exit） |
| **path** | `memory.writeback` |
| **含义** | 会话里程与收工轻提示表明提醒面在转；**会话写回腿是否在转尚未由 doctor 验证**——请用户/retro 用来源 tag 取证 |
| **非含义** | 不是「写回率 = 0」的证明；不是接线故障（接线看 `briefing.stale` / `harness.session_start_not_wired`） |

命名刻意用 `unverified` 而非 `rate_zero`，避免把量不到的指标写成事实。

## 3. 触发条件（离线）

输入：`readBriefing(root).state`（已有 API）。

```
let state = briefing.state
if state is null → silent          # 无 session-start 里程，不报习惯问题
if state.session_count < SESSION_THRESHOLD → silent
if state.writeback_nudge_for_session is undefined → silent
   # 轻提示从未 claim：可能是旧 CLI / 从未跑过 turn；不与「习惯」混谈
if state.writeback_nudge_for_session < 1 → silent
→ emit memory.writeback_habit_unverified
```

**建议阈值（实现可微调，单测锁死）**：

- `SESSION_THRESHOLD = 5`（至少约一周量级的会话起步；新 init 不吵）
- 不要求 `writeback_nudge_for_session == session_count`（部分会话被更高优先级 turn 状态挤掉 nudge 仍属正常）；只要 **曾经发出过** nudge（字段存在且 ≥ 1）且 session_count 过阈值即可。

**刻意不触发的情况**：

- `briefing.stale` 已在报 → 本码仍可并存（一个谈接线，一个谈习惯），但文案互不抢「改接线」结论；本码只指向收工自查 / retro。
- `session_count` 高但从未 nudge：可能是 turn hook 未跑——优先让既有 session-start / briefing 检查说话；本码静默，避免误指「习惯」。

## 4. 文案契约（红线）

必须同时满足：

1. 不出现「将自动写回」/「请忽略显式收工」类措辞。
2. 含可执行三件套：`「收工」` + `memory-writeback` + `tags: source:session`。
3. 含取证命令：`gbrain list --type note --tag source:session -n 20`（可附 cron 对照句）。
4. 点明 doctor **未**查询 gbrain：本 info = 请去验证，不是已验证为 0。

示例（实现可润色，语义不可删）：

> session activity with write-back nudges recorded (session_count=N); doctor does not query gbrain — verify the session write-back leg with `gbrain list --type note --tag source:session -n 20` (or workbench-retro check 1). To persist facts, say「收工」to run memory-writeback with tags: source:session. This diagnostic never writes gbrain.

中文工作台用户向输出可与 `cron.all_disabled` 一样用中文；码名保持 ascii。

## 5. 落点模块

| 位置 | 改动 |
|---|---|
| `application/diagnostics/checks/session-hooks.ts`（或新建 `checks/writeback.ts`） | 读 briefing，按 §3 emit |
| `application/diagnostics/doctor.ts` | 挂入编排数组 |
| `application/diagnostics/doctor.test.ts` | 阳性 / 阈值以下 / 无 briefing / 无 nudge 字段 |
| `skills/jspace-use/SKILL.md` §6 | 登记码 + `--verbose` |
| `skills/workbench-retro/references/checks.md` 检查 1「提醒面」 | 一句：doctor `--verbose` 可能报 `memory.writeback_habit_unverified`（习惯门禁，非接线） |
| `scripts/gen-assets.ts` | 改 skill 后必跑 |

**不改**：`application/context/payload.ts` nudge 正文（除非发现与上例外文案冲突的过时句——仅同义对齐）。

## 6. 与 retro 检查 1 的分工

```
提醒面是否接上?     → briefing.stale / session_start_not_wired / (本码前置条件)
提醒了没写?         → retro: session_writes==0 且 nudge 在跟 → 需你决策（习惯）
写回率精确数字?     → retro: session_writes/(session+cron)；doctor 不报百分比
doctor 日常可见性?  → 本码 info（每周 retro 之外的轻提示）
```

retro 判读规则**零修改**；只加交叉引用。

## 7. 测试矩阵

| 夹具 | 期望 |
|---|---|
| 无 `briefing.json` | 无本码 |
| `session_count=3`, nudge=3 | 无本码（阈值下） |
| `session_count=5`, 无 `writeback_nudge_for_session` | 无本码 |
| `session_count=5`, `writeback_nudge_for_session=2` | **有**本码 info |
| `session_count=20`, nudge=20 | 有本码；doctor exit 仍 ok（无其它 error） |
| 夹具**不得**创建 gbrain `source:session` 页 | AC7 |

## 8. 红线检查清单（实现 / review）

- [ ] 无 `gbrain put` / `pending stage` / spawn gbrain 用于本检查
- [ ] severity 仅为 `info`
- [ ] 不修改 `claimWritebackNudge` 频率语义
- [ ] 不在 CI 写入伪造 provenance tag
- [ ] GOAL「永不自动」措辞未被本改动削弱

## 9. 明确不做的后续（防范围爬升）

- doctor `--verbose` 打印真实 N/M 写回率（需要 gbrain）→ 若未来要做，单独立项并重审「doctor 离线」裁决，**不**塞进本任务。
- 把本码升 warning「强迫」用户收工 → 违反显式写回与「全手动合法」先例（`cron.all_disabled`）。
