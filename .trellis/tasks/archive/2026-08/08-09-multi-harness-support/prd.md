# Multi-Harness Support: Claude/OpenCode/Pi/Grok (issue #5)

## Goal

工作台外接 harness 支持从「Claude 全接、Codex argv、Pi 只有 argv、无 Grok」演化为**五个会话 harness 深度对齐 + 既有 Codex 兼容**（Claude / Grok Build / OpenCode / Pi / Cursor，Cursor 保留为会话 harness 不深度改造），能力差异**显式声明**（`capabilities.yaml` 单一事实源），文档与 CI **同步断言支持集**（防漂移）。

核心产品价值：无论用户选哪个 harness，都读写**同一份 gbrain 记忆**；harness 差异被抽象成「发射器不同、use case 协议相同」。

- 来源：GitHub issue #5 构建方案（`issue-5.md`，本任务目录内，454 行全量参考）
- 基线：HEAD `e47860c`，bun test 全绿、tsc 全绿（已现场核实：`adapters/harness/argv.ts` claude/codex/pi switch、`core/contracts/cron.ts:27` HARNESSES 三值、doctor 无 checkHarness、harnesses.md 与 PLATFORMS.md 手维）

## 已确认决策（2026-08-09，用户拍板）

| # | 决策点 | 定案 | 影响 |
|---|---|---|---|
| D1 | Grok 原生 memory vs gbrain 权威 | **B：gbrain 权威，Grok 内 bridge**。Grok 也接 gbrain（MCP），gbrain 是唯一事实源；Grok native memory 只是 Grok 内 UX，不参与 slug 生命周期。bridge = 在 PreCompact/收工时机注入提醒、由用户显式触发写回（与 D2 一致，**不自动写**）；主动 flush 留 M7 | 决定 P2 hook 形态 |
| D2 | Grok PreCompact hook 写 gbrain 时机 | **a：被动注入「快 compaction 了」提醒**，不自动写；主动 flush 留 M7 | P2 的 context pre-compact 语义 |
| D3 | OpenCode `session.idle` 触发面 | **仅 pending apply + cron check**（轻量幂等），不自动 memory-writeback；idle 每 turn 触发，自动写会写废 | P3 plugin 事件分支 |
| D4 | Pi 支持深度 | **识别 Pi 插件通道并提示安装**：`pi-mcp-adapter` 扩展（`pi install npm:pi-mcp-adapter`，stdio MCP）可接 gbrain；非纯边界文档 | P4 范围扩张（见下） |
| D5 | 实施批次 | **一次性，按 Phase 1→5 顺序 PR**，每 Phase 独立可验 | 任务树 5 子任务顺序 |
| D6 | Cursor 处置 | **支持集变更（保留 Cursor）：原「移除 Cursor」被用户否决，改为「Cursor 保持」**。支持集 = claude / grok / opencode / pi / **cursor**（会话 harness）+ codex（cron 兼容）。Cursor 是已文档化第 4 个会话 harness（harnesses.md:7/55-72/92 有完整 MCP + sessionStart hook + Rules 接线），本次改造**保留**：capabilities 加 cursor 条目（会话 harness，**无 headless CLI**→ 不进 cron enum，如实标注），不做深度接线（维持现状通道）；既有文档 Cursor 行/句保留并同步为「含 Grok/OpenCode 的新支持集」 | P5 断言纳入 Cursor；总支持集 6（5 会话 + codex） |

> **D4 与 issue #5 原文差异**：issue 原定「Pi 只标边界（sessions=[]，不做假 hook）」。用户拍板改为**提示安装 `pi-mcp-adapter` 插件**。证据：`skills/harness-config/references/harnesses.md:71-72` 已记录安装命令、6 级配置优先级（`~/.config/mcp/mcp.json` > `~/.agents/mcp.json` > `~/.agents/mcp/mcp.json` > `~/.pi/agent/mcp.json` > `.mcp.json` > `.pi/mcp.json`）、供应链注意（npm 安装即执行包代码）；`:77-80` 记录 `session_start` / `before_agent_start` 扩展事件 + `SYSTEM.md`/`APPEND_SYSTEM.md` 注入通道。Pi 的能力边界仍诚实标注（无 Claude 风格 hooks.json），但接入通道真实存在且可提示安装。

## In Scope

五子任务（独立可验交付，依赖关系写在各子任务 `prd.md`）：

