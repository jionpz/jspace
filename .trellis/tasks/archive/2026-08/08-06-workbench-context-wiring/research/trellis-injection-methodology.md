# Trellis 上下文注入方法论提取（给 JSpace 借鉴）

> 调研对象：本仓库已安装的 Trellis `0.6.12`（`.trellis/.version`）。
> 调研方式：直接读源码，每条结论带 `文件路径:行号` 证据。标「推测」的是未经验证的判断。
> 产出目的：JSpace 工作台的 `AGENTS.md` + `.jspace/skills/` 在 Claude Code 会话里**完全不注入**，
> 需要照 Trellis 的机制重做通路。本文只提取方法论，具体落地方案见 `../design.md`。

---

## 0. 一句话结论

**Trellis 从不指望 memory 文件（`CLAUDE.md` / `AGENTS.md`）被读取。它把所有上下文改由 hook 主动推送，
memory 文件只是可选的补充。** JSpace 恰好反过来——把全部路由押在一个 harness 不读的文件上。
这是两者体验差异的全部根因。

---

## 1. 注入点：三个 hook，零 memory 文件依赖

`.claude/settings.json` 是全部接线（无省略）：

| Hook 事件 | matcher | 脚本 | 职责 |
|---|---|---|---|
| `SessionStart` | `startup` / `clear` / `compact` | `.claude/hooks/session-start.py` | 会话级：全局地图 + 当前位置 |
| `UserPromptSubmit` | （无 matcher，每 turn） | `.claude/hooks/inject-workflow-state.py` | turn 级：下一步该干什么 |
| `PreToolUse` | `Task` / `Agent` | `.claude/hooks/inject-subagent-context.py` | 子代理级：把任务上下文塞进子代理首轮 |

三个关键设计：

**a) `SessionStart` 注册了三个 matcher，不只是 `startup`。**
`clear` 和 `compact` 也重新注入——这意味着 `/clear` 之后、以及上下文被压缩之后，
状态会重新到达。这是 memory 文件做不到的（官方文档：只有项目根 `CLAUDE.md` 在 compact 后重新注入，
嵌套的和 path-scoped rules 都不会）。

**b) 注入走 `hookSpecificOutput.additionalContext` JSON 返回值**，不是往文件里写。
`session-start.py:843-860`：

```python
result: dict[str, object] = {
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context_text,
    },
}
if platform != "zcode":
    result["additional_context"] = context_text   # Cursor 用 top-level snake_case
print(json.dumps(result, ensure_ascii=False), flush=True)
```

**c) 同一份脚本服务 10+ 个 harness**，靠运行时探测分支（`_detect_platform`,
`session-start.py:194-235`）：先看 `input_data["cursor_version"]`，再看 10 个
`*_PROJECT_DIR` 环境变量，最后看 `sys.argv[0]` 路径里含哪个 `.claude` / `.codex` / `.gemini` …。
平台差异只在输出层收敛：

- Kiro 把 hook stdout 直接当上下文 → 输出裸文本，不包 JSON（`session-start.py:838-840`）
- Gemini CLI 0.40.x 把 per-turn 事件改名 `BeforeAgent`，schema 校验会拒绝旧名
  （`inject-workflow-state.py:450-452`）
- ZCode 同时读 `hookSpecificOutput.additionalContext` 和顶层 `additional_context`
  且不去重 → 只能发一个，否则上下文翻倍（`session-start.py:851-857`）

---

## 2. SessionStart 注入的是「状态 + 索引」，不是「文档」

payload 结构（`session-start.py:785-831`），六个块各司其职：

| 块 | 内容 | 性质 |
|---|---|---|
| `<session-context>` | 一句话说明"这是紧凑上下文，细节按需加载" | 静态 |
| `<first-reply-notice>` | 要求首条可见回复确认注入成功，并规定用什么语言确认 | 静态·一次性 |
| `<current-state>` | developer / git branch+dirty / 当前任务+status / 活跃任务数 / journal 行数 / spec index 数 | **动态** |
| `<trellis-workflow>` | **只有 Phase Index 摘要** + 一行"详情用 CLI 取" | 静态·截取 |
| `<guidelines>` | 上下文加载顺序 + 可读索引的**路径清单** | 静态+动态 |
| `<task-status>` | 当前任务状态 + **`Next-Action:` 一句话下一步** | **动态** |
| `<ready>` | 收尾指令："Follow `<task-status>`，其余按需加载" | 静态 |

