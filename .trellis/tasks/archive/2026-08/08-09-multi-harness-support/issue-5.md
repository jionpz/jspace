# Multi-Harness Support: Claude Code / OpenCode / Pi / Grok Build — 构建方案

> 目标：工作台外接 harness 支持从「Claude 全接、Codex argv、Pi 只有 argv、无 Grok」
> 演化为「4 个 harness 深度对齐、能力差异显式声明、文档与 CI 同步断言支持集」。
> Trellis 的做法被吸收为架构思想，不引入其任务管理。
> 基线：HEAD `d143e79`,bun test 432/0 fail、tsc、check-skills 全绿。

---

## 一、定位与三个梯队

四 harness 站在**三个完全不同的能力梯队**上，这决定各自的支持形态，而不是「表面四个一样支持」。

| 梯队 | Harness | 它的记忆能力 | 你的角色 |
|---|---|---|---|
| **T1 原生记忆系统** | **Grok Build** | 自带完整 memory 子系统：`~/.grok/memory/` markdown + SQLite(vec0+FTS5)hybrid search、auto `save_on_end`、**首 turn 自动注入**、compaction 前自动 `memory_flush`、`/dream` auto consolidation、temporal decay、MMR、文件 watcher | **桥接 / 对接**,gbrain 保持权威 |
| **T2 Hook 接线(最成熟)** | Claude Code | SessionStart / UserPromptSubmit / PreCompact / Stop / SessionEnd hooks + `.claude/skills/` + MCP | 已是参考实现 |
| **T2.5 Plugin 接线(事件更细)** | OpenCode | plugin(JS/TS)+ 细粒度事件(`session.idle` / `session.created` / `session.compacted` / `tool.execute.*` / `experimental.session.compacting` 可注入 compaction prompt)+ `.opencode/skills/` + `.agents/skills/` | 用 plugin 重建「Claude 等价」 |
| **T3 文档素人** | Pi | hooks/skills 通道在仓库中无 grounding,`argv.ts:23` 只有 `pi -p` | 先补能力观察，再决定深度 |

**核心架构教训**：把 harness 差异当成「发射器不同」,把 jspace use case 当成「协议相同」。每个 emitter(Claude hook JSON / OpenCode plugin TS / Grok hook JSON / 未来 Pi wrapper)对应到同一套 use case(`context session-start` / `memory-writeback` / `memory-recall` / `cron run`)。

---

## 二、Grok Build 的关键决策（拍板后才能动设计）

Grok Build 原生 memory 与你的 gbrain **逐项 1:1 同构**:

| Grok 原生 | 你的 | 同构 |
|---|---|---|
| `~/.grok/memory/MEMORY.md` 全局 + `~/.grok/memory/<project-slug>-<hash>/MEMORY.md` 项目 | gbrain `project/<id>/state` + `knowledge/<主题>` | 层级一致 |
| `/flush` 手动 / `[compaction.memory_flush]` PreCompact 自动 | `memory-writeback`(收工) | Grok 的 flush 已是"自动收工" |
| `/dream` auto cons. (session end,`memory.dream`) | `memory-consolidate`(cron) | 都是定期归纳 |
| `MEMORY.md` hybrid 检索(vector 0.7 + BM25 0.3)+ temporal decay | `memory-recall` | 检索层能力重叠 |
| SessionStart / UserPromptSubmit / PreCompact / Stop / SessionEnd hooks | 你的 Claude 接线 | **hook 事件集对齐，且 Grok 认 `.claude/settings.json` 路径** |

**决策(必须拍板)**:

