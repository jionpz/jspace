# Design — 注入层

> 子任务 B of `08-06-workbench-context-wiring`。需求见 `prd.md`。
> 方法论依据：`../08-06-workbench-context-wiring/research/trellis-injection-methodology.md` §1-§4、§7。

## 1. 架构定位

```
                    ┌─ 官方 memory 通道（子任务 A）
                    │   CLAUDE.md → @AGENTS.md
                    │   给：静态规则、红线、治理约定
工作台上下文 ──────┤
                    │
                    └─ hook 注入通道（本任务）
                        SessionStart / UserPromptSubmit → jspace context
                        给：动态状态、求值结论、下一步
```

**两条通路职责不重叠**（`prd.md` D4）。静态规则不进 hook payload，动态状态不进 AGENTS.md。
这是照方法论 §2 手段 2 —— Trellis 主动把 per-turn 会重复的块从 SessionStart payload 里剔掉，
理由是 "would just duplicate context"。

## 2. 模块划分

新增 `application/context/`（纯逻辑，可单测）：

| 文件 | 职责 |
|---|---|
| `collect.ts` | 采集工作台状态（域、pending、cron incident、inbox），每项独立容错 |
| `payload.ts` | 把状态渲染成分块文本；持有体积预算与降级规则 |
| `envelope.ts` | 包成各 harness 的 hook JSON 信封（Claude Code / 后续其它） |
| `gate.ts` | 注入闸门：非工作台、`JSPACE_HOOKS=0`、`*_NON_INTERACTIVE`、`no-jspace` |

CLI 侧新增 `cli/commands/context.ts`（`contextSpec`），注册进 `cli/commands/registry.ts` 的 `COMMANDS`。

复用既有能力，**不重新实现**：
- 域/资源 → `application/registry/domain.ts`、`core/contracts/hub.ts`
- pending 暂存写 → `application/pending/use-cases.ts`
- cron incident → `application/automation/incidents.ts`、`status.ts`
- inbox 待归档 → `application/registry/inbox.ts`
- 现有 `doctor` 的 filehub/inbox 探测逻辑（`application/workspace/doctor.ts:70-88`）可直接借鉴其数据源

## 3. payload 设计

### 3.1 `session-start` 分块

```
<jspace-workbench>
JSpace 工作台 <root>。以下是本次会话的工作台状态；规则与治理见 AGENTS.md（已由 CLAUDE.md 加载）。
</jspace-workbench>

<current-state>
域: 3 个 — acme（客户交付）/ research（论文跟读）/ ops（机器与账号）
待办: filehub/_inbox 有 4 份未归档资料
pending: 2 笔 gbrain 暂存写待落盘
cron: memory-consolidate 上次失败（2026-08-05），未确认
</current-state>

<available>
按需读（不要预读全部）:
- workspace/acme/README.md
- workspace/research/README.md
- workspace/ops/README.md
技能: jspace-use / asset-ingest / memory-recall / memory-writeback（已在 skill 列表，直接调用）
</available>

<next-action>
先跑 `jspace pending apply` 落盘 2 笔暂存写；inbox 待整理可说「整理一下 inbox」。
</next-action>
```

设计要点：
- `<current-state>` 每行都是**求值结论**，不是规则（B2.1）。无内容的行整行省略，不输出"0 个"
- `<available>` 只给路径（方法论 §2 手段 3）
- `<next-action>` 由状态优先级求值：pending > cron incident > inbox > 无（则给"按域路由"的中性提示）
- **不含** AGENTS.md 任何正文（B2.4）

### 3.2 `turn` 的条件性输出

```
有 pending / incident  → <jspace-state>pending: 2 笔待落盘（jspace pending apply）</jspace-state>
干净工作台             → 零输出，exit 0
```

理由见 `prd.md` D2：JSpace 无任务状态机，每 turn 注入路由表是纯噪音。
**这是本设计与 Trellis 的第二处刻意分歧**（第一处是子命令 vs 脚本）。

### 3.3 体积预算

| 项 | 上限 | 超限行为 |
|---|---|---|
| 域清单 | 12 个 | 超出显示前 12 + `（另有 N 个，见 .jspace/hub.json）` |
| `<available>` 路径 | 12 条 | 同上 |
| session-start 总字节 | 4 KiB | 逐块降级为路径清单，**不截断丢字** |
| turn 总字节 | 512 B | 只保留最高优先级一条 |

对应方法论 §6 的"溢出降级成索引行而不是截断丢失"。

## 4. 输出契约

### 4.1 CLI 层

`CmdResult.lines` → stdout（`cli/main.ts:45`）。`context` 的 handler 返回

```ts
{ lines: [JSON.stringify(envelope)], exitCode: 0 }   // 默认
{ lines: [plainText], exitCode: 0 }                  // --plain
{ lines: [], exitCode: 0 }                           // 闸门拦下 / turn 无状态
```

**永远 `exitCode: 0`**。handler 内部 try/catch 兜住一切；不得让 `CliError` / `ArgError` 逃出。