| 子任务 | 内容 | 工作量 | 依赖 |
|---|---|---|---|
| P1 harness-capabilities | capabilities.yaml（嵌入二进制，**含 cursor 会话条目**）+ registry + argv 去 switch + **cron run --harness override** + doctor checkHarness + cron enum 扩 5 | 1 d | — |
| P2 harness-grok | Grok hook 五件套 + context pre-compact/session-end + .grok/skills 投影 + harness wire grok | 2 d | P1 |
| P3 harness-opencode | plugin TS + 细粒度事件 + .opencode/skills 投影 + compacting context 注入 | 1.5 d | P1 |
| P4 harness-pi | capabilities.pi 如实标注 + harness-pi.md 提示安装 pi-mcp-adapter + doctor 提示 | 0.5 d | P1 |
| P5 harness-consistency | check-harness-consistency.ts + harnesses.md machine-render + **harness-{claude,grok,opencode,cursor}.md 创建 + 支持集文档同步（Cursor 保留、Grok/OpenCode 入）** + verify.yml + PLATFORMS.md | 0.5 d | P1–P4 |

总工作量 ~5.5 天。

## Out of Scope

1. **不引入 Trellis 的任务管理**（task.py/sub-agent dispatch）——只借「capabilities 数据化」和「防跨层漂移」两个模式。
2. **不做第 6 个 harness**（Kilo、Antigravity 等 #future-backlog）。当前 5 个会话（Claude/Grok/OpenCode/Pi/Cursor）+ codex 兼容的深度 > 12 个广度。
3. **不改 gbrain 存什么**——只加触发它的 emitter；memory schema、slug 纪律、rel_path 协议全不动。
4. **不在 OpenCode plugin 里写长逻辑**——plugin 只做薄 emit，核心在 jspace CLI use case。
5. **不自动写 gbrain state**（D2/D3）：自动时机只做提醒/轻量幂等操作，写回走显式「收工」。注：OpenCode `session.idle` 触发的 `pending apply` 是对用户**显式 stage 队列**的 flush（意图来自用户），属幂等例外，非自动 write-back。

## Acceptance Criteria（跨子任务）

- [ ] AC-1 `capabilities.yaml` 是 harness 支持唯一事实源：argv 组装 / doctor / docs / CI 全部消费它，无第二份手维硬编码；**运行时以嵌入二进制方式可达**（gen-assets render 成 TS 模块，非依赖磁盘文件）
- [ ] AC-2 各 harness（claude/grok/opencode/pi/cursor，codex 兼容）有一个「能力如实」条目，`sessions`/`mcp`/`hook_format`/`native_memory`/`headless` 与真实能力一致（不虚报自动化，延续 invariant：只在 automated 处用「自动」措辞）
- [ ] AC-3 `cron.harness` enum 扩为 `["claude","codex","grok","opencode","pi"]`，`jspace cron run --harness <新harness> --dry-run` 可组装 argv；unsupported → 明确报错
- [ ] AC-4 `jspace doctor` 新增 checkHarness：每个注册 harness 检测二进制 / hook 文件 / skill 投影 / 能力匹配，drift → warning
- [ ] AC-5 init 出的工作台含各 harness 接线产物（.grok/hooks、.opencode/plugins、.grok/.opencode skills 投影），managed-files 清单同步
- [ ] AC-6 CI 加 check-harness-consistency：手工制造「list 漏 Grok / harnesses.md 忘更新」→ 红
- [ ] AC-7 Pi 有真实接入通道：harness-pi.md 含 pi-mcp-adapter 安装提示 + 供应链核对提醒；doctor 对 Pi 用户提示安装
- [ ] AC-8 全部完成后 tsc + bun test 全绿；`jspace doctor --dir /tmp/verify` 退出语义 = exit 0 且无 error（可含 warning）

## 参考

- 全量方案：`issue-5.md`（本目录，454 行）
- 现状代码：`adapters/harness/argv.ts`、`application/diagnostics/doctor.ts`、`core/contracts/cron.ts`、`templates/workbench/.jspace/cron.json`、`skills/jspace-use/references/harnesses.md`、`docs/PLATFORMS.md`
- Pi 插件证据：`skills/harness-config/references/harnesses.md:66-87`
- 外部文档：Grok Build `~/.grok/docs/user-guide/{10-hooks,13-memory,14-headless-mode,08-skills}.md`；OpenCode https://opencode.ai/docs/{config,plugins,skills}/