| 选项 | 含义 | 取舍 |
|---|---|---|
| **A. Grok native 独立,gbrain 不参与 Grok** | Grok 用户用 Grok memory,Claude/Codex/OpenCode/Pi 用户用 gbrain;两路互不通 | 消灭 90% 的 gbrain 工作，但你放弃了「跨 harness 一份记忆」的核心承诺；Grok 用户切 Claude 会失忆 |
| **B. gbrain 权威,Grok native 是 Grok-only UX(推荐)** | Grok 也接 gbrain(MCP),gbrain 仍是唯一事实源；Grok native memory 只是 Grok 内的 UX 便利，不参与 gbrain slug 生命周期 | 保留跨 harness 一致性；Grok hook 需在 PreCompact/`/flush` 时往 gbrain state 也写一份；要写 bridge |
| **C. Grok native 替代 gbrain(对 Grok)** | 把 Grok 的记忆权威切换到 Grok native;gbrain 只对其它三个 harness 提供 | Grok 的记忆体验最好，但你的记忆层从"一份"变"多份";Grok Build 的 memory 还是 experimental+默认关闭，押注风险大 |

**推荐 B**(理由：跨 harness 一份记忆是产品定位;Grok memory 默认关闭，押一个 experimental feature 太重；Grok 的 hook 系统兼容 Claude,bridge 工作量小)。

若无异议，以下方案按 B 展开；如选 A 或 C，方案在 Grok 一节相应收窄。

---

## 三、架构核心：`capabilities.yaml` 作为单一事实源

这是 Trellis 最该借的模式。当前三平台 argv 是 hard switch(`adapters/harness/argv.ts`)，能力矩阵在 markdown 手维(`skills/jspace-use/references/harnesses.md:90-92`)，文档/代码/CI 会漂移。

### 落地形态

新文件 `adapters/harness/capabilities.yaml`:

```yaml
# adapters/harness/capabilities.yaml — single source of truth for harness support.
# Consumers: argv.ts / doctor.ts / docs generation / CI assertions.
# Adding a 5th harness = adding an entry here; no code change outside this file.

schema_version: 1

harnesses:
  claude:
    headless: ["claude", "-p"]
    argv_flags:
      permission: "--allowedTools"
      tools_value: "Bash,Read,Write,Edit,mcp__gbrain__*"
      output: "--output-format"
      output_value: "text"
    sessions:
      - SessionStart
      - UserPromptSubmit
      - PreCompact
      - Stop
    mcp: true
    skills_projection:
      - .claude/skills         # 当前已有
      - .agents/skills         # 当前已有
    hook_format: claude_settings_json    # .claude/settings.json{hooks: {...}}
    native_memory: false
    cron_harness_enum_value: claude

  grok:
    headless: ["grok", "-p"]
    argv_flags:
      permission: "--allow"
      tools_value: "Bash(*)"
      output: "--output-format"
      output_value: "json"
    sessions:
      - SessionStart      # 同名事件,compat.claude 默认认
      - UserPromptSubmit
      - PreCompact
      - Stop
      - SessionEnd        # Grok 独有,Claude 没有
    mcp: true
    skills_projection:
      - .grok/skills
      - .agents/skills     # Grok 也认这个
      - .claude/skills     # Grok 兼容扫描
    hook_format: grok_hooks_json        # .grok/hooks/*.json;兼容 .claude/settings.json
    native_memory: full    # Grok Build 原生 memory 子系统(experimental)
    cron_harness_enum_value: grok

  opencode:
    headless: ["opencode", "run"]
    argv_flags: {}  # opencode run 接受 prompt 作为 positional 或 --prompt
    sessions:
      - session.created
      - session.idle            # 比 Claude SessionEnd 更精确的"工作结束"
      - session.compacted
      - experimental.session.compacting   # 可注入 compaction prompt
    mcp: true
    skills_projection:
      - .opencode/skills
      - .agents/skills     # OpenCode 也认这个
    hook_format: opencode_plugin_ts    # .opencode/plugins/*.ts(JS/TS 模块)
    native_memory: false
    cron_harness_enum_value: opencode

  pi:
    headless: ["pi", "-p"]
    argv_flags: {}
    sessions: []           # 文档未 grounding,先空
    mcp: false
    skills_projection:
      - ~/.pi/skills        # 待验证
    hook_format: none
    native_memory: none
    cron_harness_enum_value: pi
```

### 消费方改造