### 体积控制的四个手段（最值得抄的部分）

**手段 1：截取而非全文。** `_build_workflow_overview`（`session-start.py:718-734`）
函数注释就写着 "Inject only the compact Phase Index summary for SessionStart"，
实现是 `_extract_range(content, "Phase Index", "Phase 1: Plan")` —— 只取两个 `##` 标题之间的部分，
`workflow.md` 全文留在磁盘，配一行取详情的命令。

**手段 2：主动剔除会重复的部分。** `_strip_breadcrumb_tag_blocks`
（`session-start.py:703-715`）把 `[workflow-state:STATUS]...[/workflow-state:STATUS]`
标签块从 SessionStart payload 里删掉。函数注释说明了原因：这些块是给 UserPromptSubmit hook 用的，
"re-inlining the breadcrumbs here would just duplicate context"。
**两层注入之间做了显式去重设计**，不是各写各的。

**手段 3：给路径不给内容。** spec 只列索引路径（`session-start.py:813-817`）：

```python
if spec_index_paths:
    output.write("## Available indexes (read on demand)\n")
    for p in spec_index_paths:
        output.write(f"- {p}\n")
```

**手段 4：按当前任务缩小范围。** monorepo 下 `_resolve_spec_scope`
（`session-start.py:522-578`）按 active task 的 `package` 字段过滤该注入哪些 spec，
配置 `spec_scope: active_task` 时只注入当前包的索引。

### `Next-Action` 是最有价值的一行

`_get_task_status`（`session-start.py:339-429`）不只报状态，还按「状态 × 产物存在性」算出下一步。
状态机分支覆盖：无任务 / 指针失效(stale) / completed / planning 无 prd / planning 有 prd。
例如 planning 且缺 design.md：

```
Next-Action: Lightweight task can request start review with PRD-only;
complex task must add design.md, implement.md before start;
curate `implement.jsonl` and `check.jsonl` before sub-agent mode start.
Do not enter implementation until the user confirms start.
```

**这是「路由」的正确形态**：不是把规则表贴给 AI 让它自己查，而是在注入时就把规则**求值完**，
只给结论。JSpace 的 AGENTS.md 现在是前者（贴一张 Daily Work Intake 表让 AI 自己对）。

---

## 3. per-turn breadcrumb：状态机的当前格 + 单一事实源

`inject-workflow-state.py` 每个 turn 注入一个 `<workflow-state>` 块：

