# Implement — 注入层

> 子任务 B of `08-06-workbench-context-wiring`。设计见 `design.md`，需求见 `prd.md`。
> **依赖**：无。可与子任务 A 并行。
> **禁止**：不改 skill 正文、不改 `AGENTS.md` 内容（子任务 C）；不调用 gbrain（`design.md` §6）。

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun test application/context/          # 本任务新增
bun run scripts/gen-assets.ts && git diff --exit-code
```

## 步骤

### S1 · 状态采集（纯逻辑，先不接 CLI）

- [x] S1.1 新建 `application/context/collect.ts`：采集域清单、pending 数、cron incident、inbox 待归档数。
      **每项独立 try/catch**，单项失败只省略该项
- [x] S1.2 复用既有模块，不重新实现：
      `application/registry/domain.ts`（域）、`application/pending/use-cases.ts`（pending）、
      `application/automation/incidents.ts` + `status.ts`（incident）、
      `application/registry/inbox.ts`（inbox）。
      可参考 `application/workspace/doctor.ts:70-88` 的同源数据获取方式
- [x] S1.3 依赖注入设计（照 `doctorWorkbench(root, deps)` 的既有风格），便于单测
- [x] S1.4 单测：空工作台 / 3 域 / hub.json 损坏 三种形态
- [x] S1.5 `bunx tsc --noEmit && bun test`

### S2 · payload 渲染

- [x] S2.1 新建 `application/context/payload.ts`，按 `design.md` §3.1 渲染分块
- [x] S2.2 实现体积预算（§3.3 表）：域/路径各截 12 条并提示"另有 N 个"；
      session-start 4 KiB / turn 512 B；超限**逐块降级为路径清单，不截断丢字**
- [x] S2.3 `<next-action>` 优先级求值：pending > cron incident > inbox > 中性提示
- [x] S2.4 空值行整行省略（不输出"0 个"这种噪音）
- [x] S2.5 `turn` 渲染：有可执行状态才出内容，否则返回空
- [x] S2.6 单测：20 域截断、超 4 KiB 降级、turn 干净工作台零输出、
      **payload 不含 AGENTS.md 正文片段**（AC-B8 断言）
- [x] S2.7 `bun test`

> **Review gate 1**：跑 `--plain` 人眼看一遍真实 payload。
> 若读起来像"规则表"而不是"状态 + 下一步"，回 `design.md` §3 重设计，不要将就。

### S3 · 闸门

- [x] S3.1 新建 `application/context/gate.ts`，实现 `design.md` §5 的六条，**保持顺序**
- [x] S3.2 工作台探测：向上遍历目录树找 `.jspace/marker.json`
      （对应 Trellis `find_trellis_root`），支持从 `workspace/<domain>/` 启动
- [x] S3.3 `no-jspace` word-boundary 匹配（`no-jspacefoo` / `xno-jspace` **不**算命中，
      参照方法论 §3 的 `prompt_has_skip_keyword` 语义）
- [x] S3.4 单测：六条闸门各自命中 → 零输出
- [x] S3.5 `bun test`

### S4 · CLI 接线

- [x] S4.1 新建 `application/context/envelope.ts`，包 Claude Code 的
      `hookSpecificOutput` 信封；函数签名要能容纳其它 harness 形态（方法论 §1c 记录的四种差异）
- [x] S4.2 新建 `cli/commands/context.ts` 定义 `contextSpec`，
      子命令 `session-start` / `turn`，`features: { dir: true }`，选项 `--plain`
- [x] S4.3 注册进 `cli/commands/registry.ts` 的 `COMMANDS`
- [x] S4.4 **handler 内部 try/catch 兜住一切**，永远 `exitCode: 0`；
      不得让 `CliError` / `ArgError` 逃出（`design.md` §4.1）
- [x] S4.5 冒烟：
      ```bash
      bun run cli/main.ts context session-start --plain --dir ~/jspace-work
      bun run cli/main.ts context session-start --dir ~/jspace-work | jq .
      bun run cli/main.ts context turn --dir /tmp/empty-dir; echo "exit=$?"   # 期望零输出 exit=0
      ```

### S5 · hook 接线 + 模板

- [x] S5.1 改 `templates/workbench/.claude/settings.json`：
      按 `design.md` §4.3 写入 SessionStart 三 matcher + UserPromptSubmit；
      **删除**现有的 `jspace cron check` hook（内容已并入 payload）
- [x] S5.2 每条命令都带 `2>/dev/null || true`（S 级要求，见 §4.3 说明）
- [x] S5.3 doctor 加 `hooks.not_wired` 诊断（`design.md` §9 开放问题 O1）：
      `.claude/settings.json` 存在但未含 `jspace context` hook → warning + 手工合并提示
- [x] S5.4 `bun run scripts/gen-assets.ts` → 确认嵌入式资产同步
- [x] S5.5 `bunx tsc --noEmit && bun test && git diff --exit-code`（gen-assets 后）

> **Review gate 2**：S5.1 改的是 seed 文件。确认既有工作台若改过该文件，
> upgrade 报 `skip` 而非覆盖（`bun run cli/main.ts workspace diff --dir ~/jspace-work` 核对）。

### S6 · 真实会话验收（需用户执行）

- [x] S6.1 `bun run cli/main.ts init --dir /tmp/jspace-b6` → 在该目录启动 `claude`
      → 首轮上下文含 `<current-state>` 与 `<next-action>`（AC-B1）
- [x] S6.2 `/clear` 后重新注入（AC-B2）
- [x] S6.3 在非工作台目录启动 `claude` → 无输出无报错（AC-B3）
- [x] S6.4 `JSPACE_HOOKS=0 claude` → 不注入（AC-B4）
- [x] S6.5 prompt 含 `no-jspace` → 该轮不注入，下一轮恢复（AC-B5）
- [x] S6.6 把 `hub.json` 写成非法 JSON → 注入一行可见告警且会话正常（AC-B6）
- [x] S6.7 干净工作台连续对话数轮 → 确认 `turn` 未产生噪音（AC-B9）

> **Review gate 3**：S6.1 与 S6.3 是本任务成立的判据。
> AC-B3 尤其重要——hook 在非工作台目录若有任何输出，会污染用户所有其它项目的会话。

### S7 · 无头验证与收尾

- [x] S7.1 **实测 `claude -p` 是否触发 SessionStart hook**（`design.md` §9 O3）：
      ```bash
      cd /tmp/jspace-b6 && claude -p "只回答：你收到了工作台状态吗" 
      ```
      结论写回父任务 `prd.md` 的 P1（cron 契约是否一并解决）
- [x] S7.2 若未触发 → 在 `.jspace/cron.json` 三个 prompt 里显式加
      `先跑 jspace context session-start --plain 取工作台状态`，并同步模板
- [x] S7.3 更新 `skills/jspace-use/references/harnesses.md` lifecycle 矩阵的
      Claude Code `session-start retrieval` 行：hook 已由本任务落地，
      但**是否升到 `automated` 取决于是否有 CI 证据**——若只有手工验证，
      按矩阵自述的分级语义仍标 `best_effort`，**不虚报**
- [x] S7.4 同步 `docs/PLATFORMS.md` 交叉引用
- [x] S7.5 全套验证命令跑通；清理 `/tmp/jspace-b6`

## 不做

- 不调用 gbrain（`design.md` §6；"活跃项目"留待后续）
- 不做 session-end 自动写回（`prd.md` D3）
- 不接线 Pi / Codex / Cursor（信封函数留扩展位即可）
- 不改 AGENTS.md 内容或 skill 正文（子任务 C）

## 完成判据

`prd.md` 的 AC-B1 ~ AC-B11 全部勾选。S7.1 的无头实测结论必须写回父任务，
无论结果如何——它决定 cron 契约问题是否还需要单独处理。

## 专家审查修复（2.2 · 多专家对抗审查确证）

> 5 lens 独立审查 + 对抗验证，确证 12 条（3 major + 9 minor，1 条被反驳——AC 勾选属全仓惯例非缺陷）。门禁：392 tests 绿。

| # | 严重度 | 缺陷 | 修复 |
|---|---|---|---|
| 1 | major | `context turn` 读 stdin 无超时且先于 gate——非 TTY 管道上无限阻塞，hooks=0/非工作台短路失效 | `readHookPrompt` 加 200ms 超时（`Promise.race`+`process.exit(0)`）；turn handler 改用 `gatePre` 先短路、再读 stdin、再查 no-jspace。FIFO 实测 0s 退出 |
| 2 | major | `<jspace-workbench>` header 断言「AGENTS.md 已由 CLAUDE.md 加载」在子目录启动时不成立（@import 不展开） | header 改为中性表述：「路由规则与治理在工作台根 AGENTS.md（未随本块复制；按需读取）」 |
| 3 | major | **无头 `claude -p` 实测触发 SessionStart hook**——我初版 S7.1「不触发」是误判（PATH 上是旧 jspace 1.0.8） | cron 显式命令保留作确定性兜底；harnesses.md/design O3/父 prd P1 修正为「无头也触发」+ 双份注入注明可接受 |
| 4 | minor | 状态采集无超时/预算（design §6 的 1s/5s） | `countInboxFiles` 顶层计数 + 10000 上限；同步 fs 无法优雅超时，由 host hook timeout 兜底（记录为权衡） |
| 5 | minor | session-start 4KiB 预算不保证：cron-incident 行无上限，降级只缩 available | `stateLines` 加 `MAX_CRON_LINES=5` + 「另有 N 个」tail；`truncateId` 防单行膨胀 |
| 6 | minor | turn 512B 预算不保证：长 cronId 单行超 512B | `renderTurn`/`nextAction` 的 cronId 截断到 48 字符 |
| 7 | minor | 空工作台注入空 `<current-state>` 块（噪音） | 空 state 不渲染 `<current-state>`；无域不渲染 `<available>` |
| 8 | minor | B2.1 域清单「名+一行摘要」未实现（只输出 id） | collect 读 domain.json `summary`，payload 渲染 `id（摘要）` |
| 9 | minor | inboxCount 递归计数与 `jspace inbox status` 顶层计数不一致 | `countInboxFiles` 改顶层计数（与 inbox status 语义一致） |
| 10 | minor | harnesses.md crash recovery 格仍写「SessionStart 跑 cron check」，该 hook 已删 | 更新为「session-start payload 暴露未确认 incident」 |