### 4.2 hook 信封

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<payload>"
  }
}
```

`envelope.ts` 按 harness 分支（当前只有 Claude Code；方法论 §1c 记录了
Cursor 用顶层 `additional_context`、Gemini 事件名是 `BeforeAgent`、Kiro 要裸文本、
ZCode 不能双发 —— 这些**现在不实现，但信封函数签名要能容纳**）。

### 4.3 settings.json 接线

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "command": "jspace context session-start 2>/dev/null || true", "timeout": 10 }] },
      { "matcher": "clear",   "hooks": [{ "type": "command", "command": "jspace context session-start 2>/dev/null || true", "timeout": 10 }] },
      { "matcher": "compact", "hooks": [{ "type": "command", "command": "jspace context session-start 2>/dev/null || true", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "jspace context turn 2>/dev/null || true", "timeout": 5 }] }
    ]
  }
}
```

- `|| true` 是**必须**的：`UserPromptSubmit` 的 exit 2 在 Claude Code 有"阻断本轮提示"的特殊语义，
  而 `jspace` 未知子命令走 `ArgError` → exit 2。版本错配时不能把用户的会话卡死
- 现有的 `jspace cron check` hook **删除**，其内容并入 session-start payload（B2.5）
- 该文件 ownership 为 `seed`：用户改过则升级保留 `skip`，不覆盖

## 5. 闸门顺序（`gate.ts`）

```
1. JSPACE_HOOKS=0                          → 静默退出
2. 任一 *_NON_INTERACTIVE=1                → 静默退出
3. 向上找不到工作台 marker（.jspace/marker.json） → 静默退出   ← 非工作台目录
4. turn 且 prompt 含 no-jspace（word-boundary） → 静默退出
5. 采集状态；任何单项失败 → 该项省略，其余继续
6. 注册表损坏（hub.json 非法 JSON）        → 输出一行可见告警（不静默）
```

第 3 条向上遍历目录树找 marker（对应 Trellis 的 `find_trellis_root`，方法论 §4），
支持从 `workspace/<domain>/` 子目录启动会话。

第 6 条是方法论 §3 的纪律："降级要可见，不要静默兜底"——
Trellis 的注释原话是让用户 "see (and fix) the broken state instead of the hook silently masking it"。

## 6. 超时与容错

| 调用 | 超时 | 失败行为 |
|---|---|---|
| 读 `hub.json` / `cron.json` | 无（本地小文件） | 损坏 → 告警行；缺失 → 该项省略 |
| 扫 filehub `_inbox` | 1s | 省略该行 |
| pending 扫描 | 1s | 省略该行 |
| cron incident 读取 | 1s | 省略该行 |
| **session-start 总预算** | **5s** | 超时输出已采集到的部分 |
| **turn 总预算** | **1s** | 超时零输出 |

**本设计不调用 gbrain**。理由：gbrain 可能未安装/未接线/持锁，
调用它会把 hook 的失败面和延迟大幅放大，与 B4.5 冲突。
"活跃项目"这类需要 gbrain 的状态留待后续评估（记入 §9 开放问题）。

## 7. 测试策略

`collect.ts` / `payload.ts` / `gate.ts` 全部为纯函数或依赖注入，直接单测：

- 空工作台（无域、无 pending）→ payload 只有 `<jspace-workbench>` + 中性 `<next-action>`
- 有 3 域 + 2 pending + 1 incident → 各行齐备、`<next-action>` 命中 pending 优先级
- `hub.json` 非法 JSON → 含告警行且不抛异常
- 20 个域 → 截到 12 + "另有 8 个"提示
- 超 4 KiB → 逐块降级
- 闸门六条各自命中 → 零输出
- `turn` 干净工作台 → 空数组

端到端：`bun run cli/main.ts context session-start --plain --dir /tmp/<fixture>`。

## 8. 影响面与回滚

| 面 | 影响 |
|---|---|
| 既有工作台 | `.claude/settings.json` 是 seed：未改过则 upgrade 刷新；改过则 `skip`（用户需手工合并，doctor 可提示） |
| 现有 cron check hook | 被替换；`jspace cron check` 命令本身保留（用户仍可手工跑） |
| 二进制 | 新增一个命令族，体积影响可忽略 |
| 非 Claude harness | 无影响（未接线） |

回滚：`.claude/settings.json` 去掉两个 hook 即完全退回现状；`jspace context` 命令留着无害。

## 9. 开放问题（implement 阶段或后续任务处理）

- **O1** `.claude/settings.json` 已被用户改过的既有工作台，upgrade 会 `skip`，
  hook 装不上。是否需要 doctor 加一条 `hooks.not_wired` 诊断提示手工合并？
  —— 倾向**需要**，建议并入本任务 S5。
- **O2** "活跃项目"（gbrain `project/<id>/state`）是最有价值的状态，但依赖 gbrain 可用。
  本轮不做。若后续要做，须以"超时即省略"的可选项形式接入，不得让 hook 依赖 gbrain 健康。
- **O3** cron 无头会话（`claude -p`）是否触发 SessionStart hook。**已实测（专家审查确证）：触发**。
  无头 claude -p 的 hook 子进程 env 不设置任何 `*_NON_INTERACTIVE` 变量，hook 照常触发并注入状态。
  （我初版 S7.1 实测「不触发」是误判——当时 PATH 上的 `jspace` 是旧版 1.0.8，无 `context` 子命令被 `|| true` 吞掉。）
  **结论**：cron 三个任务的 prompt 保留显式 `先跑 jspace context session-start --plain` 作**确定性兜底**
  （hook 触发依赖 claude 版本/环境，cron 不赌它）；与 hook 注入构成双份，成本 ~1KB/任务，可接受。
  `nonInteractive()` 仅对显式设置 `*_NON_INTERACTIVE=1` 的环境生效，claude -p 不会自动设置。