```
<workflow-state>
Task: 08-06-workbench-context-wiring (planning)
Load `trellis-brainstorm`; stay in planning.
Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`…
</workflow-state>
```

**文本来源唯一**：从 `workflow.md` 里解析 `[workflow-state:STATUS]…[/workflow-state:STATUS]`
标签块（`_TAG_RE`, `inject-workflow-state.py:181-184`；`load_breadcrumbs`, line 186-209）。

**刻意不做 fallback**。脚本 docstring（line 13-18）明确写了设计意图：

> Breadcrumb text is pulled exclusively from workflow.md `[workflow-state:STATUS]` tag blocks
> — workflow.md is the single source of truth. There are no fallback dicts in this script:
> when workflow.md is missing or a tag is absent, the breadcrumb degrades to a generic
> "Refer to workflow.md for current step." line **so users see (and fix) the broken state
> instead of the hook silently masking it.**

这条纪律值得单独记：**降级要可见，不要静默兜底。**

**escape hatch**：prompt 里出现 `no-trellis`（word-boundary 匹配，`no-trellisfoo` 不算）
则该 turn 跳过注入（`prompt_has_skip_keyword`, line 250-260；可在 `config.yaml`
的 `prompt_injection.skip_keyword` 改，设 `""` 彻底关闭）。

### 为什么需要两层

| | SessionStart | UserPromptSubmit |
|---|---|---|
| 频率 | 每会话 1 次（+clear/compact） | 每 turn |
| 内容 | 全局地图 + 当前位置 | 当前格 + 下一步 |
| 抗稀释 | 差（对话越长越远，可能被 compact） | 好（永远在最近处） |
| 体积预算 | 可以稍大（一次性） | 必须极小（乘以 turn 数） |

单靠 SessionStart：长会话后期 AI 会忘记流程约束。
单靠 per-turn：每 turn 重复注入全局地图，token 成本线性爆炸。
所以是「大的注一次 + 小的每次注」，且两者显式去重（见手段 2）。

---

## 4. 可靠性工程：hook 永不阻断会话

这部分是 Trellis 明显打磨过的，逐条抄成 JSpace 的验收项：

| 问题 | Trellis 的处理 | 证据 |
|---|---|---|
| 无头/CI 环境不该注入 | 10 个平台的 `*_NON_INTERACTIVE=1` + `TRELLIS_HOOKS=0` / `TRELLIS_DISABLE_HOOKS=1` 总开关 | `session-start.py:129-149` |
| Windows 中文乱码 | 对 stdin/stdout/stderr 逐个 `reconfigure(encoding="utf-8")`，等价 `python -X utf8` 但不依赖 host 命令行 | `session-start.py:86-101` |
| Git Bash/Cygwin/WSL 路径 | `_normalize_windows_shell_path` 把 `/c/…`、`/cygdrive/c/…`、`/mnt/c/…` 归一成 `C:\…` | `session-start.py:22-67` |
| 从子目录启动 | `find_trellis_root` 向上走目录树直到找到 `.trellis/` | `inject-workflow-state.py:77-88` |
| host 不关 stdin 导致 hook 挂死 | 线程读 stdin + `queue.get(timeout=0.2)`，超时返回 `{}` | `inject-workflow-state.py:364-394` |
| 任何子步骤失败 | 一律吞异常返回降级值（`"No context available"` / `return 0`），**从不抛到 host** | `session-start.py:305-307`、`run_script` 全函数 |
| 子进程卡住 | `subprocess.run(..., timeout=5)`；git 探测 `timeout=3` | `session-start.py:295-304`、`166-181` |
| hook 拿到的 session 身份传不到后续 Bash | 往 `$CLAUDE_ENV_FILE` 追加 `export TRELLIS_CONTEXT_ID=…`，后续 Bash 工具可见 | `session-start.py:247-264` |

`settings.json` 里三个 hook 分别设了 `timeout` 30/30/15 秒——per-turn 的那个更短。

---

## 5. 多-harness 物化：同一份字节，多个目录

实测四套 skill 目录：

```
.claude/skills/    13 个
.agents/skills/    12 个
.opencode/skills/   9 个
.codex/skills/      1 个   ← codex 走 .codex/agents/*.toml，不用 skills
```

同一个 skill 在三套目录里**字节完全相同**（`trellis-check/SKILL.md` 三处 md5 均为
`1747e65dd8bd3d23c479aa1337a63fd2`，2814 bytes）。frontmatter 只有 `name` + `description`，
**没有 harness 差异字段**——差异全部收敛在"放哪个目录"，内容零分叉。

除 skills 外，Trellis 还物化了另外三类官方扩展点：

```
.claude/agents/trellis-{implement,check,research}.md   ← 子代理定义
.claude/commands/trellis/                              ← slash commands
.claude/hooks/{session-start,inject-workflow-state,inject-subagent-context}.py
```

即 **Claude Code 的四个官方扩展点（skills / agents / commands / hooks）Trellis 全用上了**。
JSpace 目前只用了 hooks 的一个，且只用来跑 `cron check`。

漂移检测：`.trellis/.template-hashes.json`（与 JSpace 的
`cli/manifest.generated.ts` 每文件 `sha256` + `ownership` 同构，机制上 JSpace 这块已经够用）。

---

## 6. 子代理注入：清单 + 上限 + 溢出降级

`inject-subagent-context.py` docstring 写明设计哲学：

> - Hook is responsible for injecting all context, subagent works autonomously with complete info
> - Each agent has a dedicated jsonl file defining its context
> - **No resume needed, no segmentation, behavior controlled by code not prompt**

上下文来源：`implement.jsonl` / `check.jsonl`（每个子代理一份清单）+ `prd.md` / `design.md` /
`implement.md`。配额在 `config.yaml` 的 `context_injection`：

```
max_file_bytes: 32768      # 单个 jsonl 引用文件
max_artifact_bytes: 65536  # 单个任务产物
max_total_bytes: 131072    # 整个 payload；超了之后剩余文件降级成 index line（路径+原因+大小）
```

**溢出降级成索引行而不是截断丢失**——和 §2 手段 3 是同一个思路。

> 对 JSpace 的相关性：低。工作台不做子代理分派。**不适用**，除非将来 cron 无头任务要注入上下文
> （那时可复用同一套 payload 生成器）。

---

## 7. 可迁移性分类

| # | 机制 | 分类 | 说明 |
|---|---|---|---|
| 1 | 三 hook 注入点（SessionStart / UserPromptSubmit / PreToolUse） | **可借鉴** | 纯 harness 官方机制，与实现语言无关 |
| 2 | SessionStart 注册 `clear` + `compact` matcher | **可借鉴** | 一行配置，收益大 |
| 3 | payload 分块 + `Next-Action` 求值 | **可借鉴** | 需按 JSpace 语义重设计块，机制照搬 |
| 4 | 截取/剔重/给路径/按任务缩范围 四个体积手段 | **可借鉴** | 直接照抄思路 |
| 5 | per-turn breadcrumb 单一事实源 + 无 fallback + 可见降级 | **可借鉴** | JSpace 的事实源应是 `AGENTS.md` 块 或 `hub.json` |
| 6 | escape hatch 关键词 | **可借鉴** | JSpace 用 `no-jspace` |
| 7 | 可靠性七条（§4 表格） | **可借鉴** | 逐条转成验收项 |
| 8 | 多-harness 同字节物化 | **可借鉴** | JSpace 已有 `materializeTree`，加目标目录即可 |
| 9 | 四个官方扩展点全用 | **需改造** | JSpace 不需要 commands/agents；skills + hooks 足够 |
| 10 | python hook 脚本 | **不适用·JSpace 有更优解** | 见下 |
| 11 | 子代理 jsonl 清单 + 配额 | **不适用** | 工作台无子代理分派 |
| 12 | 任务状态机（planning/in_progress/…） | **需改造** | JSpace 无任务概念；对应物是"当前域 / 活跃项目 / pending 写" |

### 第 10 条要展开：JSpace 不该抄 python 脚本

Trellis 必须 ship `.py` 脚本，因为它没有自己的可执行文件——它是一套模板 + 脚本。
代价是：依赖机器上有 `python3`、脚本内容随模板分发要做漂移检测、跨平台编码/路径问题得在
python 层逐个手工处理（§4 表里一半的条目是在补这个）。

JSpace 的情况相反：`jspace` 是 **bun 编译的单文件二进制、已在 PATH 上**。所以 hook 应该写成

```json
{ "type": "command", "command": "jspace context session-start", "timeout": 10 }
```

而不是 ship 脚本。收益：

- 零运行时依赖（不需要 python3）
- 编码/路径归一化由 bun runtime 负责，不用手写 `_normalize_windows_shell_path`
- payload 生成逻辑进 `application/`，**可以写单元测试**（Trellis 的 hook 脚本没有测试覆盖）
- 升级时 hook 命令字符串不变，逻辑随二进制走，不产生模板漂移
- `.claude/settings.json` 保持 seed 所有权即可，无需新增 managed 文件树

代价：hook 与 CLI 版本耦合（用户升级 jspace 后 hook 行为变化）。
缓解：`jspace context` 子命令对未知参数必须**优雅降级并 exit 0**，
按 §4 "hook 永不阻断会话" 的纪律执行。

---

## 8. 对 JSpace 的可迁移清单（Trellis 怎么做 → JSpace 该怎么做）

| Trellis | JSpace 对应动作 | 落点 |
|---|---|---|
| 不依赖 memory 文件，hook 推送 | 保留 `AGENTS.md` 作人类可读事实源，但**路由不再依赖它被注入** | 新增 `jspace context` 子命令 |
| — （Trellis 无此问题） | 工作台根加 `CLAUDE.md`，内容一行 `@AGENTS.md` | `templates/workbench/CLAUDE.md`（seed） |
| 同字节物化到 `.claude/skills/` 等 | 官方 skill 除 `.jspace/skills/` 外，同字节物化到 `.claude/skills/` | `cli/embed.ts:102` 附近加分支 |
| `SessionStart` 三 matcher | `startup`/`clear`/`compact` 都注入；现有 `cron check` 合并进同一 payload | `templates/workbench/.claude/settings.json` |
| `<current-state>` 动态状态 | 当前域 / 活跃项目（gbrain `project/*/state`）/ hub 域资源数 / pending 暂存写 / cron 失败 | `jspace context session-start` |
| `<task-status>` + `Next-Action` | 把 Daily Work Intake 表**求值**成一句下一步，而不是贴表 | 同上 |
| `<trellis-workflow>` 只注 Phase Index | 只注入域清单 + skill 名录，不注入 AGENTS.md 全文 | 同上 |
| `## Available indexes (read on demand)` | 列 `workspace/<domain>/README.md` 路径清单，不列内容 | 同上 |
| per-turn `<workflow-state>` | per-turn 注入极短路由提示（当前域 + 未完成 pending）；无事则不注入 | `jspace context turn` |
| breadcrumb 单一事实源 | 文本源 = `AGENTS.md` JSPACE 块内的标记段，不在代码里写死 | 待 design 定 |
| 无 fallback、降级可见 | `jspace context` 找不到工作台 → 静默 exit 0；找到但注册表坏 → **注入一行可见告警** | 同上 |
| `TRELLIS_HOOKS=0` | `JSPACE_HOOKS=0` + 复用 `*_NON_INTERACTIVE` 探测 | 同上 |
| `no-trellis` 关键词 | `no-jspace` | 同上 |
| `.template-hashes.json` | 已有 `manifest.generated.ts`（sha256+ownership），新增文件按 seed 登记即可 | `scripts/gen-assets.ts` 自动 |
| 四扩展点全用 | 只用 skills + hooks；**不做** commands/agents | — |