| 现在 | 改成 |
|---|---|
| `adapters/harness/argv.ts` `switch (harness)` | 读 `capabilities.yaml`,按 `headless` + `argv_flags` 组装 argv;unsupported → 报"cron.harness 不支持;< harness>"。现 `harness.ts` 薄化为 adapter 集合 barrel export。 |
| `application/diagnostics/doctor.ts` 新增 `checkHarness` | 对 capabilities.yaml 里每个 harness:headless 在 PATH 上?hook 文件已写?skill 投影到所在的所有 `skills_projection` 目标?capabilities.native_memory 与 user cron harness 匹配?drift → doctor warning。 |
| `templates/workbench/.jspace/cron.json` | `cron.harness` enum 从 `["claude", "codex", "pi"]` 扩成 `["claude", "codex", "grok", "opencode", "pi"]`(CronDefinition 契约同步)。 |
| `skills/jspace-use/references/harnesses.md` | 拆成 `harness-claude.md` / `harness-grok.md` / `harness-opencode.md` / `harness-pi.md`,each 按该 harness 的真实能力写。`harnesses.md` 只留一张**自动生成**的全景表(由 capabilities.yaml render)。 |
| CI verify.yml | 加 "harness capability 与 capabilities.yaml 同步" 检查：从代码 grep 出所有 `[claude` 等 literal、skill 目录 literal、cron harness enum literal,断言它们与 capabilities.yaml 一致。防"加了 Grok 支持但忘更新 docs" 类漂移。 |

---

## 四、按 harness 的实现计划

### Phase 1: capabilities.yaml + argv/doctor 改造（架构基石，1 天）

不管先做哪个 harness，先把 harness 支持「数据化」。这步不动任何功能，只是把现状(3 个 harness 的 hard switch）迁到 capabilities.yaml。**先上，因为它让后面所有 harness 变数据。**

#### 4.1.1 落地动作

```
新增:adapters/harness/capabilities.yaml  (见 III)
新增:adapters/harness/types.ts
  - HarnessCapability type(headless/argv_flags/sessions/mcp/skills_projection/
    hook_format/native_memory/cron_harness_enum_value)
新增:adapters/harness/registry.ts
  - loadCapabilities(): 从 capabilities.yaml decode + diagnostics 校验
  - get(harness): HarnessCapability | fail(unsupported)
新增:adapters/harness/{claude,grok,opencode,pi,codex}.ts
  - 每个文件 export {
      capability,      // 从 capabilities.yaml 解析
      headlessArgv(prompt, platform),   // 利用 capability 组装
      hookFilePath(workbench, homedir), // 如果有 hook_format
      skillProjectionTargets(workbench),
    }
  - 不再有独立 argv switch;argv.ts 变 thin barrel import 各 adapter

修改:adapters/harness/argv.ts → 删 switch,
      改为 registry.get(harness).headlessArgv(prompt, platform)
修改:application/diagnostics/doctor.ts 加 checkHarness()
修改:templates/workbench/.jspace/cron.json 的 enum 扩到 5 个
修改:core/contracts/cron.ts 的 harness enum 同步("claude"|"codex"|"grok"|"opencode"|"pi")
修改:CLAUDE.md 的 Brain operations 节(link 到 harness-<name>.md)
```

#### 4.1.2 测试

```
新增:adapters/harness/registry.test.ts — yaml decode、unknown harness fail、所有 harness 的 headless argv 组装
保留:adapters/harness/argv.test.ts — 现在只测"registry → 组装"的 wire,不再含平台 switch
新增:application/diagnostics/doctor.test.ts — 每个 harness 至少一个 "ok" 和一个 "drift warning" case
```

#### 4.1.3 验收

```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts cron run <some-cron> --harness claude --dry-run   # 回归
jspace doctor --dir /tmp/jspace-verify                                  # 新增 checkHarness
```

---

### Phase 2: Grok Build 支持(T1，桥接)（按 B 方案，2 天）

Grok 是最有信息量的 harness（原生 memory 存在但默认关、文档 mature)。它的干活量是把 Claude 接线"几乎原封 port"、再加一个 ace —— **PreCompact bridge 让 gbrain 写入可以在 Grok 的 auto flush 时机触发**。

