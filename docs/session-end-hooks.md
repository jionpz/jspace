# Session-end 类 hook 调研（B4 取证）

> 本文件是 **JSpace 开发仓库文档**（不随 `jspace init` 物化）。它记录「各 harness 是否存在 session-end 类 hook」的**证据与限制**，供 `adapters/harness/capabilities.yaml` 的 `lifecycle.session_end` 分级引用。
> 分级语义见 `skills/jspace-use/references/harnesses.md`：**automated** = 有 CI/测试证据；**best_effort** = 机制存在但真实触发依赖用户环境；**manual** = 无自动机制；**unsupported** = 机制不存在。
> 红线：**没有证据不升级分级**。文档里每一条「存在」都必须能指到官方文档的具体事件名与输出契约。

## 结论表

| harness | session-end 类事件 | 证据 | 输出能否回注会话 | 本轮接线 | `lifecycle.session_end` |
|---|---|---|---|---|---|
| claude | `SessionEnd`（matcher `clear`/`resume`/`logout`/`prompt_input_exit`/`other`） | Claude Code hooks 官方文档 | ❌ fire-and-forget（JSON 输出字段被丢弃） | ✅ `.claude/settings.json` → `jspace context session-end` | **best_effort**（本轮升级） |
| grok | `SessionEnd` | Grok Build 兼容 Claude hook 事件集（**未实测**，见 harness-grok.md） | 未实测 | 已接线（M-前轮） | best_effort（保持） |
| cursor | `sessionEnd`（`reason` = `completed`/`aborted`/`error`/`window_close`/`user_close`） | Cursor hooks 官方文档 | ❌ fire-and-forget（「响应被记录但不使用」） | ✅ `.cursor/hooks.json` → `jspace context session-end` | **best_effort**（本轮升级） |
| opencode | 无对应事件（`session.deleted` / `server.instance.disposed` 语义不符） | OpenCode plugin 事件表 | — | ❌ 不接 | **manual**（保持） |
| pi | 扩展事件只有 `session_start` / `before_agent_start` | 现有 harness-pi.md 接线面 | — | ❌ 不接 | **manual**（保持） |
| codex | 无 hook 通道（`hook_format: none`，仅 cron 兼容） | capabilities.yaml | — | ❌ 不接 | **manual**（保持） |

**一句话**：claude / cursor 有官方 session-end 事件、本轮接线并升级为 best_effort；opencode / pi / codex **没有语义匹配的事件，保持 manual**，靠 `jspace context turn` 的每会话一次轻提示补偿（见下方「manual + turn 提示补偿」）。

---

## claude — `SessionEnd`（有证据，本轮接线）

**事件**：`SessionEnd`，「once per session」级事件，与 `SessionStart` 同一 cadence。

**matcher（按结束原因过滤）**：`clear`（`/clear`）、`resume`（交互式 `/resume` 切换会话）、`logout`、`prompt_input_exit`（提示输入可见时退出）、`other`。
> `bypass_permissions_disabled` 已在 v2.1.234 移除，**不要**写进 matcher。
> 模板不写 matcher = 匹配全部原因（与 grok seed 同构）。

**限制（必须写进产品文档，不能含糊）**：

1. **无决策权、输出被丢弃**。SessionEnd 不能阻断会话结束，且 Claude Code 会丢弃它的 JSON 输出字段（`systemMessage` 等）。也就是说 `jspace context session-end` 渲染的提醒文本**不会注入会话**——会话已经结束，本来也没有可注入的对象。接线的价值是「结束时机上有一个会跑的钩子」，不是「用户一定看得到提醒」。
2. **超时预算很紧**。SessionEnd 默认共享 **1.5 秒**预算；配置里写 per-hook `timeout` 会把总预算抬到该值（上限 60 秒）。模板写 `timeout: 10` 即把预算抬到 10 秒，与 grok/claude 其他 hook 的量级一致。
3. **不保证一定跑**。某些信号会在 hook 之前杀掉进程；社区也报告过特定退出路径（`/clear`、`/exit`）上的触发不一致。这正是 **best_effort 而不是 automated** 的原因。