### 顺带解锁的两个已知缺陷

1. **cron 契约失效**：`.jspace/cron.json` 三个任务的 prompt 都写"按 AGENTS.md 路由"，
   而 `claude -p` 无头模式同样不读 AGENTS.md。hook 通路做完后，无头会话也能拿到
   `<current-state>`，契约才真正成立。
2. **AGENTS.md 可以瘦身**：官方 skill 发现机制接管后，
   `<!-- TRELLIS-SKILL-GOV -->` 和 `<!-- TRELLIS-BRAIN-OPS -->` 两段渲染块
   （约 15 行，占 JSPACE 块 1/7）对 Claude Code 变成纯冗余——它们的作用是帮 AI 选 skill，
   而官方 selector 会直接读 `.claude/skills/*/SKILL.md` 的 frontmatter。
   （注意：gbrain resolver 仍解析 Brain operations 段，**不能直接删**，需确认 gbrain 侧影响。）

---

## 9. 未验证事项（后续需确认）

- `.claude/commands/trellis/` 的生成逻辑未读（对 JSpace 不相关，跳过）。
- Trellis 的 `writeSharedHooks()` 实现在 Trellis 分发包内，本仓库只有其产物；
  「同一份 hook 写到各平台 hooks 目录」是从产物**推断**的，未见生成代码。
- Claude Code 是否对 `.claude/skills/` 下的 symlink 目录正常发现——官方文档确认
  `.claude/rules/` 支持 symlink，skills 未明说。**JSpace 采用复制而非 symlink，规避该不确定性。**
- `<first-reply-notice>` 这类"要求 AI 确认注入成功"的做法是否值得抄：
  优点是用户能立刻看出通路是否通，缺点是每会话多一句话。建议 JSpace 只在
  `jspace doctor` 里提供一次性自检，不做每会话确认。