#### 4.2.1 落地动作

```
新增:templates/workbench/.grok/hooks/jspace.json (或 sync 到 .claude/settings.json,
      但分开写 .grok/hooks/*.json 是 Grok 惯用、cascade trust 清楚)
  {
    "hooks": {
      "SessionStart": [{"matcher": "startup|clear|compact|resume",
                         "hooks": [{"type": "command",
                                    "command": "jspace context session-start 2>/dev/null || true",
                                    "timeout": 10}]}],
      "UserPromptSubmit": [{"hooks": [{"type": "command",
                                        "command": "jspace context turn 2>/dev/null || true",
                                        "timeout": 5}]}],
      "PreCompact": [{"hooks": [{"type": "command",
                                  "command": "jspace context pre-compact 2>/dev/null || true",
                                  "timeout": 30}]}],    // 新增 use case;等价于 Grok native flush 时机往 gbrain 写
      "SessionEnd": [{"hooks": [{"type": "command",
                                  "command": "jspace context session-end 2>/dev/null || true",
                                  "timeout": 10}]}]     // 新增 use case
    }
  }

新增:cli/commands/context.ts 加 pre-compact 和 session-end 两个子命令
      (CmdResult 出口,不 console.exit)
新增:application/context/collect.ts 里 preCompact/sessionEnd 事件的 payload 生成
修改:templates/workbench/ 的 README 把 .grok/hooks/ 列入 managed files 清单
      (像 .claude/settings.json 一样的"seed 未修改随升级刷新")
修改:templates/workbench/ 的 git-managed skill 投影清单
      补上 ".grok/skills/" 作为新的投影目标(和 .claude/skills/ .agents/skills/ 并列)
修改:adapters/harness/grok.ts(Phase 1 落)的实现
新增:jspace harness wire --harness grok (等价于现有的 gbrain wire 对 claude,
      把 GBRAIN_SKILLS_DIR env 注入到 Grok 的 MCP 配置里;Grok 的 MCP 配置
      在 ~/.grok/config.toml 的 [mcp_servers.gbrain],格式与 codex/claude 一致)
新增:verify.yml cron 的 --harness grok 冒烟(若 CI 镜像里能装 grok;
      装不了则只测 argv 组装不测实际 spawn)
```

#### 4.2.2 决策点(Bridge B 方案)

**PreCompact hook 的"写 gbrain"语义**": 接到 `jspace context pre-compact` 后,application 要不要**立刻** flush 当前会话的"已完成部分"到 gbrain state?

- 方案 a: 只把"快 compaction 了,如果有需要记忆的事实现请用户触发 memory-writeback"作为 context 注入(被动)
- 方案 b: 在 hook 内**自动**执行 memory-writeback 的 state 简化版(主动)
- 方案 c: 先 a,M7 再做 b(b 更自动但更危险:自动写时机的判断错误会污染 gbrain)

**推荐 a 先**（保守，与现有 jspace"你说收工才写"的纪律一致）,b 留作 M7 的 follow-up feature。c 是当前 issue 的交付物。

#### 4.2.3 测试

```
新增:cli/commands/context.test.ts 的 pre-compact / session-end 子命令断言
新增:adapters/harness/grok.test.ts — hook JSON 结构断言(与 capabilities.yaml 一致)
新增:templates workbench init 后 .grok/hooks/jspace.json 落地的回归测试
```

#### 4.2.4 验收

```bash
# 1. init 出的工作台包含 Grok 接线的"五件套"
bun run cli/main.ts init /tmp/jspace-grok
ls -la /tmp/jspace-grok/.grok/hooks/jspace.json
ls -la /tmp/jspace-grok/.grok/skills/{jspace-use,asset-ingest,...}

# 2. cron 支持 --harness grok
bun run cli/main.ts cron run inbox-tidy --harness grok --dry-run --dir /tmp/jspace-grok

# 3. Grok 真实开启会话时 SessionStart hook 跑(需真实 grok;若 CI 无,人工 verify 文档)
```