**为什么不顺手接 `PreCompact`**：Claude 的 `PreCompact` **有阻断权**（exit code 2 会阻止 compaction），误用会卡住用户的会话；而 claude seed 的 `SessionStart` 已经带 `compact` matcher，compaction 之后会重新注入工作台上下文，收益已被覆盖。本轮不接，留作后续单独评估。

## cursor — `sessionEnd`（有证据，本轮接线）

**事件**：`sessionEnd`，「composer 会话结束时调用」，输入含 `session_id` / `reason`（`completed` / `aborted` / `error` / `window_close` / `user_close`）/ `duration_ms` / `is_background_agent`。

**限制**：

1. **fire-and-forget**：官方文档明确「响应被记录但不使用」——与 claude 同样注不回会话。
2. **IDE-only**：cloud agent 环境不加载 `sessionEnd`（「云端没有 editor 生命周期的会话边界」）。Cursor 本来就是 `headless: null` 的 IDE-only harness，这条限制不改变别的结论。
3. 项目级 `.cursor/hooks.json` 是工作台 seed 落点；用户级 `~/.cursor/hooks.json` 归用户（cloud agent 不读用户级）。

## opencode — 无语义匹配事件（保持 manual）

OpenCode 的事件总线里最接近的三个都不是「会话收工」：

- `session.idle`（已 deprecated，官方建议改用 `session.status`）：**每个 agent turn 结束都会触发**。拿它当 session-end 会变成逐 turn 噪声，而且现有 seed 已经把它用在 `jspace cron check`（失败面可见）上。
- `session.deleted`：会话被**删除**时触发。会话被删之后再往里注入提醒没有意义。
- `server.instance.disposed` / `global.disposed`：进程/实例级关停，不是某个会话的收工点。

→ 没有可接的 session-end 通道，`lifecycle.session_end` 保持 `manual`。

## pi — 扩展只有会话开始面（保持 manual）

Pi 的扩展接口在本工作台已接的事件是 `session_start` / `before_agent_start`（机器级 `~/.pi/agent/extensions/jspace/index.ts`），没有会话结束事件。→ 保持 `manual`。

## codex — 无 hook 通道（保持 manual）

`hook_format: none`，仅作为 cron 兼容项存在（`documented: false`）。→ 保持 `manual`。

---

## manual + turn 提示补偿

对 opencode / pi / codex（以及 claude / cursor 输出被丢弃的那一半），**收工写回的真实提醒面不是 session-end hook，而是每会话一次的 turn 轻提示**：

- `jspace context turn` 在**没有更高优先级状态**（hub 损坏 / pending 暂存写 / cron 失败 / inbox 待整理）时，**每会话最多注入一次**收工写回提示；
- 去重锚点是 `.jspace/state/briefing.json` 的 `session_count`（session-start 递增）+ `writeback_nudge_for_session`（turn 发出提示时写入）。没有 briefing 状态（session-start hook 没跑过）→ **不提示**，避免逐 turn 刷屏；
- 提示只提示，**不自动写 gbrain**——写回始终是用户显式触发 `memory-writeback`。

所以「session_end = manual」在产品上的准确读法是：**没有结束时刻的自动机制，但会话过程中有一次不打扰的提醒**，写回动作本身永远是显式的。

## 复核方法

分级不是一次性结论。真实使用中按下面的办法复核，结论变了就改 `capabilities.yaml` + `LIFECYCLE_EXPECTED` + 本文件（三处同 PR）：

```bash
# claude:开一个会话再 /clear,看 hook 是否执行(需 Claude Code 的 hook 调试输出)
claude --debug            # 观察 SessionEnd 是否出现在 hook 执行日志

# cursor:关闭 composer 会话后,看 jspace 是否被调用(Cursor hooks 输出走 IDE 日志)

# 任意 harness:确认 hook 本身永不阻塞会话(必须 exit 0、无输出也正常)
jspace context session-end --dir /tmp/not-a-workbench ; echo "exit=$?"   # 期望 exit=0 且零输出
```
