# Implement — Issue #13 剩余自动化缺口

> 顺序：先核实 pi-hooks 格式，再做 capabilities/wire，再做 doctor/context，最后文档与全量验证。

## 0. 前置研究

- [x] 已通过 npm registry + 包源码核实 `pi-hooks`：它是 Pi 扩展集合，不是 jspace hook 配置格式。
- [x] 已确认 Pi 自动化 session-start 的真实机制是 `pi.on("before_agent_start")` + `pi.on("context")`（或返回 systemPrompt）。
- [x] 已回填 `design.md` D1：pi `session_start` = `~/.pi/agent/extensions/jspace/index.ts`，format `file`。
- [ ] 真实 Pi 环境验证扩展自动加载与注入效果（实现完成后做）。

## 1. capabilities.yaml + 类型

- [ ] 在 `adapters/harness/capabilities.yaml` 为五个 session harness 增加 `session_start` 声明（pi 按研究结果）。
- [ ] `adapters/harness/types.ts` 增加 `HarnessSessionStart` 类型与 `HarnessCapabilityData.session_start?`。
- [ ] `adapters/harness/registry.ts` 可选校验：声明了 session-start 事件的 harness 必须有 `session_start.path`。
- [ ] `scripts/check-harness-consistency.ts` 增加断言：
  - 每个含 session-start 事件的 harness 在 yaml 有 `session_start`
  - 模板/文档与声明路径一致
- [ ] 跑 `bun run scripts/gen-assets.ts` 刷新 `adapters/harness/capabilities.generated.ts`。

## 2. wire 增加 session-start 物化

- [ ] `application/harness/wire.ts` 新增 `wireSessionStart(harness, deps, root)`：
  - claude/grok/cursor/opencode：检查 workbench seed；缺失时返回 info/warning + 建议 `workspace upgrade`
  - pi：按 D1 路径写机器配置（merge + backup + dry-run）
- [ ] `application/harness/wire.test.ts` 增加：
  - pi dry-run 输出包含 session-start 写入 plan
  - pi 已物化 → already-wired 不重复写
  - claude/cursor seed 缺失 → 不直接写，给出 upgrade 指引
- [ ] `cli/commands/harness.ts` wireHandler 输出增加 session-start 状态行。

## 3. briefing 状态

- [ ] 新增 `application/context/briefing.ts`：
  - 读/写 `.jspace/state/briefing.json`
  - `touchBriefing(root)`：原子写 `last_session_start_at` + `session_count`
  - `readBriefing(root)`：缺失/损坏降级为 null/issues
  - `briefingStaleMs(root)` 或 `isBriefingStale(root, now)`：默认 7 天阈值
- [ ] `cli/commands/context.ts` `session-start` handler 在输出后 best-effort 调 `touchBriefing`（不阻塞、失败静默）。
- [ ] 测试：`application/context/briefing.test.ts` 覆盖 round-trip、损坏文件、stale 判断。

## 4. doctor 行为级检查

- [ ] `application/diagnostics/doctor.ts` 新增 `checkSessionStartHooks`：
  - 遍历 capabilities 的 session-start harness
  - workbench seed 存在但未挂 `jspace context session-start` → warning `harness.session_start_not_wired`
  - pi 机器配置缺失/未挂事件 → warning（或 info 视 pi-hooks 是否安装）
  - briefing 缺失/超阈值 → warning `briefing.stale`
- [ ] 保留/兼容现有 `hooks.not_wired` 与 `claude.pointer_missing` 测试。
- [ ] `application/diagnostics/doctor.test.ts` 增加行为级检查用例。

## 5. context incident banner

- [ ] `application/context/payload.ts` 增加 `incidentBanner`，在 `renderSessionStart` / `renderPreCompact` / `renderSessionEnd` 顶部插入。
- [ ] 测试：有 open incident 时 session-start 输出首行含 banner；无 incident 时不出现。

## 6. 首启文档

- [ ] `skills/jspace-use/SKILL.md` §2 增加 4.5 Scheduled tasks 与 final smoke cron 验证。
- [ ] 如有必要同步 `templates/workbench/AGENTS.md` 或 references 的 first-use 描述。
- [ ] 跑 `bun run scripts/gen-assets.ts` 刷新 `cli/assets.generated.ts` / `cli/manifest.generated.ts` / `cli/manifest.json`。

## 7. 全量验证

- [ ] `bunx tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run scripts/check-skills.ts`
- [ ] `bun run scripts/check-harness-consistency.ts`
- [ ] `bun run scripts/check-manifest-integrity.ts`
- [ ] `bun run cli/main.ts init /tmp/jspace-smoke`
- [ ] `bun run cli/main.ts doctor --dir /tmp/jspace-smoke`
- [ ] 在 /tmp/jspace-smoke 手工/自动验证：
  - `jspace harness wire --harness pi --dir . --dry-run` 输出 hook 计划
  - `jspace context session-start --plain` 在有 incident fixture 时首行 banner
  - doctor 能报 briefing.stale / harness.session_start_not_wired

## 8. 收尾

- [ ] 更新 `prd.md` 勾选验收项。
- [ ] 提交信息建议：`feat(harness): issue #13 session-start hook 物化 + doctor 行为级检查 + 首启 cron 引导 + incident banner`
- [ ] 如 issue #13 仍 open，在 commit/PR 中引用并更新已过时描述。

## 0b. pi-hooks 调研结论（已核实）

- `pi-hooks` npm 包实际是 checkpoint/lsp/permission/ralph-loop/repeat/token-rate 的扩展集合；`pi.on("session_start")` 只是 Pi 扩展 API，不提供“给 jspace 写任意 hook 配置”的入口。
- Pi 自动化 session-start briefing 应实现为 **jspace 专用 Pi extension**：
  - 路径：`~/.pi/agent/extensions/jspace/index.ts`（或 `PI_CODING_AGENT_DIR` 下 `extensions/jspace/index.ts`）
  - 事件：`before_agent_start` 运行 `jspace context session-start --plain`，`context` 事件注入 user message（参考 context-mode/pi-autoresearch 的 Pi extension 模式）
  - 不依赖 pi-hooks 包，也不自动执行 `pi install`