---

### Phase 3: OpenCode 支持(T2.5,plugin 驱动)（1.5 天)

OpenCode 的独特之处是**事件更细 + plugin 是 JS/TS 模块** + 有 `experimental.session.compacting` 这个比 Claude PreCompact 更强的注入点（不只是"快 compaction 了"，而是"可以在 compaction prompt 里塞东西")。

这意味着：OpenCode 可以实现出**与 Grok 原生 memory_flush 等价**的能力 — 这正是你在为 Grok 选的 bridge 的另一种实现形态。

#### 4.3.1 落地动作

```
新增:templates/workbench/.opencode/plugins/jspace.ts
  import type { Plugin } from "@opencode-ai/plugin"

  export const JSpacePlugin: Plugin = async ({ directory }) => {
    const wbRoot = directory
    return {
      event: async ({ event }) => {
        // Claude SessionStart → session.created
        if (event.type === "session.created") {
          await Bun.spawn(["jspace", "context", "session-start"], { cwd: wbRoot }).exited
        }
        // 工作结束指示比 Claude 更好的 session.idle — 触发 pending apply / cron check
        if (event.type === "session.idle") {
          await Bun.spawn(["jspace", "pending", "apply", "--quiet"], { cwd: wbRoot }).exited
          await Bun.spawn(["jspace", "cron", "check", "--quiet"], { cwd: wbRoot }).exited
        }
        // compaction 前的 hook(比 Claude PreCompact 更强,可注入)
      },

      // OpenCode 独有:可以在 compaction prompt 里塞 context,
      // 让 compaction 本身"知道"工作台的状态 — 等价于 Grok 的 memory_flush
      "experimental.session.compacting": async (input, output) => {
        const proc = Bun.spawn(["jspace", "context", "session-start", "--plain"], { cwd: wbRoot })
        const text = await new Response(proc.stdout).text()
        output.context.push(text)
      },
    }
  }

新增:templates/workbench/.opencode/skills/<jspace-use|asset-ingest|memory-recall|memory-writeback>/
   (投影目标;跟 .claude/skills/ 一样)
新增:init 时 materialize .opencode/plugins/jspace.ts
修改:templates/workbench/README 把 .opencode/ 加入 managed files 清单
修改:adapters/harness/opencode.ts(Phase 1 落)的实现,
      headless 用 ["opencode", "run"] + prompt stdin(或 positional arg 待验证)
```

#### 4.3.2 决策点

**session.idle 的语义什么时候算"可以自动触发收工"?**
OpenCode 的 `session.idle` 在 AI 每完成一个 turn 时都会 fire（而不只是会话结束）。这意味着如果直接把 `session.idle` → `jspace memory-writeback`，每次 turn 结束都会写回，会写废。
**方案： session.idle 只做 `pending apply` 和 `cron check`（轻量、幂等、失败可忽略），真正写回仍然走显式 `memory-writeback` skill 或者 Grok-compat PreCompact hook。** 保持纪律一致。

#### 4.3.3 测试

```
新增:templates workbench init 后 .opencode/plugins/jspace.ts + .opencode/skills/ 落地的回归测试
新增:plugins/jspace.ts 的 event 分支单测(把 spawn 换成 mock,在 TS 里写)
```

#### 4.3.4 验收

```bash
bun run cli/main.ts init /tmp/jspace-opencode
cat /tmp/jspace-opencode/.opencode/plugins/jspace.ts
ls /tmp/jspace-opencode/.opencode/skills/
```

---

### Phase 4: Pi 支持（先标边界，0.5 天）

Pi 的能力 grounding 现在只有 `argv.ts` 的 `pi -p`。不像 Grok 有完整 docs、OpenCode 有官方 opencode.ai。**Pi 的支持要做的是把"我们目前只能支持到这里"写到明面，不是硬塞半吊子 hook。**

#### 4.4.1 落地动作

