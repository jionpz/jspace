# 注入层：jspace context 子命令 + hook 接线

> 子任务 B of `08-06-workbench-context-wiring`。父任务持有问题全貌与跨子任务验收。
> **依赖**：无。可与子任务 A 并行。
> **被依赖**：子任务 C 的「日常路由章补强」需引用本任务定下的块名与字段。

## Goal

让工作台的**状态与下一步**在每个会话自动到达 AI，不依赖任何 memory 文件被读取、
也不依赖用户记得去问。

这是父任务 P1 的根治手段：`AGENTS.md` 作为人类可读的事实源保留，
但**路由不再押在它被注入上**。

## 背景

Trellis 解决同一问题的方式是三个 hook 主动推送，完全绕开 memory 文件机制
（证据与逐条机制见父任务 `research/trellis-injection-methodology.md` §1-§4）。
JSpace 已有一个 `SessionStart` hook，但只用来跑 `jspace cron check`，没用于注入路由。

一处**不照抄** Trellis：它 ship python hook 脚本（因为它没有自己的可执行文件）；
`jspace` 是编译好的单文件二进制且已在 PATH 上，所以 hook 应写成 `jspace context <sub>` 子命令。
收益：零运行时依赖、payload 生成逻辑可单测、升级不产生模板漂移。
代价与缓解见方法论 §7 第 10 条。

## Requirements

### B1 — 命令面
- **B1.1** 新增 `jspace context session-start`：输出 harness hook 约定的 JSON
  （`hookSpecificOutput.additionalContext`），供 SessionStart hook 消费
- **B1.2** 新增 `jspace context turn`：per-turn 极短提示；**无可执行状态时不输出任何内容**
- **B1.3** 两个子命令都支持 `--dir`（复用现有 `features.dir`），默认 cwd
- **B1.4** 提供 `--plain` 输出裸文本（便于人工核对 payload 与后续接非 JSON-envelope 的 harness）

### B2 — payload 内容（照方法论 §2 的四个体积手段）
- **B2.1** `<current-state>` 必须是**求值后的结论**，不是规则表。至少覆盖：
  域清单（名 + 一行摘要）、pending 暂存写数、cron 失败/未确认 incident、filehub inbox 待归档数
- **B2.2** `<next-action>` 一句话下一步，由状态求值得出（对应 Trellis 的 `Next-Action`）
- **B2.3** 按需读的内容**只给路径清单不给正文**（域 README 路径、skill 名录）
- **B2.4** 不注入 `AGENTS.md` 全文——它已由子任务 A 的 `CLAUDE.md` 指针走官方 memory 通道加载；
  两条通路必须**显式去重**，不得重复注入同一内容
- **B2.5** 现有 `jspace cron check` 的输出并入 session-start payload，
  不再单独占一个 hook（避免两段无关输出）
- **B2.6** payload 体积设上限并在超限时降级为路径清单（不截断丢失）

### B3 — hook 接线
- **B3.1** `templates/workbench/.claude/settings.json` 注册 `SessionStart`，
  matcher 覆盖 `startup` / `clear` / `compact`（`/clear` 与上下文压缩后需重新注入）
- **B3.2** 注册 `UserPromptSubmit` 调 `jspace context turn`
- **B3.3** hook 命令行必须自带 shell 级兜底（`2>/dev/null || true`），
  保证任何情况下 exit 0——`UserPromptSubmit` 的 exit 2 在 Claude Code 有"阻断该轮提示"的特殊语义

### B4 — 可靠性（方法论 §4 七条逐条落项）
- **B4.1** 非工作台目录 → 静默 exit 0，零输出
- **B4.2** `JSPACE_HOOKS=0` 全局关闭；复用各 harness 的 `*_NON_INTERACTIVE=1` 探测
- **B4.3** `no-jspace` 关键词（word-boundary 匹配）单 turn 跳过注入
- **B4.4** 任何内部失败一律吞掉并降级，**从不抛到 host**、从不非零退出
- **B4.5** 所有外部调用（gbrain / git / 文件扫描）设超时上限；
  session-start 总预算 ≤ 5s，turn ≤ 1s
- **B4.6** 降级要**可见不静默**（方法论 §3 的纪律）：
  非工作台 → 静默；是工作台但注册表损坏 → 注入一行明确告警，不假装正常

## Acceptance Criteria

- [ ] AC-B1 工作台内启动 `claude` → 首轮上下文即含 `<current-state>` 与一句 `next-action`，
      无需用户提问
- [ ] AC-B2 `/clear` 后重新注入；上下文 compact 后重新注入
- [ ] AC-B3 非工作台目录启动 `claude` → 无任何输出、无报错（AC5 of 父任务）
- [ ] AC-B4 `JSPACE_HOOKS=0 claude` → 不注入
- [ ] AC-B5 prompt 含 `no-jspace` → 该 turn 不注入；下一轮恢复
- [ ] AC-B6 手工破坏 `hub.json`（写入非法 JSON）→ session-start 注入一行可见告警，
      且**仍 exit 0**、不阻断会话
- [ ] AC-B7 `jspace context session-start --plain --dir <工作台>` 人工核对内容正确
- [ ] AC-B8 payload 不含 `AGENTS.md` 正文片段（B2.4 去重）
- [ ] AC-B9 `jspace context turn` 在无 pending / 无 incident 的干净工作台上**零输出**
- [ ] AC-B10 单测覆盖 payload 生成：空工作台 / 有域 / 注册表损坏 / 超预算降级 四种形态
- [ ] AC-B11 `bunx tsc --noEmit`、`bun test`、`gen-assets` 后 `git diff` 干净

## 非目标

- 不接线 Pi / Codex / Cursor 的 hook（设计需留扩展位，本轮只做 Claude Code）
- 不做 session-end 自动写回（Claude Code 无原生 session-end hook；见 Key Decisions D3）
- 不改 skill 正文与 AGENTS.md 内容（子任务 C）
- 不引入常驻进程

## Key Decisions

- **D1｜子命令而非 ship 脚本**：与 Trellis 的最大分歧。见方法论 §7 第 10 条。
- **D2｜per-turn 注入是条件性的，不是无条件的**。Trellis 每 turn 必注入，因为它有任务状态机、
  "当前处于哪一步"始终有意义。JSpace 没有等价状态：每 turn 重复注入路由表是纯噪音。
  因此 `context turn` 只在**有可执行状态**（pending 暂存写、cron incident 等）时输出，
  否则静默。这是对 Trellis 机制的**克制改造**而非照抄。
- **D3｜本轮不做自动写回**。父任务 P3 指出"写回靠自觉"是复利问题，
  但 Claude Code 没有 session-end hook；`Stop` hook 在每次回复结束都触发，
  用它提示收工会变成高频骚扰。留待后续单独评估，本轮**不虚报**这项能力
  （`harnesses.md` 的 lifecycle 矩阵 session-end 仍标 `best_effort`）。
- **D4｜与 memory 通道显式去重**。子任务 A 让 `AGENTS.md` 经 `CLAUDE.md` 走官方 memory 通道；
  本任务的 hook 注入**只补它给不了的东西**——动态状态与求值结论。
  这对应方法论 §2 手段 2（Trellis 主动从 SessionStart payload 里剔除 per-turn 会重复的块）。