```
修改:capabilities.yaml pi 条目 — sessions: [], hook_format: none, native_memory: none
修改:adapters/harness/pi.ts 只实现 headlessArgv,hook 文件 no-op
新增:skills/jspace-use/references/harness-pi.md
  第一节就写:"Pi 当前只支持 cron 无头(harness:pi in cron.json)。
   无 hook/插件通道,意味着:
    - 会话开始没有自动 context 注入(需要你手动跑 jspace context session-start --plain 并把输出贴进会话)
    - 会话结束没有自动 memory-writeback 触发(需要你显式跑对应 skill)
    - 资产入库仍可用 cron + jspace pending 桥接,但 粒度是'一晚上一次'而不是'一会话一次'
   如需 session-level 接线,请选择 Claude Code / Grok Build / OpenCode 之一(见 harness-claude.md 等)。"
```

#### 4.4.2 验收

`capabilities.yaml` 里 Pi 的 sessions 是 `[]`,doctor 在检测到用户用 Pi 时报**清楚的能力边界**而不是假装 hook 生效。

---

### Phase 5：跨 harness 一致性 + 文档 + CI 锁定（0.5 天，收尾）

最后一层是**防漂移**。Trellis 的 `real-world example` 就是它自己漏掉 OpenCode 时被跨层检查抓出来的 — 你要在现在就有这个护栏，不然 6 个月后新增第 5 个 harness 时会重蹈覆辙。

#### 4.5.1 落地

```
修改:skills/jspace-use/references/harnesses.md 只 render 自 capabilities.yaml,
      每行(如"| Claude Code | best_effort |...")由 CI 脚本 render 出来,
      不再手写;markdown 文件 hand-written 部分缩到"架构说明"一段
新增:scripts/check-harness-consistency.ts
  - 扫 skills/jspace-use/references/harness-*.md,断言每个文件只在
    capabilities.yaml 的 harnesses 里出现一次
  - 扫 templates/workbench/.jspace/cron.json 的 enum,断言 ∈ capabilities.yaml keys
  - 扫 adapters/harness/{claude,grok,opencode,pi,codex}.ts 文件名,断言
    ∈ capabilities.yaml keys ∪ {codex}(codex 的 key 是 "codex",仍支持)
  - grep templates/ + skills/,对 "Pi / OpenCode / Grok Build / Claude Code / Codex"
    的手写出现处,断言每个列表 = 全支持集(防止"list 里漏了 Grok")
修改:verify.yml 把 check-harness-consistency.ts 加进 CI
修改:docs/PLATFORMS.md "Cron Harness" 表,也 render 自 capabilities.yaml
```

#### 4.5.2 验收

`bun run scripts/check-harness-consistency.ts` 在本地和 CI 都过；下次有人给 Grok 加了 session-end 支持但忘改 harnesses.md,CI 红。

---

## 五、实施顺序 + 验收矩阵

| Phase | 内容 | 工作量 | 依赖 | 验收 |
|---|---|---|---|---|
| 1 | capabilities.yaml + argv/doctor 数据化 | 1 d | — | tsc + bun test 全过；医生新增 checkHarness |
| 2 | Grok Build(hook 套装 + PreCompact bridge 方案 a) | 2 d | Phase 1 | init 出 Grok 五件套；真实 Grok session hook 触发；cron --harness grok 冒烟 |
| 3 | OpenCode(plugin TS + compacting context 注入) | 1.5 d | Phase 1 | init 出 plugin+skills;OpenCode 无头 import plugin 不炸 |
| 4 | Pi(harness-pi.md 边界文档 + argv only) | 0.5 d | Phase 1 | capabilities.pi.sessions = [],doctor 边界文案清晰 |
| 5 | 防漂移 CI(harness-consistency check) | 0.5 d | 1–4 全 | CI 加 check-harness-consistency；手工制造"list 漏 Grok"断言会红 |

**总工作量 ~5.5 天**(不含 review / CI 等待）。

---

## 六、与现有工作的关系（防重复）

| 已有 | 与本方案的关系 |
|---|---|
| `adapters/harness/argv.ts` 三平台 switch | **被本方案 Phase 1 替换**为 registry + capabilities.yaml |
| `doctor.ts` 现有 checkGBrain / checkCrons | **Phase 1 新增 checkHarness 兄弟** |
| 模板里 `.claude/settings.json` | Phase 2/3 后，**成为五件套之一**(`.claude/settings.json` + `.grok/hooks/jspace.json` + `.opencode/plugins/jspace.ts` + 三处 skills 投影 + hub.json cron enum) |
| `skills/jspace-use/references/harnesses.md` 能力矩阵 | **Phase 5 变成 machine-rendered**，手维部分只留架构说明段 |
| jspace-use / asset-ingest / memory-recall / memory-writeback 的 `~/.agents/skills/` 引用 | 与新投影 `.grok/skills/` `.opencode/skills/` **并存**;`.agents/skills/` 仍是跨 harness 的用户级 canonical |
| R7 分发目标 / M5 双机验证 | 多 harness 支持**扩展**而不是替换；双机协议依然是 gbrain rel_path，与 harness 无耦合 |

---

## 七、不做的事（防止 scope creep)

1. **不引入 Trellis 的任务/task.py/sub-agent dispatch** — 它是 Trellis 的产品本体，不是你的。你只借"capabilities 数据化"和"防跨层漂移"两个模式。
2. **不做第 5 个 harness**(Cursor、Kilo、Antigravity 等都在 #future-backlog)。当前 4 个深度 > 12 个广度。
3. **不改 gbrain 存什么** — 只是给 Grok/OpenCode 加了触发它的 emitter。记忆的 schema、slug 纪律、rel_path 协议，全部不动。
4. **不在 OpenCode plugin 里写长 Python 逻辑** — plugin 只做薄 emit；核心都在 jspace CLI use case 里，保持跨 harness 一致。

---

## 八、关键决策（等你拍板）

| # | 决策点 | 推荐 | 影响 |
|---|---|---|---|
| 1 | Grok native memory vs gbrain 权威 | **B:gbrain 权威,Grok 内 bridge** | 决定 Phase 2 的 hook 形态和后续 Grok 用户体验 |
| 2 | Grok PreCompact hook 写 gbrain 时机 | **a. 被动注入"快 compaction"提醒**(不自动写);b. 主动 flush 留 M7 | 守住"你说收工才写"的纪律；b 太自动有风险 |
| 3 | OpenCode `session.idle` 触发面 | **仅 pending apply + cron check**(轻量幂等),**不**自动 memory-writeback | 同上:OpenCode 的 idle 粒度太细(每 turn),自动写会写废 |
| 4 | Pi 的支持深度 | **harness-pi.md 写明只有 cron argv**,不做假 hook | 诚实标边界 > 假装支持 |
| 5 | 是否一次性把四个 harness 全做 vs 分两批 | **一次性，但按 Phase 1→5 顺序 PR** | 每 Phase 独立可验，review 友好；Phase 1 必须先上 |

这五项都按推荐推进的话，我可以把 Phase 1 的 diff 就写出来。如果你对 1–5 任何一项有不同意见，现在指出，省得后面返工。

---

## 九、参考材料（支撑本方案的文献）

- Grok Build user guide: `~/.grok/docs/user-guide/10-hooks.md` / `13-memory.md` / `14-headless-mode.md` / `08-skills.md`
- OpenCode docs: https://opencode.ai/docs/config/ / https://opencode.ai/docs/plugins/ / https://opencode.ai/docs/skills/
- Trellis 模式： `.trellis/scripts/common/active_task.py`(harness → env session key 映射表)、`.trellis/workflow.md`(capability-by-harness 条件块、`[Claude Code, ...]` 围栏杆)、`.trellis/scripts/inject-workflow-state.py` + `.js`（一份源，多个 emitter)
- 现状代码： `adapters/harness/argv.ts`、`application/gbrain/wiring.ts`、`cli/commands/context.ts`、`skills/jspace-use/references/harnesses.md`、`templates/workbench/.claude/settings.json`

